/**
 * ペア卓の画面。
 * オンラインではホストだけが部屋を更新し、同じスナップショットを全員（観戦者含む）へ配る。
 */

import { APP_VERSION } from './version.js';
import { createNet } from './net.js';
import { GAME_LIST, dirLabel, handLabel, rankLabel } from './games.js';
import {
  COLORS,
  acceptHello,
  applyAction,
  createRoom,
  disconnectPeer,
  findPlayerByPeer,
  snapshot,
  tick,
} from './room.js';

const $ = (sel) => document.querySelector(sel);

const app = {
  screen: 'screen-title',
  mode: null,
  net: null,
  room: null,
  snap: null,
  youId: null,
  roomCode: '',
  name: '',
  color: COLORS[0].hex,
  focus: 0,
  sound: true,
  clockOffset: 0,
  stageKey: '',
  urgentKey: '',
  standArmed: null,
  hands: {},
  snapAt: 0,
  hockeyDrag: false,
  lastPaddle: null,
  connecting: false,
  prevPhase: {},
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function safeColor(hex) {
  const found = COLORS.find((c) => c.hex.toLowerCase() === String(hex || '').toLowerCase());
  return found ? found.hex : COLORS[7].hex;
}

function inkOn(hex) {
  return hex === '#e2a325' || hex === '#8d93a8' ? '#24180f' : '#fffaf3';
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2600);
}

let audioCtx = null;
function beep(freq, dur) {
  if (!app.sound) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.frequency.value = freq;
  gain.gain.value = 0.035;
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + dur);
}

function showScreen(id) {
  app.screen = id;
  for (const el of document.querySelectorAll('.screen')) el.hidden = el.id !== id;
}

function setJoinStatus(msg, kind = '') {
  const el = $('#join-status');
  el.textContent = msg || '';
  el.className = `status ${kind}`.trim();
}

function setRoomStatus(msg, kind = '') {
  const el = $('#room-status');
  el.textContent = msg || '';
  el.className = `room-status ${kind}`.trim();
}

function myself() {
  return app.snap?.players.find((p) => p.id === app.youId) || null;
}

function mySide(table) {
  const me = myself();
  if (!me?.seat || me.seat.table !== table.id) return null;
  return me.seat.side;
}

function paintColors() {
  $('#color-box').innerHTML = COLORS.map((c) => `
    <button type="button" class="swatch${c.hex === app.color ? ' is-on' : ''}"
      style="--swatch:${c.hex}" data-color="${c.hex}" role="option"
      aria-label="${esc(c.label)}" aria-selected="${c.hex === app.color}"></button>
  `).join('');
}

function openJoin(role) {
  app.mode = role;
  $('#join-title').textContent = role === 'host' ? '部屋を作る' : '部屋に入る';
  $('#join-go').textContent = role === 'host' ? '部屋を作る' : '入室する';
  $('#join-code-wrap').hidden = role !== 'guest';
  const saved = localStorage.getItem('minigames_name') || '';
  if (!$('#join-name').value) $('#join-name').value = saved;
  paintColors();
  setJoinStatus('');
  showScreen('screen-join');
  $('#join-name').focus();
}

function showReconnect(show) {
  $('#reconnect').hidden = !show;
}

function leaveToTitle() {
  if (app.mode === 'host') {
    try { app.net?.broadcast({ type: 'host_left', reason: 'closed' }); } catch (_) { /* ignore */ }
  }
  app.net?.destroy();
  app.net = null;
  app.room = null;
  app.snap = null;
  app.youId = null;
  app.mode = null;
  app.stageKey = '';
  app.urgentKey = '';
  app.standArmed = null;
  showReconnect(false);
  showScreen('screen-title');
}

function publish() {
  if (!app.room) return;
  const snap = snapshot(app.room, Date.now());
  if (app.mode === 'host' && app.net) app.net.broadcast({ type: 'state', snap });
  applySnap(snap);
}

function applySnap(snap) {
  if (!snap) return;
  noteTransitions(app.snap, snap);
  app.snap = snap;
  app.clockOffset = snap.serverNow - Date.now();
  app.snapAt = Date.now();
  clearStaleHands();
  if (app.screen === 'screen-room') renderRoom();
}

function clearStaleHands() {
  const me = myself();
  if (!me?.seat) return;
  const table = app.snap.tables[me.seat.table];
  if (!table) return;
  const match = table.match;
  const choosing = match && (
    (match.game === 'hilow' && match.phase === 'pick')
    || (match.game === 'acchi' && (match.phase === 'rps' || match.phase === 'aim'))
  );
  const locked = choosing && match.locked?.[me.seat.side];
  if (!locked) delete app.hands[table.id];
}

function noteTransitions(prev, next) {
  if (!prev) return;
  const me = next.players.find((p) => p.id === app.youId);
  if (!me?.seat) return;
  const table = next.tables[me.seat.table];
  const before = prev.tables[me.seat.table]?.match;
  const after = table?.match;
  if (!after) return;
  if (before?.phase !== 'go' && after.phase === 'go') beep(880, 0.09);
  if (before?.phase !== 'done' && after.phase === 'done') {
    const line = resultLine(table);
    $('#announce').textContent = `${table.name} ${line}`;
    beep(after.winner === me.seat.side ? 660 : 220, 0.12);
  }
}

function resultLine(table) {
  const match = table.match;
  if (!match || match.phase !== 'done') return '';
  if (match.reason === 'forfeit' && match.winner !== 'draw') {
    const seat = table.seats[match.winner];
    return `${seat?.name || ''} の不戦勝`;
  }
  if (match.winner === 'draw') return '引き分け';
  const seat = table.seats[match.winner];
  return `${seat?.name || ''} の勝ち`;
}

function scoreBits(match) {
  if (!match) return '';
  if (match.misses) return `逃 ${match.misses.a}–${match.misses.b}`;
  if (match.drops) return `落 ${match.drops.a}–${match.drops.b}`;
  if (match.scores) return `${match.scores.a} – ${match.scores.b}`;
  if (match.game === 'c4') return match.phase === 'done' ? '' : '対局中';
  return '';
}

function renderRoom() {
  const snap = app.snap;
  if (!snap) return;
  $('#room-code').textContent = app.roomCode || '練習';
  $('#pop-count').textContent = `${snap.players.length} / ${snap.maxPlayers}`;
  const pill = app.mode === 'host' ? 'ホスト' : app.mode === 'guest' ? '参加中' : 'オフライン練習';
  $('#mode-pill').textContent = pill;
  $('#btn-copy').hidden = app.mode === 'offline';
  renderTables();
  renderLog();
  renderRoster();
  renderUrgent();
  const key = stageSignature();
  if (key !== app.stageKey) {
    app.stageKey = key;
    $('#stage').innerHTML = stageHtml();
  }
  patchLive();
}

function stageView(match) {
  if (!match) return null;
  if (match.game === 'hockey') {
    return {
      game: 'hockey',
      phase: match.phase,
      misses: match.misses,
      winner: match.winner,
      reason: match.reason,
    };
  }
  if (match.game === 'bound') {
    return {
      game: 'bound',
      phase: match.phase,
      drops: match.drops,
      winner: match.winner,
      reason: match.reason,
      balls: match.balls.map((ball) => `${ball.id}:${ball.side}`),
    };
  }
  return match;
}

function stageSignature() {
  const table = app.snap.tables[app.focus];
  const live = stageView(table?.match);
  return JSON.stringify({
    focus: app.focus,
    you: app.youId,
    arm: app.standArmed,
    hand: app.hands[app.focus] || null,
    seats: table?.seats,
    votes: table?.votes,
    live,
    meSeat: myself()?.seat || null,
    n: app.snap.players.length,
  });
}

function renderTables() {
  const me = myself();
  $('#table-grid').innerHTML = app.snap.tables.map((table) => {
    const mine = me?.seat?.table === table.id;
    const state = tableState(table);
    return `
      <button type="button" class="table-card${table.id === app.focus ? ' is-focus' : ''}${mine ? ' is-mine' : ''}"
        data-act="focus" data-table="${table.id}" aria-current="${table.id === app.focus}">
        <span class="felt-mini">
          <span class="table-name">${esc(table.name)}</span>
          ${miniSeat(table.seats.a)}
          ${miniSeat(table.seats.b)}
          <span class="table-state">${esc(state)}</span>
        </span>
      </button>`;
  }).join('');
}

function miniSeat(seat) {
  if (!seat) return '<span class="mini-seat is-empty"><i></i>空席</span>';
  const color = safeColor(seat.color);
  const tag = seat.connected ? '' : ' · 切断';
  return `<span class="mini-seat"><i style="--pc:${color}"></i>${esc(seat.name)}${tag}</span>`;
}

function tableState(table) {
  const match = table.match;
  if (!match) {
    const n = (table.seats.a ? 1 : 0) + (table.seats.b ? 1 : 0);
    if (!n) return '空いています';
    if (n === 1) return '相手待ち';
    const vote = GAME_LIST.find((g) => g.id === table.votes.a)?.name
      || GAME_LIST.find((g) => g.id === table.votes.b)?.name;
    return vote ? `${vote}を相談中` : 'ゲームを選択';
  }
  const name = GAME_LIST.find((g) => g.id === match.game)?.name || '';
  if (match.phase === 'done') return `${name} ${resultLine(table)}`;
  const bits = scoreBits(match);
  return bits ? `${name} ${bits}` : name;
}

function renderLog() {
  $('#log').innerHTML = app.snap.log.map((line) => `<li>${esc(line.text)}</li>`).join('');
}

function renderRoster() {
  const me = myself();
  const host = app.mode === 'host' || app.mode === 'offline';
  $('#roster').innerHTML = app.snap.players.map((p) => {
    const color = safeColor(p.color);
    const where = p.seat ? (app.snap.tables[p.seat.table]?.name || '') : '観戦';
    const kick = host && p.id !== me?.id
      ? `<button type="button" data-act="kick" data-player="${esc(p.id)}" aria-label="${esc(p.name)}を退出させる">退出</button>`
      : '';
    return `
      <div class="person${p.id === me?.id ? ' is-me' : ''}${p.connected ? '' : ' offline'}">
        <span class="avatar" style="--pc:${color};--ink-on:${inkOn(color)}">${p.isHost ? '主' : ''}</span>
        <span class="who">${esc(p.name)}</span>
        <span class="where">${esc(where)}</span>
        ${kick}
      </div>`;
  }).join('');
}

function renderUrgent() {
  const sig = urgentSignature();
  if (sig === app.urgentKey) return;
  app.urgentKey = sig;
  const el = $('#urgent');
  if (!sig) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  const me = myself();
  const table = app.snap.tables[me.seat.table];
  el.hidden = false;
  if (sig.startsWith('tap')) {
    const label = table.match.phase === 'go' ? '今だ！' : '押せます';
    el.innerHTML = `<button type="button" class="urgent-tap" data-act="input" data-choice="tap" data-table="${table.id}">${esc(table.name)} · ${label}</button>`;
    return;
  }
  const label = sig.startsWith('live') ? `${table.name}で対局中 · 戻る` : `${table.name}であなたの番です`;
  el.innerHTML = `<button type="button" class="urgent-back" data-act="focus" data-table="${table.id}">${esc(label)}</button>`;
}

function urgentSignature() {
  const me = myself();
  if (!me?.seat) return '';
  const table = app.snap.tables[me.seat.table];
  const match = table?.match;
  if (!match || match.phase === 'done') return '';
  if (app.focus === table.id) return '';
  const side = me.seat.side;
  if (match.game === 'react' && (match.phase === 'go' || match.phase === 'wait')) return `tap:react:${table.id}:${match.round}:${match.phase}`;
  if (match.game === 'hockey' || match.game === 'bound') return `live:${match.game}:${table.id}`;
  if (match.game === 'c4' && match.turn === side) return `back:c4:${table.id}:${match.board.join('')}`;
  if (match.game === 'acchi' && (match.phase === 'rps' || match.phase === 'aim') && !match.locked[side]) {
    return `back:acchi:${table.id}:${match.phase}:${match.round}`;
  }
  if (match.game === 'hilow' && match.phase === 'pick' && !match.locked[side]) {
    return `back:hilow:${table.id}:${match.current}`;
  }
  return '';
}

function stageHtml() {
  const table = app.snap.tables[app.focus];
  if (!table) return '';
  const me = myself();
  const side = mySide(table);
  const playing = table.match && table.match.phase !== 'done';
  const occupied = !!(table.seats.a || table.seats.b);
  let flag = '空席';
  if (side && playing) flag = '対局中';
  else if (side) flag = '着席';
  else if (table.match || (table.seats.a && table.seats.b)) flag = '観戦中';
  else if (occupied) flag = '見学';
  return `
    <div class="stage-head">
      <h2>${esc(table.name)}</h2>
      <span class="flag">${flag}</span>
    </div>
    ${seatRow(table, me, playing)}
    ${table.match ? matchHtml(table, side) : ''}
    ${playing ? '' : lobbyHtml(table, me)}
    ${side ? standButton(table, playing) : ''}
  `;
}

function seatRow(table, me, playing) {
  return `<div class="seat-row">${seatPlate(table, 'a', me, playing)}<span class="vs">対</span>${seatPlate(table, 'b', me, playing)}</div>`;
}

function seatPlate(table, side, me, playing) {
  const seat = table.seats[side];
  if (seat) {
    const color = safeColor(seat.color);
    const sub = seat.connected ? (seat.isCPU ? 'CPU' : side === mySide(table) ? 'あなた' : '') : '再接続待ち';
    return `<div class="seat-plate" style="--pc:${color}"><strong>${esc(seat.name)}</strong><span class="sub">${esc(sub)}</span></div>`;
  }
  if (playing) return '<div class="seat-plate"><span class="sub">空席</span></div>';
  const here = me?.seat?.table === table.id;
  const busy = me?.seat && !here;
  const sit = here
    ? '<span class="sub">相手の席</span>'
    : busy
      ? '<span class="sub">ほかの卓に着席中</span>'
      : `<button type="button" class="chip" data-act="sit" data-table="${table.id}" data-side="${side}">この席に着く</button>`;
  const cpu = (app.mode === 'host' || app.mode === 'offline') && app.snap.players.length < app.snap.maxPlayers
    ? `<button type="button" class="chip" data-act="cpu" data-table="${table.id}" data-side="${side}">CPU</button>`
    : '';
  return `<div class="seat-plate"><div class="inline-actions">${sit}${cpu}</div></div>`;
}

function standButton(table, playing) {
  const armed = app.standArmed === table.id;
  const label = armed ? (playing ? '本当に立つ（不戦敗）' : '本当に立つ') : '席を立つ';
  return `<button type="button" class="stand" data-act="stand" data-table="${table.id}">${label}</button>`;
}

function lobbyHtml(table, me) {
  const ready = table.seats.a && table.seats.b;
  if (!ready) {
    return '<p class="hint">二人そろったらミニゲームを選びます。席にいない人は、このまま観戦できます。</p>';
  }
  const side = mySide(table);
  const done = table.match?.phase === 'done';
  const head = done && table.match.game !== 'c4'
    ? `<div class="result"><b>${esc(resultLine(table))}</b></div>`
    : '';
  if (!side) {
    const wishA = GAME_LIST.find((g) => g.id === table.votes.a)?.name;
    const wishB = GAME_LIST.find((g) => g.id === table.votes.b)?.name;
    const wish = [wishA && `左は${wishA}`, wishB && `右は${wishB}`].filter(Boolean).join(' / ');
    return `${head}<p class="hint">観戦中です。${esc(wish)}</p>`;
  }
  const mine = table.votes[side];
  const other = table.votes[side === 'a' ? 'b' : 'a'];
  const note = other && other !== mine
    ? `相手は${GAME_LIST.find((g) => g.id === other)?.name || ''}を希望しています`
    : '二人とも同じゲームを選ぶと始まります';
  const buttons = GAME_LIST.map((g) => `
    <button type="button" class="game-pick${mine === g.id ? ' is-mine' : ''}${other === g.id ? ' is-theirs' : ''}"
      data-act="vote" data-game="${g.id}">
      <strong>${esc(g.name)}</strong>
      <small>${esc(g.blurb)}</small>
    </button>`).join('');
  return `${head}<p class="hint">${esc(note)}</p><div class="game-list">${buttons}</div>`;
}

function matchHtml(table, side) {
  const match = table.match;
  if (match.phase === 'done' && match.game !== 'c4') return '';
  if (match.game === 'acchi') return htmlAcchi(table, side);
  if (match.game === 'react') return htmlReact(table, side);
  if (match.game === 'c4') return htmlC4(table, side);
  if (match.game === 'hilow') return htmlHilow(table, side);
  if (match.game === 'hockey') return htmlHockey(table, side);
  if (match.game === 'bound') return htmlBound(table, side);
  return '';
}

function nameOf(table, side) {
  return table.seats[side]?.name || (side === 'a' ? '左' : '右');
}

function lockLine(table, side, match, labelOf) {
  return ['a', 'b'].map((s) => {
    const who = esc(nameOf(table, s));
    if (!match.locked[s]) return `${who} 考え中`;
    if (s === side && app.hands[table.id]) return `${who} ${esc(labelOf(app.hands[table.id]))}`;
    return `${who} 確定`;
  }).join(' · ');
}

function htmlAcchi(table, side) {
  const match = table.match;
  const score = `<div class="scoreline"><span>${esc(nameOf(table, 'a'))} ${match.scores.a}</span><span>${match.round}回目</span><span>${match.scores.b} ${esc(nameOf(table, 'b'))}</span></div>`;
  if (match.phase === 'rpsShow' && match.reveal) {
    const note = match.reveal.result === 'draw'
      ? 'あいこ。もう一度じゃんけん。'
      : `${esc(nameOf(table, match.reveal.result))} の勝ち。次は方向です。`;
    return `${score}<div class="reveal-row">
      <div>${esc(nameOf(table, 'a'))}<b>${esc(handLabel(match.reveal.a))}</b></div>
      <div>${esc(nameOf(table, 'b'))}<b>${esc(handLabel(match.reveal.b))}</b></div>
    </div><p class="hint">${note}</p>`;
  }
  if (match.phase === 'aimShow' && match.reveal) {
    const role = (s) => (match.duty?.[s] === 'guess' ? '予想' : '向き');
    const note = match.reveal.hit
      ? `${esc(nameOf(table, match.reveal.guesser))} が当てた`
      : 'はずれ。点は入りません。';
    return `${score}<div class="reveal-row">
      <div>${esc(nameOf(table, 'a'))}<b>${esc(dirLabel(match.reveal.a))}</b><small>${role('a')}</small></div>
      <div>${esc(nameOf(table, 'b'))}<b>${esc(dirLabel(match.reveal.b))}</b><small>${role('b')}</small></div>
    </div><p class="hint">${note}</p>`;
  }
  if (match.phase === 'aim') {
    const duty = side ? match.duty?.[side] : null;
    const role = duty === 'face'
      ? 'じゃんけんに負けました。向く方向を選んでください。'
      : duty === 'guess'
        ? 'じゃんけんに勝ちました。相手の向く方向を当ててください。'
        : '負けた人が向き、勝った人が当てます。';
    const controls = side && !match.locked[side] ? `
      <div class="hands dirs">
        <button type="button" class="hand" data-act="input" data-dir="up" data-table="${table.id}">上</button>
        <button type="button" class="hand" data-act="input" data-dir="down" data-table="${table.id}">下</button>
        <button type="button" class="hand" data-act="input" data-dir="left" data-table="${table.id}">左</button>
        <button type="button" class="hand" data-act="input" data-dir="right" data-table="${table.id}">右</button>
      </div>` : '';
    return `${score}<p class="hint">${role}${lockLine(table, side, match, dirLabel)}。2本先取。</p>${controls}`;
  }
  const controls = side && !match.locked[side] ? `
    <div class="hands">
      <button type="button" class="hand" data-act="input" data-choice="rock" data-table="${table.id}">グー</button>
      <button type="button" class="hand" data-act="input" data-choice="scissors" data-table="${table.id}">チョキ</button>
      <button type="button" class="hand" data-act="input" data-choice="paper" data-table="${table.id}">パー</button>
    </div>` : '';
  return `${score}<p class="hint">${lockLine(table, side, match, handLabel)}。じゃんけんのあと、方向を当てます。2本先取。</p>${controls}`;
}

function htmlReact(table, side) {
  const match = table.match;
  const score = `<div class="scoreline"><span>${esc(nameOf(table, 'a'))} ${match.scores.a}</span><span>${match.round}回目</span><span>${match.scores.b} ${esc(nameOf(table, 'b'))}</span></div>`;
  let cls = 'lamp';
  let label = '待て';
  if (match.phase === 'go') { cls += ' is-go'; label = '今だ！'; }
  if (match.flash?.type === 'fault') { cls += ' is-bad'; label = 'お手つき'; }
  const can = side && (match.phase === 'wait' || match.phase === 'go');
  const lamp = can
    ? `<button type="button" class="${cls}" data-act="input" data-choice="tap" data-table="${table.id}">${label}</button>`
    : `<div class="${cls}" aria-hidden="true">${label}</div>`;
  let note = '光ったら押す。早いと相手の得点。';
  if (match.flash?.type === 'fault') note = `${nameOf(table, match.flash.side)} のお手つき`;
  if (match.flash?.type === 'tap') note = `${nameOf(table, match.flash.side)} が反応`;
  if (match.flash?.type === 'miss') note = '両者とも見逃し';
  return `${score}${lamp}<p class="hint">${esc(note)}</p>`;
}

function htmlC4(table, side) {
  const match = table.match;
  const done = match.phase === 'done' ? `<div class="result"><b>${esc(resultLine(table))}</b></div>` : '';
  const turn = match.phase === 'play'
    ? (side === match.turn ? 'あなたの番です。列を選ぶと駒が落ちます。' : `${nameOf(table, match.turn)} の番`)
    : '';
  const heads = [];
  const cells = [];
  for (let col = 0; col < match.cols; col++) {
    const full = !!match.board[col];
    if (side && match.phase === 'play' && match.turn === side && !full) {
      heads.push(`<button type="button" class="c4-drop" data-act="input" data-col="${col}" data-table="${table.id}" aria-label="${col + 1}列目に落とす">↓</button>`);
    } else {
      heads.push('<div class="c4-drop is-quiet"></div>');
    }
  }
  for (let row = 0; row < match.rows; row++) {
    for (let col = 0; col < match.cols; col++) {
      const i = row * match.cols + col;
      const owner = match.board[i];
      const win = match.line?.includes(i) ? ' is-win' : '';
      const color = owner ? safeColor(table.seats[owner]?.color) : '#efe4d2';
      cells.push(`<div class="c4-cell${owner ? ' is-on' : ''}${win}" style="--pc:${color}"></div>`);
    }
  }
  return `${done}<p class="hint">${esc(turn)} 先に4つ揃えた方の勝ち。</p><div class="c4"><div class="c4-cols">${heads.join('')}</div><div class="c4-grid">${cells.join('')}</div></div>`;
}

function htmlHilow(table, side) {
  const match = table.match;
  const score = `<div class="scoreline"><span>${esc(nameOf(table, 'a'))} ${match.scores.a}</span><span>残り${match.remaining}枚</span><span>${match.scores.b} ${esc(nameOf(table, 'b'))}</span></div>`;
  const card = match.phase === 'reveal' && match.reveal
    ? rankLabel(match.reveal.next)
    : rankLabel(match.current);
  let note = '次の札は高い？低い？同じなら点は入りません。3点先取。';
  if (match.phase === 'reveal' && match.reveal) {
    const word = match.reveal.result === 'high' ? '高い' : match.reveal.result === 'low' ? '低い' : '同じ';
    note = `次は ${rankLabel(match.reveal.next)}（${word}）`;
  } else if (match.phase === 'pick') {
    note = ['a', 'b'].map((s) => {
      if (!match.locked[s]) return `${nameOf(table, s)} 考え中`;
      if (s === side && app.hands[table.id]) return `${nameOf(table, s)} ${app.hands[table.id] === 'high' ? '高い' : '低い'}`;
      return `${nameOf(table, s)} 確定`;
    }).join(' · ');
  }
  const controls = side && match.phase === 'pick' && !match.locked[side] ? `
    <div class="choices">
      <button type="button" class="choice" data-act="input" data-choice="high" data-table="${table.id}">高い</button>
      <button type="button" class="choice" data-act="input" data-choice="low" data-table="${table.id}">低い</button>
    </div>` : '';
  return `${score}<div class="playing-card" aria-hidden="true">${esc(card)}</div><p class="hint">${esc(note)}</p>${controls}`;
}

function htmlHockey(table, side) {
  const match = table.match;
  const miss = (s) => `${esc(nameOf(table, s))} 逃し ${match.misses[s]}/${match.limit}`;
  const hint = side
    ? '板を左右にスライドして跳ね返す。速さは一定で、球は増えます。3回逃すと負け。'
    : '観戦中です。板は席の二人だけが動かせます。';
  return `<div class="scoreline"><span>${miss('a')}</span><span id="hockey-count">${match.balls.length}球</span><span>${miss('b')}</span></div>
    <canvas id="hockey-canvas" class="hockey-canvas" width="640" height="400"></canvas>
    <p class="hint">${hint}</p>`;
}

function htmlBound(table, side) {
  const match = table.match;
  const order = side === 'b' ? ['a', 'b'] : ['b', 'a'];
  const lanes = order.map((s) => `
    <div class="bound-lane${s === side ? ' is-mine' : ''}">
      <p class="scoreline"><span>${esc(nameOf(table, s))}</span><span>落とし ${match.drops[s]}/${match.limit}</span></p>
      <div class="bound-field" id="bound-field-${s}"></div>
    </div>`).join('');
  const hint = side
    ? '自分の側に落ちてくる球を押すと、相手側の上から落ちていきます。3個落とすと負け。'
    : '観戦中です。球を押せるのは席の二人だけです。';
  return `${lanes}<p class="hint">${hint}</p>`;
}

function liveElapsed() {
  return Math.max(0, Math.min(0.16, (Date.now() - (app.snapAt || Date.now())) / 1000));
}

function patchLive() {
  const table = app.snap?.tables[app.focus];
  const match = table?.match;
  if (!match || match.phase === 'done') return;
  if (match.game === 'hockey') drawHockey(table, match);
  if (match.game === 'bound') patchBound(table, match);
}

function drawHockey(table, match) {
  const canvas = document.getElementById('hockey-canvas');
  if (!canvas) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || 640;
  const h = canvas.clientHeight || Math.round(w * 0.62);
  const pw = Math.floor(w * dpr);
  const ph = Math.floor(h * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#123c86';
  ctx.fillRect(0, 0, w, h);
  const gy = (logical) => (1 - logical / 100) * h;
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(0, gy(4), w, h - gy(4));
  ctx.fillRect(0, 0, w, gy(96));
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(10, h / 2);
  ctx.lineTo(w - 10, h / 2);
  ctx.stroke();
  const elapsed = liveElapsed();
  for (const side of ['a', 'b']) {
    const py = side === 'a' ? 14 : 86;
    const px = match.paddles[side];
    const paddleW = (match.paddleW / 100) * w;
    const cx = (px / 100) * w;
    const cy = gy(py);
    ctx.fillStyle = safeColor(table.seats[side]?.color);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(cx - paddleW / 2, cy - 6, paddleW, 12, 6);
    else ctx.rect(cx - paddleW / 2, cy - 6, paddleW, 12);
    ctx.fill();
  }
  for (const ball of match.balls) {
    const x = ball.x + ball.vx * elapsed;
    const y = ball.y + ball.vy * elapsed;
    ctx.beginPath();
    ctx.fillStyle = '#f7fbff';
    ctx.arc((x / 100) * w, gy(y), Math.max(6, w * 0.018), 0, Math.PI * 2);
    ctx.fill();
  }
  const count = document.getElementById('hockey-count');
  if (count) count.textContent = `${match.balls.length}球`;
}

function patchBound(table, match) {
  const side = mySide(table);
  const elapsed = liveElapsed();
  const seen = new Set();
  for (const ball of match.balls) {
    const field = document.getElementById(`bound-field-${ball.side}`);
    if (!field) continue;
    seen.add(ball.id);
    let el = document.querySelector(`[data-ball-id="${ball.id}"]`);
    const mine = ball.side === side;
    if (!el || (mine && el.tagName !== 'BUTTON') || (!mine && el.tagName !== 'DIV') || el.parentElement !== field) {
      el?.remove();
      el = document.createElement(mine ? 'button' : 'div');
      el.className = 'bound-ball';
      el.dataset.ballId = String(ball.id);
      if (mine) {
        el.type = 'button';
        el.dataset.act = 'input';
        el.dataset.ball = String(ball.id);
        el.dataset.table = String(table.id);
        el.setAttribute('aria-label', '球を跳ね返す');
      }
      field.appendChild(el);
    }
    el.style.left = `${ball.x}%`;
    el.style.top = `${Math.min(100, ball.y + (match.fall || 22) * elapsed)}%`;
  }
  document.querySelectorAll('[data-ball-id]').forEach((el) => {
    if (!seen.has(Number(el.dataset.ballId))) el.remove();
  });
}

function sendAction(action) {
  if (app.mode === 'guest') {
    if (!app.net?.sendToHost({ type: 'action', action })) toast('ホストへ送れません');
    return;
  }
  if (!app.room || !app.youId) return;
  const res = applyAction(app.room, app.youId, action, Date.now());
  if (!res.ok) {
    if (res.error) toast(res.error);
    return;
  }
  if (res.changed) publish();
}

let lastPointerTap = 0;

function emitTap(table) {
  sendAction({ type: 'input', table: Number(table), input: { tap: 1 } });
}

function onRoomPointer(event) {
  if (event.target.closest?.('#hockey-canvas')) {
    app.hockeyDrag = true;
    event.preventDefault();
    sendPaddle(event);
    return;
  }
  const el = event.target.closest('[data-choice="tap"]');
  if (!el || event.button > 0 || event.isPrimary === false) return;
  event.preventDefault();
  lastPointerTap = Date.now();
  emitTap(el.dataset.table);
}

function onRoomPointerMove(event) {
  const canvas = document.getElementById('hockey-canvas');
  if (!canvas) return;
  const over = event.target === canvas || canvas.contains(event.target);
  if (event.pointerType === 'touch') {
    if (!app.hockeyDrag) return;
  } else if (!over && !app.hockeyDrag) return;
  else if (!over && !event.buttons) {
    app.hockeyDrag = false;
    return;
  }
  sendPaddle(event, canvas);
}

function sendPaddle(event, canvas) {
  canvas = canvas || document.getElementById('hockey-canvas');
  if (!canvas) return;
  const table = app.snap?.tables[app.focus];
  const side = mySide(table);
  if (!side || table.match?.game !== 'hockey' || table.match.phase !== 'play') return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return;
  const x = ((event.clientX - rect.left) / rect.width) * 100;
  const now = Date.now();
  if (app.lastPaddle && now - app.lastPaddle.at < 40 && Math.abs(app.lastPaddle.x - x) < 0.8) return;
  app.lastPaddle = { at: now, x };
  sendAction({ type: 'input', table: table.id, input: { x } });
}

function onRoomClick(event) {
  const el = event.target.closest('[data-act]');
  if (!el) return;
  if (el.dataset.choice === 'tap') {
    if (Date.now() - lastPointerTap < 80) return;
    emitTap(el.dataset.table);
    return;
  }
  const act = el.dataset.act;
  const table = Number(el.dataset.table);
  if (act === 'focus') {
    app.focus = table;
    app.standArmed = null;
    app.stageKey = '';
    renderRoom();
    return;
  }
  if (act === 'sit') {
    app.focus = table;
    app.standArmed = null;
    sendAction({ type: 'sit', table, side: el.dataset.side });
    return;
  }
  if (act === 'cpu') {
    sendAction({ type: 'seat_cpu', table, side: el.dataset.side });
    return;
  }
  if (act === 'vote') {
    sendAction({ type: 'vote', gameId: el.dataset.game });
    return;
  }
  if (act === 'stand') {
    if (app.standArmed !== table) {
      app.standArmed = table;
      app.stageKey = '';
      renderRoom();
      return;
    }
    app.standArmed = null;
    sendAction({ type: 'stand' });
    return;
  }
  if (act === 'kick') {
    sendAction({ type: 'kick', playerId: el.dataset.player });
    return;
  }
  if (act === 'input') {
    if (el.dataset.col != null) {
      sendAction({ type: 'input', table, input: { col: Number(el.dataset.col) } });
      return;
    }
    if (el.dataset.ball != null) {
      sendAction({ type: 'input', table, input: { id: Number(el.dataset.ball) } });
      return;
    }
    if (el.dataset.dir) {
      app.hands[table] = el.dataset.dir;
      sendAction({ type: 'input', table, input: { dir: el.dataset.dir } });
      return;
    }
    const choice = el.dataset.choice;
    app.hands[table] = choice;
    sendAction({ type: 'input', table, input: { choice } });
  }
}

function onKey(event) {
  if (event.repeat || app.screen !== 'screen-room') return;
  if (event.target.matches('input, textarea')) return;
  const me = myself();
  if (!me?.seat) return;
  const table = app.snap?.tables[me.seat.table];
  const match = table?.match;
  if (!match || match.phase === 'done') return;
  if (event.code === 'Space') {
    if (match.game === 'react') {
      event.preventDefault();
      sendAction({ type: 'input', table: table.id, input: { tap: 1 } });
    }
    return;
  }
  if (match.game === 'acchi' && match.phase === 'rps') {
    const map = { Digit1: 'rock', Digit2: 'scissors', Digit3: 'paper' };
    const choice = map[event.code];
    if (!choice) return;
    app.hands[table.id] = choice;
    sendAction({ type: 'input', table: table.id, input: { choice } });
  }
  if (match.game === 'acchi' && match.phase === 'aim') {
    const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    const dir = map[event.code];
    if (!dir) return;
    event.preventDefault();
    app.hands[table.id] = dir;
    sendAction({ type: 'input', table: table.id, input: { dir } });
  }
  if (match.game === 'c4' && match.phase === 'play' && match.turn === me.seat.side) {
    const col = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5, Digit7: 6 }[event.code];
    if (col == null) return;
    sendAction({ type: 'input', table: table.id, input: { col } });
  }
  if (match.game === 'hilow' && match.phase === 'pick') {
    const choice = event.code === 'ArrowUp' ? 'high' : event.code === 'ArrowDown' ? 'low' : null;
    if (!choice) return;
    event.preventDefault();
    app.hands[table.id] = choice;
    sendAction({ type: 'input', table: table.id, input: { choice } });
  }
}

function handleNetEvent({ from, data }) {
  if (!data) return;
  if (app.mode === 'host') onHost(from, data);
  else onGuest(data);
}

function onHost(from, data) {
  if (!app.room) return;
  if (data.type === 'hello') {
    const res = acceptHello(app.room, {
      peerId: from,
      name: data.name,
      color: data.color,
      version: data.version,
    }, APP_VERSION);
    if (!res.ok) {
      const type = res.error === 'full' ? 'room_full' : res.error === 'name_taken' ? 'name_taken' : 'version_mismatch';
      app.net.sendTo(from, { type, hostVersion: APP_VERSION, clientVersion: data.version || '?' });
      return;
    }
    app.net.sendTo(from, { type: 'joined', youId: res.player.id });
    publish();
    toast(res.reclaimed ? `${res.player.name} が戻った` : `${res.player.name} が入室`);
    return;
  }
  if (data.type === 'action') {
    const player = findPlayerByPeer(app.room, from);
    if (!player || !data.action) return;
    const res = applyAction(app.room, player.id, data.action, Date.now());
    if (!res.ok) {
      app.net.sendTo(from, { type: 'action_error', error: res.error || 'できません' });
      return;
    }
    if (res.kick?.peerId) app.net.sendTo(res.kick.peerId, { type: 'kicked' });
    if (res.changed) publish();
    return;
  }
  if (data.type === 'peer_left') {
    if (disconnectPeer(app.room, data.peerId, Date.now())) publish();
  }
}

function onGuest(data) {
  if (data.type === 'joined') {
    app.youId = data.youId;
    showReconnect(false);
    showScreen('screen-room');
    if (app.snap) renderRoom();
    return;
  }
  if (data.type === 'state') {
    applySnap(data.snap);
    if (app.youId && app.screen !== 'screen-room') showScreen('screen-room');
    if (app.screen === 'screen-room') renderRoom();
    return;
  }
  if (data.type === 'version_mismatch') {
    setJoinStatus(`バージョンが違います（部屋 v${data.hostVersion} / あなた v${APP_VERSION}）`, 'error');
    toast('同じ版のページを開いてください');
    app.net?.destroy();
    app.net = null;
    return;
  }
  if (data.type === 'room_full') {
    setJoinStatus('部屋は8人までです', 'error');
    toast('部屋は8人までです');
    app.net?.destroy();
    app.net = null;
    return;
  }
  if (data.type === 'name_taken') {
    setJoinStatus('同じ名前の人がすでにいます', 'error');
    toast('同じ名前の人がすでにいます');
    app.net?.destroy();
    app.net = null;
    return;
  }
  if (data.type === 'kicked') {
    toast('部屋から出されました');
    leaveToTitle();
    return;
  }
  if (data.type === 'host_left') {
    if (app.screen === 'screen-room') showReconnect(true);
    else setJoinStatus('ホストに届きませんでした', 'error');
    return;
  }
  if (data.type === 'action_error' && data.error) toast(data.error);
}

async function connectOnline(role) {
  if (app.connecting) return;
  const name = $('#join-name').value.trim() || 'プレイヤー';
  const code = $('#join-code').value.trim().toUpperCase();
  if (role === 'guest' && code.length < 4) {
    setJoinStatus('部屋コードを入力してください', 'error');
    return;
  }
  app.name = name;
  localStorage.setItem('minigames_name', name);
  localStorage.setItem('minigames_color', app.color);
  app.connecting = true;
  $('#join-go').disabled = true;
  setJoinStatus('接続しています…', 'warn');
  try {
    app.net?.destroy();
    app.net = createNet({
      role,
      roomCode: role === 'guest' ? code : undefined,
      onStatus: ({ msg, kind }) => {
        const tone = kind === 'error' ? 'error' : kind === 'ok' ? 'ok' : 'warn';
        if (app.screen === 'screen-room') setRoomStatus(msg, tone);
        else setJoinStatus(msg, tone);
      },
      onEvent: handleNetEvent,
    });
    const info = await app.net.start();
    app.roomCode = info.roomCode;
    app.mode = role;
    if (role === 'host') {
      app.room = createRoom({
        hostPeerId: info.peerId,
        hostName: name,
        hostColor: app.color,
      });
      app.youId = app.room.players[0].id;
      app.focus = 0;
      app.stageKey = '';
      showScreen('screen-room');
      setRoomStatus('このコードを共有してください。8人まで入れます。', 'ok');
      publish();
    } else {
      sessionStorage.setItem('minigames_rejoin', JSON.stringify({ room: info.roomCode, name }));
      const sent = app.net.sendToHost({
        type: 'hello',
        name,
        color: app.color,
        version: APP_VERSION,
        peerId: info.peerId,
      });
      if (!sent) throw new Error('ホストへ送れませんでした');
      setJoinStatus('ホストの返事を待っています…', 'ok');
    }
  } catch (err) {
    app.net?.destroy();
    app.net = null;
    app.room = null;
    setJoinStatus(err?.message || '接続に失敗しました', 'error');
  } finally {
    app.connecting = false;
    $('#join-go').disabled = false;
  }
}

async function reconnectGuest() {
  const saved = readRejoin();
  const roomCode = app.roomCode || saved?.room;
  const name = app.name || saved?.name || 'プレイヤー';
  if (!roomCode) {
    toast('部屋コードがありません');
    return;
  }
  $('#btn-reconnect').disabled = true;
  try {
    let info;
    if (app.net && app.net.role === 'guest' && app.net.roomCode === roomCode) {
      info = await app.net.reconnect();
    } else {
      app.net?.destroy();
      app.net = createNet({
        role: 'guest',
        roomCode,
        onStatus: ({ msg, kind }) => setRoomStatus(msg, kind === 'error' ? 'error' : 'warn'),
        onEvent: handleNetEvent,
      });
      info = await app.net.start();
    }
    app.roomCode = info.roomCode;
    app.mode = 'guest';
    app.name = name;
    const sent = app.net.sendToHost({
      type: 'hello',
      name,
      color: app.color,
      version: APP_VERSION,
      peerId: info.peerId,
    });
    if (!sent) throw new Error('ホストへ送れませんでした');
    toast('再接続を送った');
  } catch (err) {
    toast(err?.message || '再接続に失敗しました');
  } finally {
    $('#btn-reconnect').disabled = false;
  }
}

function readRejoin() {
  try { return JSON.parse(sessionStorage.getItem('minigames_rejoin') || 'null'); } catch (_) { return null; }
}

function startOffline({ spectate = false } = {}) {
  const name = ($('#join-name')?.value || localStorage.getItem('minigames_name') || '練習').trim() || '練習';
  app.name = name;
  app.mode = 'offline';
  app.roomCode = '';
  app.net?.destroy();
  app.net = null;
  app.room = createRoom({
    hostPeerId: 'offline-host',
    hostName: name,
    hostColor: app.color,
  });
  app.youId = app.room.players[0].id;
  app.focus = 0;
  app.stageKey = '';
  app.urgentKey = '';
  showScreen('screen-room');
  setRoomStatus('通信なしの練習です。空席に CPU を置くと1人でも対局できます。', 'ok');
  if (spectate) {
    const now = Date.now();
    for (const table of [0, 1]) {
      applyAction(app.room, app.youId, { type: 'seat_cpu', table, side: 'a' }, now);
      applyAction(app.room, app.youId, { type: 'seat_cpu', table, side: 'b' }, now);
    }
    setRoomStatus('CPU同士の対局を観戦しています。空いている卓に座れます。', 'ok');
  }
  publish();
}

function bind() {
  $('#ver').textContent = `v${APP_VERSION}`;
  const storedColor = localStorage.getItem('minigames_color');
  if (COLORS.some((c) => c.hex === storedColor)) app.color = storedColor;
  app.sound = localStorage.getItem('minigames_sound') !== '0';
  $('#btn-sound').textContent = app.sound ? '音オン' : '音オフ';
  $('#btn-sound').setAttribute('aria-pressed', String(app.sound));

  $('#btn-create').onclick = () => openJoin('host');
  $('#btn-join').onclick = () => openJoin('guest');
  $('#btn-offline').onclick = () => startOffline();
  $('#join-back').onclick = () => showScreen('screen-title');
  $('#color-box').onclick = (event) => {
    const btn = event.target.closest('[data-color]');
    if (!btn) return;
    app.color = btn.dataset.color;
    paintColors();
  };
  $('#join-form').onsubmit = (event) => {
    event.preventDefault();
    connectOnline(app.mode === 'guest' ? 'guest' : 'host');
  };
  $('#screen-room').addEventListener('pointerdown', onRoomPointer);
  $('#screen-room').addEventListener('pointermove', onRoomPointerMove);
  window.addEventListener('pointerup', () => { app.hockeyDrag = false; });
  window.addEventListener('pointercancel', () => { app.hockeyDrag = false; });
  $('#screen-room').addEventListener('click', onRoomClick);
  window.addEventListener('keydown', onKey);
  $('#btn-copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(app.roomCode);
      toast('部屋コードをコピーした');
    } catch (_) {
      toast(app.roomCode);
    }
  };
  $('#btn-sound').onclick = () => {
    app.sound = !app.sound;
    localStorage.setItem('minigames_sound', app.sound ? '1' : '0');
    $('#btn-sound').textContent = app.sound ? '音オン' : '音オフ';
    $('#btn-sound').setAttribute('aria-pressed', String(app.sound));
  };
  $('#btn-leave').onclick = () => {
    if ($('#btn-leave').dataset.armed === '1') leaveToTitle();
    else {
      $('#btn-leave').dataset.armed = '1';
      $('#btn-leave').textContent = '本当に退室';
      setTimeout(() => {
        $('#btn-leave').dataset.armed = '';
        $('#btn-leave').textContent = '退室';
      }, 2500);
    }
  };
  $('#btn-reconnect').onclick = () => reconnectGuest();
  $('#btn-give-up').onclick = () => leaveToTitle();

  setInterval(() => {
    if (!app.room) return;
    if (tick(app.room, Date.now())) publish();
  }, 100);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && app.room && tick(app.room, Date.now())) publish();
  });
  const loop = () => {
    if (app.screen === 'screen-room') patchLive();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  const demo = new URLSearchParams(location.search).get('demo');
  if (demo === 'spectate') startOffline({ spectate: true });
}

bind();

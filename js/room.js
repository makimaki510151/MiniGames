/**
 * 最大8人の部屋。卓は4つ、各卓は2席の1対1。
 * 状態を変えるのはホストだけ。スナップショットは部屋の全員（観戦者を含む）に配る。
 */

import {
  GAME_LIST,
  applyMatchInput,
  createMatch,
  forfeitMatch,
  gameById,
  publicMatch,
  suggestTtt,
  tickMatch,
} from './games.js';

export const MAX_PLAYERS = 8;
export const TABLE_COUNT = 4;
export const DISCONNECT_GRACE_MS = 30000;

export const COLORS = [
  { id: 'rose', hex: '#e85d75', label: 'あか' },
  { id: 'blue', hex: '#3d8bfd', label: 'あお' },
  { id: 'amber', hex: '#e2a325', label: 'きいろ' },
  { id: 'green', hex: '#2faf6a', label: 'みどり' },
  { id: 'violet', hex: '#a07cff', label: 'むらさき' },
  { id: 'orange', hex: '#f07a32', label: 'オレンジ' },
  { id: 'teal', hex: '#2bb8b0', label: 'みずいろ' },
  { id: 'silver', hex: '#8d93a8', label: 'シルバー' },
];

const TABLE_NAMES = ['一の卓', '二の卓', '三の卓', '四の卓'];

export function tableName(id) {
  return TABLE_NAMES[id] || `卓${id + 1}`;
}

export function cleanName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().slice(0, 12);
}

function clampColor(hex, fallback) {
  const found = COLORS.find((c) => c.hex.toLowerCase() === String(hex || '').toLowerCase());
  return found ? found.hex : fallback;
}

function emptyTable(id) {
  return {
    id,
    seats: { a: null, b: null },
    votes: { a: null, b: null },
    match: null,
  };
}

export function createRoom({ hostPeerId, hostName, hostColor, rng = Math.random }) {
  const room = {
    rng,
    nextId: 1,
    rev: 1,
    players: [],
    tables: Array.from({ length: TABLE_COUNT }, (_, i) => emptyTable(i)),
    log: [],
    cpuPlan: {},
  };
  const host = {
    id: `p${room.nextId++}`,
    peerId: hostPeerId,
    name: cleanName(hostName) || 'ホスト',
    color: clampColor(hostColor, COLORS[0].hex),
    isHost: true,
    isCPU: false,
    connected: true,
    seat: null,
    disconnectedAt: null,
    cpuRate: null,
  };
  room.players.push(host);
  pushLog(room, Date.now(), `${host.name} が部屋を開いた`);
  return room;
}

function pushLog(room, now, text) {
  room.log.unshift({ t: now, text });
  if (room.log.length > 24) room.log.length = 24;
}

export function findPlayer(room, playerId) {
  return room.players.find((p) => p.id === playerId) || null;
}

export function findPlayerByPeer(room, peerId) {
  return room.players.find((p) => p.peerId === peerId) || null;
}

function usedColors(room) {
  return new Set(room.players.map((p) => p.color.toLowerCase()));
}

function takeColor(room, requested) {
  const used = usedColors(room);
  const wanted = COLORS.find((c) => c.hex.toLowerCase() === String(requested || '').toLowerCase());
  if (wanted && !used.has(wanted.hex.toLowerCase())) return wanted.hex;
  const free = COLORS.find((c) => !used.has(c.hex.toLowerCase()));
  return (free || COLORS[room.players.length % COLORS.length]).hex;
}

function seatOf(room, playerId) {
  for (const table of room.tables) {
    for (const side of ['a', 'b']) {
      if (table.seats[side] === playerId) return { table, side };
    }
  }
  return null;
}

function playerAt(room, table, side) {
  const id = table.seats[side];
  return id ? findPlayer(room, id) : null;
}

function otherSide(side) {
  return side === 'a' ? 'b' : 'a';
}

function bothSeated(table) {
  return !!(table.seats.a && table.seats.b);
}

function clearVotes(table) {
  table.votes = { a: null, b: null };
}

function maybeStart(room, table, now) {
  if (!bothSeated(table)) return false;
  if (table.match && table.match.phase !== 'done') return false;
  const gameId = table.votes.a;
  if (!gameId || gameId !== table.votes.b || !gameById(gameId)) return false;
  if (table.match?.phase === 'done') {
    if (!table.match.doneAt) table.match.doneAt = now;
    if (now < table.match.doneAt + 1400) return false;
  }
  table.match = createMatch(gameId, room.rng, now);
  clearVotes(table);
  dropCpuPlans(room, table.id);
  const pa = playerAt(room, table, 'a');
  const pb = playerAt(room, table, 'b');
  pushLog(room, now, `${tableName(table.id)} ${pa?.name || ''} 対 ${pb?.name || ''} の${gameById(gameId).name}`);
  return true;
}

function endIfAbandoned(room, table, now) {
  const left = playerAt(room, table, 'a');
  const right = playerAt(room, table, 'b');
  if (left && right) return;
  if (table.match && table.match.phase !== 'done') {
    const winner = left ? 'a' : right ? 'b' : 'draw';
    forfeitMatch(table.match, winner);
    table.match.doneAt = now;
    table.match._logged = true;
    const who = left || right;
    pushLog(room, now, who
      ? `${tableName(table.id)} は ${who.name} の不戦勝`
      : `${tableName(table.id)} の対局は流れた`);
  }
  if (!left && !right) {
    table.match = null;
    clearVotes(table);
  } else {
    clearVotes(table);
  }
}

function vacate(room, player, now, { forfeit = true } = {}) {
  const seated = seatOf(room, player.id);
  if (!seated) return;
  const { table, side } = seated;
  table.seats[side] = null;
  player.seat = null;
  if (!forfeit && table.match && table.match.phase !== 'done') {
    /* caller already resolved */
  }
  endIfAbandoned(room, table, now);
  dropCpuPlans(room, table.id);
}

/**
 * バージョンが一致した hello を部屋に通す。
 * @returns {{ ok: true, player: object, reclaimed: boolean } | { ok: false, error: string }}
 */
export function acceptHello(room, hello, appVersion) {
  if (!hello || hello.version !== appVersion) return { ok: false, error: 'version' };
  return joinPlayer(room, hello);
}

export function joinPlayer(room, { peerId, name, color }) {
  if (!peerId) return { ok: false, error: 'bad_peer' };
  const nm = cleanName(name) || `P${room.players.length + 1}`;
  const samePeer = room.players.find((p) => p.peerId === peerId);
  if (samePeer) {
    samePeer.connected = true;
    samePeer.disconnectedAt = null;
    if (!samePeer.isHost) samePeer.name = nm;
    return { ok: true, player: samePeer, reclaimed: true };
  }
  const byName = room.players.find((p) => p.name === nm && !p.isCPU);
  if (byName && byName.connected) return { ok: false, error: 'name_taken' };
  if (byName && !byName.connected) {
    byName.peerId = peerId;
    byName.connected = true;
    byName.disconnectedAt = null;
    byName.isCPU = false;
    return { ok: true, player: byName, reclaimed: true };
  }
  if (room.players.length >= MAX_PLAYERS) return { ok: false, error: 'full' };
  const player = {
    id: `p${room.nextId++}`,
    peerId,
    name: nm,
    color: takeColor(room, color),
    isHost: false,
    isCPU: false,
    connected: true,
    seat: null,
    disconnectedAt: null,
    cpuRate: null,
  };
  room.players.push(player);
  pushLog(room, Date.now(), `${player.name} が入室した`);
  return { ok: true, player, reclaimed: false };
}

export function disconnectPeer(room, peerId, now) {
  const player = findPlayerByPeer(room, peerId);
  if (!player || player.isHost || player.isCPU) return false;
  if (!player.connected) return false;
  player.connected = false;
  player.disconnectedAt = now;
  pushLog(room, now, `${player.name} が切断（再接続待ち）`);
  return true;
}

function removePlayer(room, player, now) {
  if (!player || player.isHost) return false;
  vacate(room, player, now);
  room.players = room.players.filter((p) => p.id !== player.id);
  pushLog(room, now, `${player.name} が退室した`);
  return true;
}

function dropCpuPlans(room, tableId) {
  const prefix = `${tableId}:`;
  for (const key of Object.keys(room.cpuPlan)) {
    if (key.startsWith(prefix)) delete room.cpuPlan[key];
  }
}

function planKey(tableId, side) {
  return `${tableId}:${side}`;
}

function sigOf(table) {
  const m = table.match;
  if (!m || m.phase === 'done') return `idle:${table.votes.a || ''}:${table.votes.b || ''}:${m?.winner || ''}`;
  if (m.game === 'rps') return `rps:${m.phase}:${m.round}:${m.picks.a || ''}:${m.picks.b || ''}`;
  if (m.game === 'react') return `react:${m.phase}:${m.round}`;
  if (m.game === 'ttt') return `ttt:${m.turn}:${m.board.join('')}`;
  if (m.game === 'hilow') return `hilow:${m.phase}:${m.current}:${m.picks.a || ''}:${m.picks.b || ''}`;
  return `mash:${m.phase}`;
}

function driveCpu(room, now) {
  let changed = false;
  for (const table of room.tables) {
    for (const side of ['a', 'b']) {
      const player = playerAt(room, table, side);
      if (!player?.isCPU) continue;
      if (driveOneCpu(room, table, side, player, now)) changed = true;
    }
  }
  return changed;
}

function driveOneCpu(room, table, side, player, now) {
  const match = table.match;
  const idle = !match || match.phase === 'done';
  if (idle) return driveCpuVote(room, table, side, player, now);

  if (match.game === 'mash' && match.phase === 'play') {
    const rate = player.cpuRate ?? 0.7;
    if (room.rng() >= rate) return false;
    const res = applyMatchInput(match, side, { tap: 1 }, now);
    return !!res.changed;
  }

  const key = planKey(table.id, side);
  const signature = sigOf(table);
  let plan = room.cpuPlan[key];
  if (!plan || plan.sig !== signature) {
    plan = makeCpuPlan(room, match, side, now, signature);
    if (!plan) {
      delete room.cpuPlan[key];
      return false;
    }
    room.cpuPlan[key] = plan;
    return false;
  }
  if (now < plan.at) return false;
  delete room.cpuPlan[key];
  const res = applyMatchInput(match, side, plan.input, now);
  return !!res.changed;
}

function driveCpuVote(room, table, side, player, now) {
  if (!bothSeated(table)) return false;
  const other = otherSide(side);
  const otherPlayer = playerAt(room, table, other);
  const otherVote = table.votes[other];
  if (otherVote && table.votes[side] !== otherVote && !otherPlayer?.isCPU) {
    table.votes[side] = otherVote;
    maybeStart(room, table, now);
    return true;
  }
  if (table.votes.a && table.votes.b && table.votes.a !== table.votes.b && player.isCPU && otherPlayer?.isCPU && side === 'b') {
    table.votes.b = table.votes.a;
    maybeStart(room, table, now);
    return true;
  }
  if (table.votes[side]) return false;
  const key = planKey(table.id, 'vote-' + side);
  const signature = sigOf(table);
  let plan = room.cpuPlan[key];
  if (!plan || plan.sig !== signature) {
    const game = otherVote || GAME_LIST[Math.floor(room.rng() * GAME_LIST.length)].id;
    room.cpuPlan[key] = { sig: signature, at: now + 450 + Math.floor(room.rng() * 500), input: { game } };
    return false;
  }
  if (now < plan.at) return false;
  delete room.cpuPlan[key];
  table.votes[side] = otherVote || plan.input.game;
  maybeStart(room, table, now);
  return true;
}

function makeCpuPlan(room, match, side, now, signature) {
  const wait = 350 + Math.floor(room.rng() * 450);
  if (match.game === 'rps' && match.phase === 'pick' && !match.picks[side]) {
    const hands = ['rock', 'scissors', 'paper'];
    return { sig: signature, at: now + wait, input: { choice: hands[Math.floor(room.rng() * 3)] } };
  }
  if (match.game === 'react' && match.phase === 'go') {
    return { sig: signature, at: now + 220 + Math.floor(room.rng() * 320), input: { tap: 1 } };
  }
  if (match.game === 'ttt' && match.phase === 'play' && match.turn === side) {
    const cell = suggestTtt(match.board, side, room.rng);
    if (cell == null) return null;
    return { sig: signature, at: now + wait, input: { cell } };
  }
  if (match.game === 'hilow' && match.phase === 'pick' && !match.picks[side]) {
    const choice = match.current >= 8 ? 'low' : 'high';
    return { sig: signature, at: now + wait, input: { choice } };
  }
  return null;
}

function logMatchEnd(room, table, now) {
  const match = table.match;
  if (!match || match.phase !== 'done') return;
  if (!match.doneAt) match.doneAt = now;
  if (match._logged) return;
  match._logged = true;
  const pa = playerAt(room, table, 'a');
  const pb = playerAt(room, table, 'b');
  const name = gameById(match.game)?.name || '';
  if (match.winner === 'draw') {
    pushLog(room, now, `${tableName(table.id)} の${name}は引き分け`);
    return;
  }
  const winner = match.winner === 'a' ? pa : pb;
  pushLog(room, now, `${tableName(table.id)} の${name}は ${winner?.name || ''} の勝ち`);
}

/** @returns {boolean} */
export function tick(room, now) {
  let changed = false;
  for (const table of room.tables) {
    if (!table.match) continue;
    const before = table.match.phase;
    if (tickMatch(table.match, now, room.rng)) {
      changed = true;
      if (table.match.phase === 'done' && before !== 'done') logMatchEnd(room, table, now);
    }
  }
  if (driveCpu(room, now)) changed = true;
  for (const table of room.tables) {
    if (!table.match || table.match.phase === 'done') continue;
    const before = table.match.phase;
    if (tickMatch(table.match, now, room.rng)) {
      changed = true;
      if (table.match.phase === 'done' && before !== 'done') logMatchEnd(room, table, now);
    }
  }
  for (const player of room.players.slice()) {
    if (player.connected || player.disconnectedAt == null) continue;
    if (now - player.disconnectedAt < DISCONNECT_GRACE_MS) continue;
    removePlayer(room, player, now);
    changed = true;
  }
  for (const table of room.tables) {
    if (table.match?.phase === 'done') logMatchEnd(room, table, now);
    if (maybeStart(room, table, now)) changed = true;
  }
  if (changed) room.rev += 1;
  return changed;
}

/**
 * @returns {{ ok: boolean, changed?: boolean, error?: string, kick?: { peerId: string, playerId: string } }}
 */
export function applyAction(room, playerId, action, now) {
  const player = findPlayer(room, playerId);
  if (!player) return { ok: false, error: '部屋にいません' };
  if (!player.connected) return { ok: false, error: '切断中です' };
  const type = action?.type;
  if (type === 'sit') return sit(room, player, action, now);
  if (type === 'stand') return stand(room, player, now);
  if (type === 'vote') return vote(room, player, action, now);
  if (type === 'input') return input(room, player, action, now);
  if (type === 'seat_cpu') return seatCpu(room, player, action, now);
  if (type === 'kick') return kick(room, player, action, now);
  return { ok: false, error: '未知の操作です' };
}

function touch(room) {
  room.rev += 1;
}

function sit(room, player, action, now) {
  const tableId = action.table;
  const side = action.side;
  if (!Number.isInteger(tableId) || tableId < 0 || tableId >= TABLE_COUNT) {
    return { ok: false, error: '卓がありません' };
  }
  if (side !== 'a' && side !== 'b') return { ok: false, error: '席がありません' };
  if (player.seat) return { ok: false, error: 'すでに席に着いています' };
  const table = room.tables[tableId];
  if (table.match && table.match.phase !== 'done') return { ok: false, error: '対局中の卓です' };
  if (table.seats[side]) return { ok: false, error: 'その席は埋まっています' };
  table.seats[side] = player.id;
  player.seat = { table: tableId, side };
  clearVotes(table);
  pushLog(room, now, `${player.name} が ${tableName(tableId)} に着席`);
  touch(room);
  return { ok: true, changed: true };
}

function stand(room, player, now) {
  if (!player.seat) return { ok: false, error: '席に着いていません' };
  const table = room.tables[player.seat.table];
  const live = !!(table.match && table.match.phase !== 'done');
  vacate(room, player, now);
  if (!live) pushLog(room, now, `${player.name} が ${tableName(table.id)} を立った`);
  touch(room);
  return { ok: true, changed: true };
}

function vote(room, player, action, now) {
  const seated = seatOf(room, player.id);
  if (!seated) return { ok: false, error: '席に着くとゲームを選べます' };
  const game = gameById(action.gameId);
  if (!game) return { ok: false, error: 'ミニゲームがありません' };
  const { table, side } = seated;
  if (table.match && table.match.phase !== 'done') return { ok: false, error: '対局中です' };
  if (!bothSeated(table)) return { ok: false, error: '相手の着席を待っています' };
  if (table.votes[side] === game.id) return { ok: true, changed: false };
  table.votes[side] = game.id;
  const started = maybeStart(room, table, now);
  if (!started) {
    pushLog(room, now, `${player.name} は ${tableName(table.id)} で${game.name}を希望`);
  }
  touch(room);
  return { ok: true, changed: true };
}

function input(room, player, action, now) {
  const seated = seatOf(room, player.id);
  if (!seated) return { ok: false, error: '観戦中は操作できません' };
  if (Number.isInteger(action.table) && action.table !== seated.table.id) {
    return { ok: false, error: '観戦中は操作できません' };
  }
  const { table, side } = seated;
  if (!table.match || table.match.phase === 'done') return { ok: false, error: '対局が始まっていません' };
  const res = applyMatchInput(table.match, side, action.input, now);
  if (!res.ok) return res;
  if (res.changed) {
    if (table.match.phase === 'done') logMatchEnd(room, table, now);
    touch(room);
  }
  return { ok: true, changed: res.changed };
}

function seatCpu(room, player, action, now) {
  if (!player.isHost) return { ok: false, error: 'CPUを座らせられるのはホストだけです' };
  const tableId = action.table;
  const side = action.side;
  if (!Number.isInteger(tableId) || tableId < 0 || tableId >= TABLE_COUNT) {
    return { ok: false, error: '卓がありません' };
  }
  if (side !== 'a' && side !== 'b') return { ok: false, error: '席がありません' };
  const table = room.tables[tableId];
  if (table.seats[side]) return { ok: false, error: 'その席は埋まっています' };
  if (table.match && table.match.phase !== 'done') return { ok: false, error: '対局中の卓です' };
  if (room.players.length >= MAX_PLAYERS) return { ok: false, error: '部屋は8人までです' };
  const n = room.players.filter((p) => p.isCPU).length + 1;
  const cpu = {
    id: `p${room.nextId++}`,
    peerId: `cpu-${room.nextId}`,
    name: n === 1 ? 'CPU' : `CPU${n}`,
    color: takeColor(room, null),
    isHost: false,
    isCPU: true,
    connected: true,
    seat: { table: tableId, side },
    disconnectedAt: null,
    cpuRate: 0.55 + room.rng() * 0.35,
  };
  room.players.push(cpu);
  table.seats[side] = cpu.id;
  clearVotes(table);
  pushLog(room, now, `${cpu.name} が ${tableName(tableId)} に着席`);
  touch(room);
  return { ok: true, changed: true };
}

function kick(room, player, action, now) {
  if (!player.isHost) return { ok: false, error: '退出させられるのはホストだけです' };
  const target = findPlayer(room, action.playerId);
  if (!target) return { ok: false, error: 'その人はいません' };
  if (target.isHost) return { ok: false, error: 'ホストは退出させられません' };
  const peerId = target.peerId;
  const playerId = target.id;
  removePlayer(room, target, now);
  touch(room);
  return { ok: true, changed: true, kick: target.isCPU ? undefined : { peerId, playerId } };
}

function publicPlayer(room, player) {
  return {
    id: player.id,
    name: player.name,
    color: player.color,
    isHost: player.isHost,
    isCPU: player.isCPU,
    connected: player.connected,
    seat: player.seat ? { table: player.seat.table, side: player.seat.side } : null,
  };
}

function publicSeat(room, table, side) {
  const player = playerAt(room, table, side);
  if (!player) return null;
  return {
    playerId: player.id,
    name: player.name,
    color: player.color,
    connected: player.connected,
    isCPU: player.isCPU,
    isHost: player.isHost,
  };
}

/** 秘密の手を含まない、全員共通のスナップショット。 */
export function snapshot(room, now) {
  return {
    rev: room.rev,
    serverNow: now,
    maxPlayers: MAX_PLAYERS,
    players: room.players.map((p) => publicPlayer(room, p)),
    tables: room.tables.map((table) => ({
      id: table.id,
      name: tableName(table.id),
      seats: {
        a: publicSeat(room, table, 'a'),
        b: publicSeat(room, table, 'b'),
      },
      votes: { a: table.votes.a, b: table.votes.b },
      match: publicMatch(table.match),
    })),
    log: room.log.slice(0, 16),
  };
}

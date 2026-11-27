/**
 * 1対1ミニゲーム。状態を更新できるのはホストだけ。
 * 公開用の形には、未公開の手や山札を含めない。
 */

export const GAME_LIST = [
  { id: 'acchi', name: 'あっち向いてホイ', blurb: 'じゃんけんのあと、負けた人が向き、勝った人が当てる。2本先取。' },
  { id: 'react', name: '反射神経', blurb: '合図が出てから先に押す。早いとお手つき。2本先取。' },
  { id: 'c4', name: '重力付き4目並べ', blurb: '駒は下に落ちる。縦横斜めに4つ揃える。' },
  { id: 'hilow', name: 'ハイ＆ロー', blurb: '次の札が大きいか小さいか。3点先取。' },
  { id: 'hockey', name: 'エアホッケー', blurb: '板を左右に滑らせて跳ね返す。球は増え、3回逃すと負け。' },
  { id: 'bound', name: 'ホールバウンド', blurb: '落ちてくる球を押して相手へ返す。3個落とすと負け。' },
];

export const REACT_WAIT_MIN = 1400;
export const REACT_WAIT_SPAN = 2600;
export const REACT_GO_WINDOW = 3500;
export const REVEAL_MS = 1100;

export const HOCKEY_SPEED = 34;
export const HOCKEY_SPAWN_MS = 3500;
export const HOCKEY_MAX_BALLS = 5;
export const BOUND_FALL = 22;
export const BOUND_SPAWN_MS = 1700;
export const BOUND_MAX_BALLS = 7;

const HANDS = ['rock', 'scissors', 'paper'];
const DIRS = ['up', 'down', 'left', 'right'];
const C4_COLS = 7;
const C4_ROWS = 6;

export function gameById(id) {
  return GAME_LIST.find((g) => g.id === id) || null;
}

export function rankLabel(n) {
  return ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'][n - 1] || '?';
}

export function handLabel(hand) {
  if (hand === 'rock') return 'グー';
  if (hand === 'scissors') return 'チョキ';
  if (hand === 'paper') return 'パー';
  return '';
}

export function dirLabel(dir) {
  if (dir === 'up') return '上';
  if (dir === 'down') return '下';
  if (dir === 'left') return '左';
  if (dir === 'right') return '右';
  return '';
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function otherSide(side) {
  return side === 'a' ? 'b' : 'a';
}

function setSpeed(ball, vx, vy, speed) {
  const mag = Math.hypot(vx, vy) || 1;
  ball.vx = (vx / mag) * speed;
  ball.vy = (vy / mag) * speed;
}

function makeHockeyBall(match, rng) {
  const dir = rng() < 0.5 ? -1 : 1;
  const spread = (rng() - 0.5) * 1.1;
  const ball = {
    id: match.nextId++,
    x: 18 + rng() * 64,
    y: 50,
    vx: 0,
    vy: 0,
  };
  setSpeed(ball, Math.sin(spread), dir * Math.cos(spread), HOCKEY_SPEED);
  if (Math.abs(ball.vy) < HOCKEY_SPEED * 0.45) {
    setSpeed(ball, ball.vx, dir, HOCKEY_SPEED);
  }
  return ball;
}

function makeBoundBall(match, rng, side) {
  return {
    id: match.nextId++,
    side: side || (rng() < 0.5 ? 'a' : 'b'),
    x: 14 + rng() * 72,
    y: 0,
  };
}

export function createMatch(gameId, rng, now) {
  if (!gameById(gameId)) throw new Error(`未知のミニゲーム: ${gameId}`);
  if (gameId === 'acchi') {
    return {
      game: 'acchi',
      phase: 'rps',
      round: 1,
      target: 2,
      scores: { a: 0, b: 0 },
      picks: { a: null, b: null },
      reveal: null,
      revealUntil: 0,
      rpsWinner: null,
      winner: null,
      reason: null,
    };
  }
  if (gameId === 'react') {
    return {
      game: 'react',
      phase: 'wait',
      round: 1,
      target: 2,
      scores: { a: 0, b: 0 },
      waitUntil: now + REACT_WAIT_MIN + Math.floor(rng() * REACT_WAIT_SPAN),
      goAt: 0,
      gapUntil: 0,
      flash: null,
      winner: null,
      reason: null,
    };
  }
  if (gameId === 'c4') {
    return {
      game: 'c4',
      phase: 'play',
      cols: C4_COLS,
      rows: C4_ROWS,
      board: Array(C4_COLS * C4_ROWS).fill(null),
      turn: 'a',
      line: null,
      winner: null,
      reason: null,
    };
  }
  if (gameId === 'hilow') {
    const deck = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], rng);
    return {
      game: 'hilow',
      phase: 'pick',
      target: 3,
      scores: { a: 0, b: 0 },
      current: deck.pop(),
      _deck: deck,
      picks: { a: null, b: null },
      reveal: null,
      revealUntil: 0,
      winner: null,
      reason: null,
    };
  }
  if (gameId === 'hockey') {
    const match = {
      game: 'hockey',
      phase: 'play',
      misses: { a: 0, b: 0 },
      limit: 3,
      paddles: { a: 50, b: 50 },
      paddleW: 26,
      balls: [],
      nextId: 1,
      spawnAt: now + HOCKEY_SPAWN_MS,
      _t: now,
      winner: null,
      reason: null,
    };
    match.balls.push(makeHockeyBall(match, rng));
    return match;
  }
  const bound = {
    game: 'bound',
    phase: 'play',
    drops: { a: 0, b: 0 },
    limit: 3,
    balls: [],
    nextId: 1,
    spawnAt: now + BOUND_SPAWN_MS,
    _t: now,
    winner: null,
    reason: null,
  };
  bound.balls.push(makeBoundBall(bound, rng, 'a'));
  return bound;
}

function finishByScore(match, reason = 'score') {
  match.phase = 'done';
  match.reason = reason;
  if (match.scores.a > match.scores.b) match.winner = 'a';
  else if (match.scores.b > match.scores.a) match.winner = 'b';
  else match.winner = 'draw';
}

function rpsOutcome(a, b) {
  if (a === b) return 'draw';
  if (
    (a === 'rock' && b === 'scissors')
    || (a === 'scissors' && b === 'paper')
    || (a === 'paper' && b === 'rock')
  ) return 'a';
  return 'b';
}

function c4Index(row, col) {
  return row * C4_COLS + col;
}

function c4DropRow(board, col) {
  if (col < 0 || col >= C4_COLS) return -1;
  for (let row = C4_ROWS - 1; row >= 0; row--) {
    if (!board[c4Index(row, col)]) return row;
  }
  return -1;
}

function c4Winner(board) {
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let row = 0; row < C4_ROWS; row++) {
    for (let col = 0; col < C4_COLS; col++) {
      const who = board[c4Index(row, col)];
      if (!who) continue;
      for (const [dr, dc] of dirs) {
        const cells = [];
        for (let k = 0; k < 4; k++) {
          const r = row + dr * k;
          const c = col + dc * k;
          if (r < 0 || c < 0 || r >= C4_ROWS || c >= C4_COLS || board[c4Index(r, c)] !== who) break;
          cells.push(c4Index(r, c));
        }
        if (cells.length === 4) return { side: who, line: cells };
      }
    }
  }
  if (board.every(Boolean)) return { side: 'draw', line: null };
  return null;
}

export function suggestC4(board, side, rng) {
  const trial = (col, who) => {
    const row = c4DropRow(board, col);
    if (row < 0) return false;
    const i = c4Index(row, col);
    board[i] = who;
    const hit = c4Winner(board)?.side === who;
    board[i] = null;
    return hit;
  };
  for (let col = 0; col < C4_COLS; col++) if (trial(col, side)) return col;
  const opp = otherSide(side);
  for (let col = 0; col < C4_COLS; col++) if (trial(col, opp)) return col;
  const order = [3, 2, 4, 1, 5, 0, 6].filter((col) => c4DropRow(board, col) >= 0);
  if (!order.length) return null;
  return order[Math.floor(rng() * order.length)];
}

function resolveHilow(match, now) {
  if (!match._deck.length) {
    finishByScore(match);
    return;
  }
  const next = match._deck.pop();
  const result = next > match.current ? 'high' : next < match.current ? 'low' : 'tie';
  const points = { a: 0, b: 0 };
  if (result !== 'tie') {
    for (const side of ['a', 'b']) {
      if (match.picks[side] === result) {
        match.scores[side] += 1;
        points[side] = 1;
      }
    }
  }
  match.reveal = {
    next,
    result,
    picks: { a: match.picks.a, b: match.picks.b },
    points,
  };
  match.phase = 'reveal';
  match.revealUntil = now + REVEAL_MS;
}

function loseByDrop(match, side) {
  match.phase = 'done';
  match.winner = otherSide(side);
  match.reason = 'score';
}

/**
 * @returns {{ ok: boolean, changed: boolean, error?: string }}
 */
export function applyMatchInput(match, side, input, now) {
  if (!match || match.phase === 'done') return { ok: false, changed: false, error: '対局は終わっています' };
  if (side !== 'a' && side !== 'b') return { ok: false, changed: false, error: '席がありません' };

  if (match.game === 'acchi') {
    if (match.phase === 'rps') {
      if (!HANDS.includes(input?.choice)) return { ok: false, changed: false, error: '手を選んでください' };
      if (match.picks[side]) return { ok: true, changed: false };
      match.picks[side] = input.choice;
      if (match.picks.a && match.picks.b) {
        const result = rpsOutcome(match.picks.a, match.picks.b);
        match.reveal = { kind: 'rps', a: match.picks.a, b: match.picks.b, result };
        match.rpsWinner = result === 'draw' ? null : result;
        match.phase = 'rpsShow';
        match.revealUntil = now + REVEAL_MS;
      }
      return { ok: true, changed: true };
    }
    if (match.phase === 'aim') {
      if (!DIRS.includes(input?.dir)) return { ok: false, changed: false, error: '方向を選んでください' };
      if (match.picks[side]) return { ok: true, changed: false };
      match.picks[side] = input.dir;
      if (match.picks.a && match.picks.b) {
        const hit = match.picks.a === match.picks.b;
        if (hit && match.rpsWinner) match.scores[match.rpsWinner] += 1;
        match.reveal = {
          kind: 'aim',
          a: match.picks.a,
          b: match.picks.b,
          hit,
          guesser: match.rpsWinner,
        };
        match.phase = 'aimShow';
        match.revealUntil = now + REVEAL_MS;
      }
      return { ok: true, changed: true };
    }
    return { ok: true, changed: false };
  }

  if (match.game === 'react') {
    if (input?.tap !== 1) return { ok: false, changed: false, error: '押せません' };
    if (match.phase === 'wait') {
      const winner = otherSide(side);
      match.scores[winner] += 1;
      match.flash = { type: 'fault', side };
      match.phase = 'gap';
      match.gapUntil = now + REVEAL_MS;
      return { ok: true, changed: true };
    }
    if (match.phase === 'go') {
      match.scores[side] += 1;
      match.flash = { type: 'tap', side };
      match.phase = 'gap';
      match.gapUntil = now + 900;
      return { ok: true, changed: true };
    }
    return { ok: true, changed: false };
  }

  if (match.game === 'c4') {
    if (match.phase !== 'play') return { ok: true, changed: false };
    if (match.turn !== side) return { ok: false, changed: false, error: '相手の手番です' };
    const col = input?.col;
    if (!Number.isInteger(col) || col < 0 || col >= C4_COLS) {
      return { ok: false, changed: false, error: '列を選んでください' };
    }
    const row = c4DropRow(match.board, col);
    if (row < 0) return { ok: false, changed: false, error: 'その列は埋まっています' };
    match.board[c4Index(row, col)] = side;
    const found = c4Winner(match.board);
    if (found) {
      match.phase = 'done';
      match.line = found.line;
      match.winner = found.side;
      match.reason = found.side === 'draw' ? 'draw' : 'score';
    } else {
      match.turn = otherSide(side);
    }
    return { ok: true, changed: true };
  }

  if (match.game === 'hilow') {
    if (match.phase !== 'pick') return { ok: true, changed: false };
    if (input?.choice !== 'high' && input?.choice !== 'low') {
      return { ok: false, changed: false, error: '高い か 低い を選んでください' };
    }
    if (match.picks[side]) return { ok: true, changed: false };
    match.picks[side] = input.choice;
    if (match.picks.a && match.picks.b) resolveHilow(match, now);
    return { ok: true, changed: true };
  }

  if (match.game === 'hockey') {
    const x = Number(input?.x);
    if (!Number.isFinite(x)) return { ok: false, changed: false, error: '板を動かせません' };
    const next = Math.max(0, Math.min(100, x));
    if (match.paddles[side] === next) return { ok: true, changed: false };
    match.paddles[side] = next;
    return { ok: true, changed: true };
  }

  if (match.game === 'bound') {
    const id = input?.id;
    const ball = match.balls.find((b) => b.id === id && b.side === side);
    if (!ball) return { ok: false, changed: false, error: 'その球は押せません' };
    ball.side = otherSide(side);
    ball.y = 0;
    return { ok: true, changed: true };
  }

  return { ok: false, changed: false, error: '未対応のゲームです' };
}

function stepHockey(match, dt) {
  const changed = { moved: false, missed: false };
  const keep = [];
  for (const ball of match.balls) {
    const y0 = ball.y;
    let x = ball.x + ball.vx * dt;
    let y = ball.y + ball.vy * dt;
    if (x < 2.4) {
      x = 2.4;
      ball.vx = Math.abs(ball.vx);
      setSpeed(ball, ball.vx, ball.vy, HOCKEY_SPEED);
    } else if (x > 97.6) {
      x = 97.6;
      ball.vx = -Math.abs(ball.vx);
      setSpeed(ball, ball.vx, ball.vy, HOCKEY_SPEED);
    }
    let bounced = false;
    for (const side of ['a', 'b']) {
      const py = side === 'a' ? 14 : 86;
      const toward = side === 'a' ? ball.vy < 0 : ball.vy > 0;
      if (!toward || bounced) continue;
      const crossed = (y0 - py) * (y - py) <= 0;
      if (!crossed) continue;
      const denom = y - y0 || (ball.vy * dt);
      const t = denom === 0 ? 0 : (py - y0) / (y - y0 || denom);
      const hx = ball.x + (x - ball.x) * Math.max(0, Math.min(1, t));
      const half = match.paddleW / 2;
      const px = match.paddles[side];
      if (hx < px - half || hx > px + half) continue;
      const offset = (hx - px) / half;
      const dir = side === 'a' ? 1 : -1;
      setSpeed(ball, offset * 0.9, dir, HOCKEY_SPEED);
      x = hx;
      y = py + dir * 3.2;
      bounced = true;
    }
    if (!bounced && y < 4) {
      match.misses.a += 1;
      changed.missed = true;
      if (match.misses.a >= match.limit) loseByDrop(match, 'a');
      if (match.phase === 'done') break;
      continue;
    }
    if (!bounced && y > 96) {
      match.misses.b += 1;
      changed.missed = true;
      if (match.misses.b >= match.limit) loseByDrop(match, 'b');
      if (match.phase === 'done') break;
      continue;
    }
    ball.x = x;
    ball.y = Math.max(3, Math.min(97, y));
    keep.push(ball);
    changed.moved = true;
    if (match.phase === 'done') break;
  }
  match.balls = match.phase === 'done' ? keep : keep;
  return changed.moved || changed.missed;
}

function stepBound(match, dt) {
  let changed = false;
  const keep = [];
  for (const ball of match.balls) {
    ball.y += BOUND_FALL * dt;
    if (ball.y >= 100) {
      match.drops[ball.side] += 1;
      changed = true;
      if (match.drops[ball.side] >= match.limit) loseByDrop(match, ball.side);
      if (match.phase === 'done') break;
      continue;
    }
    keep.push(ball);
    changed = true;
    if (match.phase === 'done') break;
  }
  match.balls = keep;
  return changed;
}

/** @returns {boolean} 状態が変わった */
export function tickMatch(match, now, rng = Math.random) {
  if (!match || match.phase === 'done') return false;

  if (match.game === 'acchi' && (match.phase === 'rpsShow' || match.phase === 'aimShow') && now >= match.revealUntil) {
    const scored = match.scores.a >= match.target || match.scores.b >= match.target;
    if (match.phase === 'aimShow' && scored) {
      finishByScore(match);
      return true;
    }
    match.picks = { a: null, b: null };
    match.reveal = null;
    if (match.phase === 'rpsShow' && match.rpsWinner) {
      match.phase = 'aim';
      return true;
    }
    match.rpsWinner = null;
    match.round += 1;
    match.phase = 'rps';
    return true;
  }

  if (match.game === 'react') {
    if (match.phase === 'wait' && now >= match.waitUntil) {
      match.phase = 'go';
      match.goAt = now;
      match.flash = null;
      return true;
    }
    if (match.phase === 'go' && now >= match.goAt + REACT_GO_WINDOW) {
      match.flash = { type: 'miss' };
      match.phase = 'gap';
      match.gapUntil = now + 800;
      return true;
    }
    if (match.phase === 'gap' && now >= match.gapUntil) {
      if (match.scores.a >= match.target || match.scores.b >= match.target) {
        finishByScore(match);
        return true;
      }
      match.round += 1;
      match.phase = 'wait';
      match.flash = null;
      match.waitUntil = now + REACT_WAIT_MIN + Math.floor(rng() * REACT_WAIT_SPAN);
      return true;
    }
  }

  if (match.game === 'hilow' && match.phase === 'reveal' && now >= match.revealUntil) {
    const reached = match.scores.a >= match.target || match.scores.b >= match.target;
    if (reached || match._deck.length === 0) {
      finishByScore(match);
      return true;
    }
    match.current = match.reveal.next;
    match.picks = { a: null, b: null };
    match.reveal = null;
    match.phase = 'pick';
    return true;
  }

  if (match.game === 'hockey' || match.game === 'bound') {
    const prev = match._t ?? now;
    const dt = Math.max(0, Math.min(0.12, (now - prev) / 1000));
    match._t = now;
    let changed = false;
    if (dt > 0) {
      changed = match.game === 'hockey' ? stepHockey(match, dt) : stepBound(match, dt);
    }
    if (match.phase === 'done') return true;
    const cap = match.game === 'hockey' ? HOCKEY_MAX_BALLS : BOUND_MAX_BALLS;
    if (now >= match.spawnAt && match.balls.length < cap) {
      match.balls.push(match.game === 'hockey' ? makeHockeyBall(match, rng) : makeBoundBall(match, rng));
      match.spawnAt = now + (match.game === 'hockey' ? HOCKEY_SPAWN_MS : BOUND_SPAWN_MS);
      changed = true;
    }
    return changed;
  }

  return false;
}

export function forfeitMatch(match, winnerSide) {
  if (!match || match.phase === 'done') return false;
  match.phase = 'done';
  match.winner = winnerSide || 'draw';
  match.reason = 'forfeit';
  return true;
}

function acchiDuty(match) {
  if (!match.rpsWinner || (match.phase !== 'aim' && match.phase !== 'aimShow')) return null;
  return {
    a: match.rpsWinner === 'a' ? 'guess' : 'face',
    b: match.rpsWinner === 'b' ? 'guess' : 'face',
  };
}

/** 観戦者・対戦相手に配ってよい形。未公開の手と山札は落とす。 */
export function publicMatch(match) {
  if (!match) return null;
  if (match.game === 'acchi') {
    const show = match.phase === 'rpsShow' || match.phase === 'aimShow';
    return {
      game: 'acchi',
      phase: match.phase,
      round: match.round,
      target: match.target,
      scores: { ...match.scores },
      locked: { a: !!match.picks.a, b: !!match.picks.b },
      duty: acchiDuty(match),
      reveal: show ? match.reveal : null,
      winner: match.winner,
      reason: match.reason,
    };
  }
  if (match.game === 'react') {
    return {
      game: 'react',
      phase: match.phase,
      round: match.round,
      target: match.target,
      scores: { ...match.scores },
      flash: match.flash,
      winner: match.winner,
      reason: match.reason,
    };
  }
  if (match.game === 'c4') {
    return {
      game: 'c4',
      phase: match.phase,
      cols: match.cols,
      rows: match.rows,
      board: match.board.slice(),
      turn: match.turn,
      line: match.line ? match.line.slice() : null,
      winner: match.winner,
      reason: match.reason,
    };
  }
  if (match.game === 'hilow') {
    return {
      game: 'hilow',
      phase: match.phase,
      target: match.target,
      scores: { ...match.scores },
      current: match.current,
      remaining: match._deck.length,
      locked: { a: !!match.picks.a, b: !!match.picks.b },
      reveal: match.phase === 'pick' ? null : match.reveal,
      winner: match.winner,
      reason: match.reason,
    };
  }
  if (match.game === 'hockey') {
    return {
      game: 'hockey',
      phase: match.phase,
      misses: { ...match.misses },
      limit: match.limit,
      paddles: { ...match.paddles },
      paddleW: match.paddleW,
      speed: HOCKEY_SPEED,
      balls: match.balls.map((b) => ({ id: b.id, x: b.x, y: b.y, vx: b.vx, vy: b.vy })),
      winner: match.winner,
      reason: match.reason,
    };
  }
  return {
    game: 'bound',
    phase: match.phase,
    drops: { ...match.drops },
    limit: match.limit,
    fall: BOUND_FALL,
    balls: match.balls.map((b) => ({ id: b.id, side: b.side, x: b.x, y: b.y })),
    winner: match.winner,
    reason: match.reason,
  };
}

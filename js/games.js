/**
 * 1対1ミニゲーム。状態を更新できるのはホストだけ。
 * 公開用の形には、未公開の手や山札を含めない。
 */

export const GAME_LIST = [
  { id: 'rps', name: 'じゃんけん', blurb: '2本先取。あいこは取り直し。' },
  { id: 'react', name: '反射神経', blurb: '合図が出てから先に押す。早いとお手つき。2本先取。' },
  { id: 'ttt', name: '三目並べ', blurb: '交互に置いて、縦横斜めを3つ揃える。' },
  { id: 'hilow', name: 'ハイ＆ロー', blurb: '次の札が大きいか小さいか。3点先取。' },
  { id: 'mash', name: '連打', blurb: '6秒間、タップが多い方が勝ち。' },
];

export const REACT_WAIT_MIN = 1400;
export const REACT_WAIT_SPAN = 2600;
export const REACT_GO_WINDOW = 3500;
export const REVEAL_MS = 1100;
export const MASH_MS = 6000;
export const MASH_TAPS_PER_SEC = 14;

const RPS_HANDS = ['rock', 'scissors', 'paper'];
const TTT_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export function gameById(id) {
  return GAME_LIST.find((g) => g.id === id) || null;
}

export function rankLabel(n) {
  return ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'][n - 1] || '?';
}

export function rpsLabel(hand) {
  if (hand === 'rock') return 'グー';
  if (hand === 'scissors') return 'チョキ';
  if (hand === 'paper') return 'パー';
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

export function createMatch(gameId, rng, now) {
  if (!gameById(gameId)) throw new Error(`未知のミニゲーム: ${gameId}`);
  if (gameId === 'rps') {
    return {
      game: 'rps',
      phase: 'pick',
      round: 1,
      target: 2,
      scores: { a: 0, b: 0 },
      picks: { a: null, b: null },
      reveal: null,
      revealUntil: 0,
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
  if (gameId === 'ttt') {
    return {
      game: 'ttt',
      phase: 'play',
      board: Array(9).fill(null),
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
  return {
    game: 'mash',
    phase: 'play',
    counts: { a: 0, b: 0 },
    endAt: now + MASH_MS,
    _taps: { a: [], b: [] },
    winner: null,
    reason: null,
  };
}

function finishByScore(match, reason = 'score') {
  match.phase = 'done';
  match.reason = reason;
  const scores = match.scores || match.counts;
  if (scores.a > scores.b) match.winner = 'a';
  else if (scores.b > scores.a) match.winner = 'b';
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

function awardRound(match, side) {
  match.scores[side] += 1;
}

function tttWinner(board) {
  for (const line of TTT_LINES) {
    const [x, y, z] = line;
    if (board[x] && board[x] === board[y] && board[y] === board[z]) {
      return { side: board[x], line };
    }
  }
  if (board.every(Boolean)) return { side: 'draw', line: null };
  return null;
}

export function suggestTtt(board, side, rng) {
  const open = (indexes) => indexes.filter((i) => board[i] == null);
  const winningMove = (who) => {
    for (let i = 0; i < 9; i++) {
      if (board[i] != null) continue;
      board[i] = who;
      const hit = tttWinner(board)?.side === who;
      board[i] = null;
      if (hit) return i;
    }
    return null;
  };
  const win = winningMove(side);
  if (win != null) return win;
  const block = winningMove(otherSide(side));
  if (block != null) return block;
  if (board[4] == null) return 4;
  const corners = open([0, 2, 6, 8]);
  if (corners.length) return corners[Math.floor(rng() * corners.length)];
  const rest = open([1, 3, 5, 7]);
  if (!rest.length) return null;
  return rest[Math.floor(rng() * rest.length)];
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

/**
 * @returns {{ ok: boolean, changed: boolean, error?: string }}
 */
export function applyMatchInput(match, side, input, now) {
  if (!match || match.phase === 'done') return { ok: false, changed: false, error: '対局は終わっています' };
  if (side !== 'a' && side !== 'b') return { ok: false, changed: false, error: '席がありません' };

  if (match.game === 'rps') {
    if (match.phase !== 'pick') return { ok: true, changed: false };
    if (!RPS_HANDS.includes(input?.choice)) return { ok: false, changed: false, error: '手を選んでください' };
    if (match.picks[side]) return { ok: true, changed: false };
    match.picks[side] = input.choice;
    if (match.picks.a && match.picks.b) {
      const result = rpsOutcome(match.picks.a, match.picks.b);
      if (result !== 'draw') awardRound(match, result);
      match.reveal = { a: match.picks.a, b: match.picks.b, result };
      match.phase = 'reveal';
      match.revealUntil = now + REVEAL_MS;
    }
    return { ok: true, changed: true };
  }

  if (match.game === 'react') {
    if (input?.tap !== 1) return { ok: false, changed: false, error: '押せません' };
    if (match.phase === 'wait') {
      const winner = otherSide(side);
      awardRound(match, winner);
      match.flash = { type: 'fault', side };
      match.phase = 'gap';
      match.gapUntil = now + REVEAL_MS;
      return { ok: true, changed: true };
    }
    if (match.phase === 'go') {
      awardRound(match, side);
      match.flash = { type: 'tap', side };
      match.phase = 'gap';
      match.gapUntil = now + 900;
      return { ok: true, changed: true };
    }
    return { ok: true, changed: false };
  }

  if (match.game === 'ttt') {
    if (match.phase !== 'play') return { ok: true, changed: false };
    if (match.turn !== side) return { ok: false, changed: false, error: '相手の手番です' };
    const cell = input?.cell;
    if (!Number.isInteger(cell) || cell < 0 || cell > 8) {
      return { ok: false, changed: false, error: 'マスを選んでください' };
    }
    if (match.board[cell]) return { ok: false, changed: false, error: 'そのマスは埋まっています' };
    match.board[cell] = side;
    const found = tttWinner(match.board);
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

  if (match.game === 'mash') {
    if (match.phase !== 'play') return { ok: true, changed: false };
    if (input?.tap !== 1) return { ok: false, changed: false, error: 'タップできません' };
    const times = match._taps[side];
    const horizon = now - 1000;
    while (times.length && times[0] < horizon) times.shift();
    if (times.length >= MASH_TAPS_PER_SEC) return { ok: true, changed: false };
    times.push(now);
    match.counts[side] += 1;
    return { ok: true, changed: true };
  }

  return { ok: false, changed: false, error: '未対応のゲームです' };
}

/** @returns {boolean} 状態が変わった */
export function tickMatch(match, now, rng = Math.random) {
  if (!match || match.phase === 'done') return false;

  if (match.game === 'rps' && match.phase === 'reveal' && now >= match.revealUntil) {
    if (match.scores.a >= match.target || match.scores.b >= match.target) {
      finishByScore(match);
      return true;
    }
    match.picks = { a: null, b: null };
    match.reveal = null;
    match.round += 1;
    match.phase = 'pick';
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

  if (match.game === 'mash' && match.phase === 'play' && now >= match.endAt) {
    finishByScore(match);
    return true;
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

/** 観戦者・対戦相手に配ってよい形。未公開の手と山札は落とす。 */
export function publicMatch(match) {
  if (!match) return null;
  if (match.game === 'rps') {
    return {
      game: 'rps',
      phase: match.phase,
      round: match.round,
      target: match.target,
      scores: { ...match.scores },
      locked: { a: !!match.picks.a, b: !!match.picks.b },
      reveal: match.phase === 'pick' ? null : match.reveal,
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
  if (match.game === 'ttt') {
    return {
      game: 'ttt',
      phase: match.phase,
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
  return {
    game: 'mash',
    phase: match.phase,
    counts: { ...match.counts },
    endAt: match.endAt,
    winner: match.winner,
    reason: match.reason,
  };
}

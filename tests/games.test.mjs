import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BOUND_FALL,
  GAME_LIST,
  HOCKEY_SPEED,
  REACT_WAIT_MIN,
  applyMatchInput,
  createMatch,
  publicMatch,
  rankLabel,
  suggestC4,
  tickMatch,
} from '../js/games.js';

const zero = () => 0;

test('ミニゲームは6つとも1対1用の定義', () => {
  assert.equal(GAME_LIST.length, 6);
  assert.deepEqual(GAME_LIST.map((g) => g.id), ['acchi', 'react', 'c4', 'hilow', 'hockey', 'bound']);
});

test('あっち向いてホイはじゃんけんの勝者が方向を当てて2本先取', () => {
  const match = createMatch('acchi', zero, 0);
  applyMatchInput(match, 'a', { choice: 'rock' }, 0);
  applyMatchInput(match, 'b', { choice: 'rock' }, 0);
  assert.equal(match.phase, 'rpsShow');
  assert.equal(match.reveal.result, 'draw');
  tickMatch(match, match.revealUntil, zero);
  assert.equal(match.phase, 'rps');
  assert.equal(match.picks.a, null);

  applyMatchInput(match, 'a', { choice: 'rock' }, 5000);
  applyMatchInput(match, 'b', { choice: 'scissors' }, 5000);
  assert.equal(match.rpsWinner, 'a');
  tickMatch(match, match.revealUntil, zero);
  assert.equal(match.phase, 'aim');
  assert.equal(publicMatch(match).duty.a, 'guess');
  assert.equal(publicMatch(match).duty.b, 'face');
  applyMatchInput(match, 'b', { dir: 'left' }, 7000);
  applyMatchInput(match, 'a', { dir: 'right' }, 7000);
  assert.equal(match.reveal.hit, false);
  assert.equal(match.scores.a, 0);
  tickMatch(match, match.revealUntil, zero);
  assert.equal(match.phase, 'rps');

  applyMatchInput(match, 'a', { choice: 'paper' }, 9000);
  applyMatchInput(match, 'b', { choice: 'rock' }, 9000);
  tickMatch(match, match.revealUntil, zero);
  applyMatchInput(match, 'a', { dir: 'up' }, 11000);
  applyMatchInput(match, 'b', { dir: 'up' }, 11000);
  assert.equal(match.scores.a, 1);
  tickMatch(match, match.revealUntil, zero);
  applyMatchInput(match, 'a', { choice: 'paper' }, 13000);
  applyMatchInput(match, 'b', { choice: 'rock' }, 13000);
  tickMatch(match, match.revealUntil, zero);
  applyMatchInput(match, 'a', { dir: 'down' }, 15000);
  applyMatchInput(match, 'b', { dir: 'down' }, 15000);
  tickMatch(match, match.revealUntil, zero);
  assert.equal(match.phase, 'done');
  assert.equal(match.winner, 'a');
  assert.equal(match.scores.a, 2);
});

test('あっち向いてホイの未公開の手と方向は配らない', () => {
  const match = createMatch('acchi', zero, 0);
  applyMatchInput(match, 'a', { choice: 'paper' }, 0);
  const pub = publicMatch(match);
  assert.equal(pub.locked.a, true);
  assert.equal(pub.locked.b, false);
  assert.equal(pub.reveal, null);
  assert.equal(JSON.stringify(pub).includes('paper'), false);

  match.picks.b = 'rock';
  match.phase = 'aim';
  match.rpsWinner = 'a';
  match.picks = { a: 'left', b: null };
  const aim = publicMatch(match);
  assert.equal(aim.reveal, null);
  assert.equal(JSON.stringify(aim).includes('left'), false);
});

test('反射神経はお手つきが負け、合図のあとの先押しが勝ち', () => {
  const early = createMatch('react', zero, 1000);
  assert.equal(early.phase, 'wait');
  assert.equal(early.waitUntil, 1000 + REACT_WAIT_MIN);
  applyMatchInput(early, 'a', { tap: 1 }, 1000);
  assert.equal(early.flash.type, 'fault');
  assert.equal(early.scores.b, 1);

  const match = createMatch('react', zero, 0);
  assert.equal(tickMatch(match, match.waitUntil - 1, zero), false);
  assert.equal(tickMatch(match, match.waitUntil, zero), true);
  assert.equal(match.phase, 'go');
  applyMatchInput(match, 'b', { tap: 1 }, match.waitUntil + 30);
  assert.equal(match.scores.b, 1);
  assert.equal(match.flash.side, 'b');
  const pub = publicMatch(match);
  assert.equal(pub.waitUntil, undefined);
});

test('重力付き4目並べは下に落ち、4つで勝つ', () => {
  const match = createMatch('c4', zero, 0);
  assert.equal(applyMatchInput(match, 'b', { col: 0 }, 0).ok, false);
  applyMatchInput(match, 'a', { col: 0 }, 0);
  assert.equal(match.board[5 * 7], 'a');
  assert.equal(match.turn, 'b');
  applyMatchInput(match, 'b', { col: 0 }, 0);
  assert.equal(match.board[4 * 7], 'b');
  assert.equal(applyMatchInput(match, 'a', { col: 0 }, 0).ok, true);

  const win = createMatch('c4', zero, 0);
  for (let i = 0; i < 3; i++) {
    applyMatchInput(win, 'a', { col: 0 }, 0);
    applyMatchInput(win, 'b', { col: 1 }, 0);
  }
  applyMatchInput(win, 'a', { col: 0 }, 0);
  assert.equal(win.phase, 'done');
  assert.equal(win.winner, 'a');
  assert.equal(win.line.length, 4);

  const flat = createMatch('c4', zero, 0);
  for (let col = 0; col < 3; col++) {
    applyMatchInput(flat, 'a', { col }, 0);
    applyMatchInput(flat, 'b', { col }, 0);
  }
  applyMatchInput(flat, 'a', { col: 3 }, 0);
  assert.equal(flat.winner, 'a');
  assert.equal(applyMatchInput(flat, 'b', { col: 3 }, 0).ok, false);
});

test('重力付き4目並べのCPUは勝ちと阻止を選ぶ', () => {
  const win = Array(42).fill(null);
  win[5 * 7] = 'a';
  win[5 * 7 + 1] = 'a';
  win[5 * 7 + 2] = 'a';
  assert.equal(suggestC4(win, 'a', zero), 3);
  const block = Array(42).fill(null);
  block[5 * 7] = 'b';
  block[5 * 7 + 1] = 'b';
  block[5 * 7 + 2] = 'b';
  block[5 * 7 + 4] = 'a';
  assert.equal(suggestC4(block, 'a', zero), 3);
});

test('ハイ＆ローは山札を配らず、的中だけ加点する', () => {
  const match = createMatch('hilow', () => 0.999999, 0);
  assert.equal(match.current, 13);
  assert.equal(rankLabel(match.current), 'K');
  applyMatchInput(match, 'a', { choice: 'low' }, 0);
  const hidden = publicMatch(match);
  assert.equal(hidden.reveal, null);
  assert.equal(hidden.picks, undefined);
  assert.equal(JSON.stringify(hidden).includes('"low"'), false);
  assert.equal(JSON.stringify(hidden).includes('_deck'), false);
  applyMatchInput(match, 'b', { choice: 'high' }, 0);
  assert.equal(match.reveal.result, 'low');
  assert.equal(match.scores.a, 1);
  assert.equal(match.scores.b, 0);
  assert.equal(publicMatch(match).reveal.picks.b, 'high');
});

test('エアホッケーは速さを保って跳ね返り、3回逃すと負け', () => {
  const match = createMatch('hockey', () => 0.2, 0);
  const speed = (ball) => Math.hypot(ball.vx, ball.vy);
  assert.ok(Math.abs(speed(match.balls[0]) - HOCKEY_SPEED) < 0.01);
  match.balls[0].x = 50;
  match.balls[0].y = 30;
  match.balls[0].vx = 0;
  match.balls[0].vy = -HOCKEY_SPEED;
  match.paddles.a = 50;
  match.spawnAt = 1e15;
  let bounced = false;
  for (let t = 100; t < 2000; t += 100) {
    const before = match.balls[0]?.vy;
    tickMatch(match, t, zero);
    const ball = match.balls[0];
    assert.ok(ball, '跳ね返す前に球が消えた');
    assert.ok(Math.abs(speed(ball) - HOCKEY_SPEED) < 0.05);
    if (before < 0 && ball.vy > 0) {
      bounced = true;
      break;
    }
  }
  assert.equal(bounced, true);
  assert.equal(match.misses.a, 0);

  const miss = createMatch('hockey', zero, 0);
  miss.spawnAt = 1e15;
  miss.paddles.a = 0;
  for (let n = 0; n < 3; n++) {
    if (!miss.balls.length) miss.balls.push({ id: 50 + n, x: 80, y: 20, vx: 0, vy: -HOCKEY_SPEED });
    else Object.assign(miss.balls[0], { x: 80, y: 20, vx: 0, vy: -HOCKEY_SPEED });
    const start = miss._t;
    for (let t = start + 100; t < start + 2000; t += 100) {
      tickMatch(miss, t, zero);
      if (miss.misses.a > n || miss.phase === 'done') break;
    }
  }
  assert.equal(miss.misses.a, 3);
  assert.equal(miss.winner, 'b');

  const grow = createMatch('hockey', () => 0.3, 0);
  assert.equal(grow.balls.length, 1);
  tickMatch(grow, grow.spawnAt, () => 0.3);
  assert.equal(grow.balls.length, 2);
  for (const ball of grow.balls) assert.ok(Math.abs(speed(ball) - HOCKEY_SPEED) < 0.05);
});

test('ホールバウンドは押すと相手側へ落ち、3個落とすと負け', () => {
  const match = createMatch('bound', zero, 0);
  const id = match.balls[0].id;
  assert.equal(match.balls[0].side, 'a');
  assert.equal(applyMatchInput(match, 'b', { id }, 0).ok, false);
  assert.equal(applyMatchInput(match, 'a', { id }, 10).ok, true);
  assert.equal(match.balls[0].side, 'b');
  assert.equal(match.balls[0].y, 0);
  match.spawnAt = 1e15;
  for (let t = 100; t < 6000; t += 100) tickMatch(match, t, zero);
  assert.equal(match.drops.b, 1);
  assert.equal(match.phase, 'play');

  const lose = createMatch('bound', zero, 0);
  lose.spawnAt = 1e15;
  lose.balls = [{ id: 1, side: 'a', x: 40, y: 90 }];
  for (let n = 0; n < 3; n++) {
    if (!lose.balls.length) lose.balls.push({ id: 10 + n, side: 'a', x: 40, y: 90 });
    const start = lose._t;
    for (let t = start + 100; t < start + 2000; t += 100) {
      tickMatch(lose, t, zero);
      if (lose.drops.a > n || lose.phase === 'done') break;
    }
  }
  assert.equal(lose.drops.a, 3);
  assert.equal(lose.winner, 'b');

  const grow = createMatch('bound', zero, 0);
  tickMatch(grow, grow.spawnAt, zero);
  assert.equal(grow.balls.length, 2);
  assert.ok(grow.balls.every((ball) => ball.y < 100));
  assert.equal(publicMatch(grow).fall, BOUND_FALL);
});

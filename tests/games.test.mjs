import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GAME_LIST,
  REACT_WAIT_MIN,
  applyMatchInput,
  createMatch,
  publicMatch,
  rankLabel,
  suggestTtt,
  tickMatch,
} from '../js/games.js';

const zero = () => 0;

test('ミニゲームは5つとも1対1用の定義', () => {
  assert.equal(GAME_LIST.length, 5);
  assert.deepEqual(GAME_LIST.map((g) => g.id), ['rps', 'react', 'ttt', 'hilow', 'mash']);
});

test('じゃんけんは2本先取であいこを取り直す', () => {
  const match = createMatch('rps', zero, 0);
  applyMatchInput(match, 'a', { choice: 'rock' }, 0);
  applyMatchInput(match, 'b', { choice: 'rock' }, 0);
  assert.equal(match.phase, 'reveal');
  assert.equal(match.reveal.result, 'draw');
  assert.equal(match.scores.a, 0);
  tickMatch(match, match.revealUntil, zero);
  assert.equal(match.phase, 'pick');
  assert.equal(match.picks.a, null);

  applyMatchInput(match, 'a', { choice: 'rock' }, 5000);
  applyMatchInput(match, 'b', { choice: 'scissors' }, 5000);
  tickMatch(match, match.revealUntil, zero);
  applyMatchInput(match, 'a', { choice: 'paper' }, 9000);
  applyMatchInput(match, 'b', { choice: 'rock' }, 9000);
  tickMatch(match, match.revealUntil, zero);
  assert.equal(match.phase, 'done');
  assert.equal(match.winner, 'a');
  assert.equal(match.scores.a, 2);
});

test('じゃんけんの未公開の手は配らない', () => {
  const match = createMatch('rps', zero, 0);
  applyMatchInput(match, 'a', { choice: 'paper' }, 0);
  const pub = publicMatch(match);
  assert.equal(pub.locked.a, true);
  assert.equal(pub.locked.b, false);
  assert.equal(pub.reveal, null);
  assert.equal(JSON.stringify(pub).includes('paper'), false);
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

test('三目並べは勝利・引き分け・非法手', () => {
  const match = createMatch('ttt', zero, 0);
  const play = (side, cell) => applyMatchInput(match, side, { cell }, 0);
  assert.equal(play('b', 0).ok, false);
  play('a', 0);
  play('b', 3);
  play('a', 1);
  play('b', 4);
  assert.equal(play('a', 1).ok, false);
  play('a', 2);
  assert.equal(match.phase, 'done');
  assert.equal(match.winner, 'a');
  assert.deepEqual(match.line, [0, 1, 2]);

  const draw = createMatch('ttt', zero, 0);
  const cells = [0, 1, 2, 4, 3, 5, 7, 6, 8];
  cells.forEach((cell, i) => {
    applyMatchInput(draw, i % 2 === 0 ? 'a' : 'b', { cell }, 0);
  });
  assert.equal(draw.winner, 'draw');
  assert.equal(draw.reason, 'draw');
});

test('三目並べのCPUは勝ちと阻止を選ぶ', () => {
  const win = Array(9).fill(null);
  win[0] = 'a';
  win[1] = 'a';
  assert.equal(suggestTtt(win, 'a', zero), 2);
  const block = Array(9).fill(null);
  block[0] = 'b';
  block[1] = 'b';
  block[4] = 'a';
  assert.equal(suggestTtt(block, 'a', zero), 2);
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

test('連打は秒間上限を超えず、時間で勝敗が決まる', () => {
  const match = createMatch('mash', zero, 1000);
  for (let i = 0; i < 20; i++) applyMatchInput(match, 'a', { tap: 1 }, 1000);
  assert.equal(match.counts.a, 14);
  applyMatchInput(match, 'b', { tap: 1 }, 1000);
  assert.equal(tickMatch(match, match.endAt, zero), true);
  assert.equal(match.winner, 'a');
  assert.equal(publicMatch(match)._taps, undefined);
});

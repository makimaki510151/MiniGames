import assert from 'node:assert/strict';
import test from 'node:test';
import { APP_VERSION } from '../js/version.js';
import {
  DISCONNECT_GRACE_MS,
  MAX_PLAYERS,
  acceptHello,
  applyAction,
  createRoom,
  disconnectPeer,
  snapshot,
  tick,
} from '../js/room.js';

function room() {
  return createRoom({
    hostPeerId: 'minigames-TEST01',
    hostName: 'ホスト',
    hostColor: '#e85d75',
    rng: () => 0,
  });
}

function join(r, peerId, name, color = '#3d8bfd') {
  const res = acceptHello(r, { peerId, name, color, version: APP_VERSION }, APP_VERSION);
  assert.equal(res.ok, true, res.error);
  return res.player;
}

test('部屋は8人までで、バージョン不一致は入れない', () => {
  const r = room();
  assert.equal(r.players.length, 1);
  assert.equal(r.tables.length, 4);
  for (let i = 0; i < 7; i++) join(r, `g${i}`, `ゲスト${i}`);
  assert.equal(r.players.length, MAX_PLAYERS);
  const full = acceptHello(r, {
    peerId: 'extra', name: 'あふれる', version: APP_VERSION,
  }, APP_VERSION);
  assert.equal(full.ok, false);
  assert.equal(full.error, 'full');
  const bad = acceptHello(r, {
    peerId: 'old', name: '旧版', version: '0.0.1',
  }, APP_VERSION);
  assert.equal(bad.error, 'version');
  assert.equal(r.players.length, MAX_PLAYERS);
});

test('同じ名前の切断者は席を保ったまま戻れる', () => {
  const r = room();
  const guest = join(r, 'peer-a', 'みず');
  const host = r.players[0];
  applyAction(r, host.id, { type: 'sit', table: 0, side: 'a' }, 0);
  applyAction(r, guest.id, { type: 'sit', table: 0, side: 'b' }, 0);
  assert.equal(r.tables[0].seats.b, guest.id);

  disconnectPeer(r, 'peer-a', 1000);
  assert.equal(guest.connected, false);
  assert.equal(r.tables[0].seats.b, guest.id);
  tick(r, 1000 + DISCONNECT_GRACE_MS - 1);
  assert.equal(r.players.includes(guest), true);

  const back = acceptHello(r, {
    peerId: 'peer-b', name: 'みず', version: APP_VERSION,
  }, APP_VERSION);
  assert.equal(back.reclaimed, true);
  assert.equal(back.player.id, guest.id);
  assert.equal(back.player.seat.side, 'b');
  assert.equal(applyAction(r, guest.id, { type: 'vote', gameId: 'c4' }, 2000).ok, true);
});

test('席は1人1つ。観戦者の操作は拒否され、卓の状態は見える', () => {
  const r = room();
  const a = r.players[0];
  const b = join(r, 'b', 'あお');
  const watcher = join(r, 'w', 'みる');
  applyAction(r, a.id, { type: 'sit', table: 1, side: 'a' }, 0);
  assert.equal(applyAction(r, a.id, { type: 'sit', table: 2, side: 'a' }, 0).error, 'すでに席に着いています');
  applyAction(r, b.id, { type: 'sit', table: 1, side: 'b' }, 0);
  assert.equal(applyAction(r, watcher.id, { type: 'sit', table: 1, side: 'a' }, 0).error, 'その席は埋まっています');

  applyAction(r, a.id, { type: 'vote', gameId: 'acchi' }, 0);
  assert.equal(r.tables[1].match, null);
  applyAction(r, b.id, { type: 'vote', gameId: 'c4' }, 0);
  assert.equal(r.tables[1].match, null);
  applyAction(r, b.id, { type: 'vote', gameId: 'acchi' }, 0);
  assert.equal(r.tables[1].match.game, 'acchi');

  applyAction(r, a.id, { type: 'input', input: { choice: 'rock' } }, 10);
  const snap = snapshot(r, 10);
  const match = snap.tables[1].match;
  assert.equal(match.locked.a, true);
  assert.equal(JSON.stringify(match).includes('rock'), false);
  assert.equal(snap.players.length, 3);
  const denied = applyAction(r, watcher.id, { type: 'input', table: 1, input: { choice: 'paper' } }, 11);
  assert.equal(denied.error, '観戦中は操作できません');
  assert.equal(r.tables[1].match.picks.b, null);

  const other = applyAction(r, a.id, { type: 'input', table: 0, input: { choice: 'paper' } }, 12);
  assert.equal(other.error, '観戦中は操作できません');
  assert.equal(r.tables[1].match.picks.a, 'rock');
});

test('立席は不戦敗。30秒切断でも席を外して不戦敗', () => {
  const r = room();
  const a = r.players[0];
  const b = join(r, 'b', 'あお');
  applyAction(r, a.id, { type: 'sit', table: 0, side: 'a' }, 0);
  applyAction(r, b.id, { type: 'sit', table: 0, side: 'b' }, 0);
  applyAction(r, a.id, { type: 'vote', gameId: 'c4' }, 0);
  applyAction(r, b.id, { type: 'vote', gameId: 'c4' }, 0);
  applyAction(r, b.id, { type: 'stand' }, 50);
  assert.equal(r.tables[0].match.winner, 'a');
  assert.equal(r.tables[0].match.reason, 'forfeit');
  assert.equal(b.seat, null);
  applyAction(r, a.id, { type: 'stand' }, 55);

  applyAction(r, b.id, { type: 'sit', table: 2, side: 'a' }, 60);
  applyAction(r, a.id, { type: 'sit', table: 2, side: 'b' }, 60);
  applyAction(r, a.id, { type: 'vote', gameId: 'c4' }, 60);
  applyAction(r, b.id, { type: 'vote', gameId: 'c4' }, 60);
  assert.equal(r.tables[2].match.game, 'c4');
  disconnectPeer(r, 'b', 100);
  tick(r, 100 + DISCONNECT_GRACE_MS);
  assert.equal(r.players.some((p) => p.id === b.id), false);
  assert.equal(r.tables[2].match.winner, 'b');
  assert.equal(r.tables[2].match.reason, 'forfeit');
});

test('ホストはCPUを座らせ、CPU同士は同じゲームを始める', () => {
  const r = room();
  const host = r.players[0];
  assert.equal(applyAction(r, host.id, { type: 'seat_cpu', table: 0, side: 'a' }, 0).ok, true);
  assert.equal(applyAction(r, host.id, { type: 'seat_cpu', table: 0, side: 'b' }, 0).ok, true);
  const guest = join(r, 'g', 'みる');
  assert.equal(applyAction(r, guest.id, { type: 'seat_cpu', table: 1, side: 'a' }, 0).ok, false);
  let started = false;
  for (let t = 0; t <= 5000; t += 100) {
    tick(r, t);
    if (r.tables[0].match) {
      started = true;
      break;
    }
  }
  assert.equal(started, true);
  assert.equal(r.tables[0].votes.a, null);
  const snap = snapshot(r, 5000);
  assert.equal(snap.maxPlayers, 8);
  assert.equal(snap.tables[0].seats.a.isCPU, true);
  assert.equal(snap.tables[0].match == null, false);
});

test('同名の入室中プレイヤーは弾く。キックで対局から外れる', () => {
  const r = room();
  join(r, 'b', 'あお');
  const dup = acceptHello(r, { peerId: 'c', name: 'あお', version: APP_VERSION }, APP_VERSION);
  assert.equal(dup.error, 'name_taken');
  const other = join(r, 'c', 'きいろ', '#e2a325');
  const host = r.players[0];
  applyAction(r, host.id, { type: 'sit', table: 3, side: 'a' }, 0);
  applyAction(r, other.id, { type: 'sit', table: 3, side: 'b' }, 0);
  applyAction(r, host.id, { type: 'vote', gameId: 'hilow' }, 0);
  applyAction(r, other.id, { type: 'vote', gameId: 'hilow' }, 0);
  const kicked = applyAction(r, host.id, { type: 'kick', playerId: other.id }, 10);
  assert.equal(kicked.kick.playerId, other.id);
  assert.equal(r.tables[3].match.reason, 'forfeit');
  assert.equal(r.players.some((p) => p.id === other.id), false);
});

test('4卓を同時に対局でき、スナップショットに秘密の山札はない', () => {
  const r = room();
  const host = r.players[0];
  const mates = [];
  for (let i = 0; i < 7; i++) mates.push(join(r, `p${i}`, `人${i}`));
  const games = ['acchi', 'react', 'c4', 'hilow'];
  for (let t = 0; t < 4; t++) {
    const left = t === 0 ? host : mates[t * 2 - 1];
    const right = mates[t === 0 ? 0 : t * 2];
    applyAction(r, left.id, { type: 'sit', table: t, side: 'a' }, 0);
    applyAction(r, right.id, { type: 'sit', table: t, side: 'b' }, 0);
    applyAction(r, left.id, { type: 'vote', gameId: games[t] }, 0);
    applyAction(r, right.id, { type: 'vote', gameId: games[t] }, 0);
    assert.equal(r.tables[t].match.game, games[t]);
  }
  applyAction(r, host.id, { type: 'input', input: { choice: 'scissors' } }, 5);
  const raw = JSON.stringify(snapshot(r, 5));
  assert.equal(raw.includes('_deck'), false);
  assert.equal(raw.includes('scissors'), false);
  assert.equal(raw.includes('waitUntil'), false);
});

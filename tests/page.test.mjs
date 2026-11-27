import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { GAME_LIST } from '../js/games.js';

test('ページに6つの1対1ミニゲームと入口がある', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /js\/main\.js/);
  assert.match(html, /ペア卓/);
  assert.match(html, /id="screen-room"/);
  assert.match(html, /id="stage"/);
  for (const game of GAME_LIST) assert.match(html, new RegExp(game.name));
  const main = fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  assert.match(main, /createNet/);
  assert.match(main, /観戦/);
  const net = fs.readFileSync(new URL('../js/net.js', import.meta.url), 'utf8');
  assert.match(net, /minigames-/);
  assert.match(net, /peerjs@1\.5\.4/);
});

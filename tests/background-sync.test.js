const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./helpers/player-harness');

test('a throttled background iframe is still connected while its DOM frame exists', async () => {
  const h = createHarness({ noPlayer: true });
  const frame = Object.assign(new EventTarget(), {
    src: 'https://static.crunchyroll.com/vilos-v2/web/vilos/player.html', isConnected: true,
    contentWindow: { postMessage() {} }
  });
  h.context.crypto = { randomUUID: () => 'background-test' };
  h.context.document.querySelectorAll = () => [frame];
  h.run('setupPlayerBridge()');
  const event = new Event('message');
  Object.assign(event, { source: frame.contentWindow, origin: 'https://static.crunchyroll.com', data: {
    channel: 'watchparty-player', session: 'background-test', sequence: 1, type: 'state', videoId: 1, appliedCommandId: 0,
    media: { time: 100, paused: true, seeking: false, ended: false, readyState: 4, duration: 1400, rate: 1 }
  } });
  h.context.window.dispatchEvent(event);
  assert.equal(h.run('getFramePlayer() !== null'), true);
  await h.advance(10000);
  assert.equal(h.run('getFramePlayer() !== null'), true, 'timer throttling is not a DOM disconnection');
  frame.isConnected = false;
  assert.equal(h.run('getFramePlayer()'), null);
});

test('native media progress publishes controller reports without waiting for a throttled poller', () => {
  const h = createHarness();
  h.timeline({ senderId: 'alice', controllerId: 'alice' });
  h.sent.length = 0;
  h.player.emit('timeupdate');
  assert.equal(h.sent.filter((m) => m.type === 'report').length, 1);
});

test('the frame adapter forwards native progress even when interval callbacks do not run', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { root } = require('./helpers/player-harness');
  const h = createHarness();
  const packets = [];
  const parent = { postMessage: (packet) => packets.push(packet) };
  h.context.window.parent = parent;
  h.run(fs.readFileSync(path.join(root, 'content/player-frame.js'), 'utf8'));
  const event = new Event('message');
  Object.assign(event, { source: parent, origin: 'https://www.crunchyroll.com',
    data: { channel: 'watchparty-player', type: 'init', session: 'native-progress' } });
  h.context.window.dispatchEvent(event);
  packets.length = 0;
  h.player.emit('timeupdate');
  assert.equal(packets.filter((packet) => packet.event === 'timeupdate').length, 1);
});

test('native startup autoplay cannot replace a queued initial snapshot with the new video position', async () => {
  const h = createHarness({ paused: true, readyState: 0, time: 0 });
  h.timeline({ cause: 'join', time: 60, paused: false });
  h.player.readyState = 4;
  h.player.paused = false;
  h.player.emit('play');
  assert.equal(h.sent.filter((m) => m.type === 'control').length, 0, 'autoplay is not an explicit room control while initial sync is pending');
  h.player.emit('loadedmetadata');
  await h.advance(100);
  assert.ok(h.player.currentTime >= 60);
});

test('the first controller can report after the relay accepts its own initial snapshot', () => {
  const h = createHarness();
  h.run('state.initialSyncPending = true');
  h.timeline({ cause: 'initial', senderId: 'alice', controllerId: 'alice' });
  h.run('publishSnapshot(true)');
  assert.equal(h.sent.filter((m) => m.type === 'report').length, 1);
});

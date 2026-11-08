const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers/player-harness");

test("online state requires the relay protocol handshake and uses its assigned identity", () => {
  const h = createHarness();
  h.run("state.connected = false");
  h.deliver({ type: "welcome", protocol: 2, clientId: "server-assigned-id", username: "Alice_2", room: "test" });
  assert.equal(h.state().connected, true);
  assert.equal(h.state().clientId, "server-assigned-id");
  assert.equal(h.state().username, "Alice_2");
});

test("a player mounted after the connection announces readiness", () => {
  const h = createHarness({ noPlayer: true });
  h.deliver({ type: "welcome", protocol: 2, clientId: "alice", username: "Alice", room: "test" });
  h.replacePlayer();
  h.run("attachPlayerListeners()");
  assert.equal(h.sent.filter((m) => m.type === "ready").length, 1);
});

test("popup commands receive an explicit acknowledgement from the page script", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const { root } = require("./helpers/player-harness");
  const h = createHarness();
  let listener;
  h.context.chrome.runtime = { onMessage: { addListener: (fn) => { listener = fn; } } };
  h.context.buildUi = () => h.context.testUi;
  h.context.autoConnectFromInviteLink = async () => {};
  h.run(fs.readFileSync(path.join(root, "content/main.js"), "utf8"));
  let response;
  listener({ type: "WP_CONNECT", payload: {} }, {}, (value) => { response = value; });
  assert.equal(response?.ok, false);
});

test("SPA episode navigation does not seed the new episode with the old video's position", () => {
  const h = createHarness({ time: 900 });
  h.timeline({ paused: false, time: 900 });
  h.context.location.href = "https://www.crunchyroll.com/watch/EP2/new-episode";
  h.context.location.pathname = "/watch/EP2/new-episode";
  h.run("updatePageContext()");
  h.deliver({ type: "page-ready", pageKey: "/watch/ep2" });
  const ready = h.sent.filter((m) => m.type === "ready" && m.pageKey === "/watch/ep2");
  assert.equal(ready.length, 0, "wait for the new episode's metadata, not the old readyState");
  h.player.position = 0;
  h.player.emit("loadedmetadata");
  assert.equal(h.sent.filter((m) => m.type === "ready" && m.pageKey === "/watch/ep2").length, 1);
  assert.equal(h.state().timeline, null);
});

test("socket open is not online, and an obsolete relay gets a handshake error", async () => {
  const h = createHarness();
  h.run('connect({ serverUrl: "ws://relay.test", username: "Alice", room: "test" })');
  h.sockets[0].open();
  assert.equal(h.state().connected, false);
  assert.equal(h.sent.at(-1).protocol, 2);
  await h.advance(5100);
  assert.equal(h.state().connected, false);
  assert.equal(h.state().ws, null);
  assert.ok(h.logs.some(([line]) => line.includes("protocol 2")));
});

test("reconnect backoff grows and callbacks from old sockets cannot reconnect them", async () => {
  const h = createHarness();
  h.run('connect({ serverUrl: "ws://relay.test", username: "Alice", room: "test" })');
  h.sockets[0].close();
  await h.advance(1600);
  assert.equal(h.sockets.length, 2);
  h.sockets[0].open();
  assert.equal(h.sent.filter((m) => m.type === "join").length, 0);
  h.sockets[1].close();
  await h.advance(1600);
  assert.equal(h.sockets.length, 2);
  await h.advance(1000);
  assert.equal(h.sockets.length, 3);
  assert.equal(h.state().reconnectAttempts, 2);
  h.run("disconnect(true)");
  await h.advance(60000);
  assert.equal(h.sockets.length, 3);
});

test("frame autoplay unlock without a seek does not leave the sync engine waiting for seeked", () => {
  const h = createHarness({ noPlayer: true });
  const frame = { src: "https://static.crunchyroll.com/vilos-v2/web/vilos/player.html", isConnected: true,
    contentWindow: { postMessage() {} } };
  h.context.crypto = { randomUUID: () => "test-session" };
  h.context.document.querySelectorAll = () => [frame];
  h.run("setupPlayerBridge()");
  const event = new Event("message");
  Object.assign(event, { source: frame.contentWindow, origin: "https://static.crunchyroll.com",
    data: { channel: "watchparty-player", session: "test-session", sequence: 1, type: "unlocking", target: 100, seeking: false } });
  h.context.window.dispatchEvent(event);
  assert.equal(h.state().remoteSeek, null);
  assert.equal(h.state().expectedPlay, true);
});

test("reloading the same iframe starts a fresh bridge session instead of rejecting its reset sequence", () => {
  const h = createHarness({ noPlayer: true });
  const posted = [];
  const frame = Object.assign(new EventTarget(), {
    src: "https://static.crunchyroll.com/vilos-v2/web/vilos/player.html", isConnected: true,
    contentWindow: { postMessage: (data) => posted.push(data) }
  });
  let id = 0;
  h.context.crypto = { randomUUID: () => `session-${++id}` };
  h.context.document.querySelectorAll = () => [frame];
  h.run("setupPlayerBridge()");
  const first = posted.at(-1).session;
  frame.dispatchEvent(new Event("load"));
  assert.notEqual(posted.at(-1).session, first);
});

test("a failed socket send cannot leave local playback locked behind an unacknowledged command", () => {
  const h = createHarness();
  h.run('state.ws.send = () => { throw new Error("socket closed"); }; broadcastControl("pause")');
  assert.equal(h.state().pendingCommandId, 0);
});

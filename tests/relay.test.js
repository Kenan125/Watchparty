const test = require("node:test");
const assert = require("node:assert/strict");
const { startRelay } = require("./helpers/relay-harness");

test("relay serializes controls and gives new joiners one authoritative snapshot", async (t) => {
  const relay = await startRelay();
  t.after(() => relay.stop());
  const alice = await relay.client();
  const welcome = await alice.next((m) => m.type === "welcome");
  assert.equal(welcome.protocol, 2);
  assert.equal(typeof welcome.clientId, "string");
  alice.send({ type: "control", action: "pause", commandId: 1, time: 42, paused: true, buffering: false, rate: 1 });
  const first = await alice.next((m) => m.type === "timeline");
  assert.equal(first.time, 42);
  assert.equal(first.controllerId, welcome.clientId);
  const bob = await relay.client("Bob");
  await bob.next((m) => m.type === "welcome");
  const joined = await bob.next((m) => m.type === "timeline");
  assert.equal(joined.time, 42);
  assert.equal(joined.paused, true);
  assert.equal(joined.revision, first.revision);
  bob.send({ type: "control", action: "seek", commandId: 1, time: 20, paused: false, buffering: false, rate: 1 });
  const next = await alice.next((m) => m.type === "timeline");
  assert.ok(next.time >= 20 && next.time < 20.1);
  assert.ok(next.revision > first.revision);
});

const snapshot = (time, paused = true) => ({ time, paused, buffering: false, rate: 1 });
const barrier = async (client) => {
  client.send({ type: "ping", nonce: 123 });
  return client.next((m) => m.type === "pong" && m.nonce === 123);
};

test("only the current controller's reports are accepted", async (t) => {
  const relay = await startRelay();
  t.after(() => relay.stop());
  const a = await relay.client("Alice");
  await a.next((m) => m.type === "welcome");
  const b = await relay.client("Bob");
  const welcome = await b.next((m) => m.type === "welcome");
  a.send({ type: "control", action: "seek", commandId: 1, ...snapshot(40) });
  await a.next((m) => m.type === "timeline");
  await b.next((m) => m.type === "timeline");
  b.send({ type: "control", action: "seek", commandId: 1, ...snapshot(80) });
  const changed = await a.next((m) => m.type === "timeline");
  await b.next((m) => m.type === "timeline");
  assert.equal(changed.controllerId, welcome.clientId);
  a.send({ type: "report", ...snapshot(41) });
  await barrier(a);
  assert.equal(a.messages.filter((m) => m.type === "timeline").length, 0);
  b.send({ type: "report", ...snapshot(80) });
  const current = await a.next((m) => m.type === "timeline");
  assert.equal(current.time, 80);
  assert.ok(current.revision > changed.revision);
});

test("room membership and episode subscriptions bound playback routing", async (t) => {
  const relay = await startRelay();
  t.after(() => relay.stop());
  const a = await relay.client("Alice");
  await a.next((m) => m.type === "welcome");
  const b = await relay.client("Bob", "test", "/watch/ep2");
  await b.next((m) => m.type === "welcome");
  const outsider = await relay.client("Charlie", "other");
  await outsider.next((m) => m.type === "welcome");
  a.send({ type: "control", action: "seek", commandId: 1, ...snapshot(50) });
  await a.next((m) => m.type === "timeline");
  await Promise.all([barrier(b), barrier(outsider)]);
  assert.equal(b.messages.some((m) => m.type === "timeline"), false);
  assert.equal(outsider.messages.some((m) => m.type === "timeline"), false);
  a.send({ type: "control", action: "seek", commandId: 2, pageKey: "/watch/ep2", ...snapshot(5) });
  await barrier(a);
  assert.equal(a.messages.some((m) => m.type === "timeline"), false);
});

test("controller disconnect elects a ready peer and preserves the timeline", async (t) => {
  const relay = await startRelay();
  t.after(() => relay.stop());
  const a = await relay.client("Alice");
  await a.next((m) => m.type === "welcome");
  a.send({ type: "control", action: "pause", commandId: 1, ...snapshot(42) });
  await a.next((m) => m.type === "timeline");
  const b = await relay.client("Bob");
  const welcome = await b.next((m) => m.type === "welcome");
  await b.next((m) => m.type === "timeline");
  b.send({ type: "ready", snapshot: snapshot(42) });
  await barrier(b);
  a.ws.close();
  const role = await b.next((m) => m.type === "role" && m.controllerId === welcome.clientId);
  assert.equal(role.controllerId, welcome.clientId);
  const handover = await b.next((m) => m.type === "timeline" && m.cause === "handover");
  assert.equal(handover.time, 42);
  b.send({ type: "report", ...snapshot(43) });
  assert.equal((await b.next((m) => m.type === "timeline" && m.cause === "report")).time, 43);
});

test("invalid data and duplicate commands do not corrupt state; names and sender IDs are server assigned", async (t) => {
  const relay = await startRelay();
  t.after(() => relay.stop());
  const a = await relay.client("A".repeat(40));
  const aw = await a.next((m) => m.type === "welcome");
  const b = await relay.client("A".repeat(40));
  const bw = await b.next((m) => m.type === "welcome");
  assert.notEqual(aw.username, bw.username);
  assert.ok(bw.username.length <= 40);
  a.send({ type: "control", action: "seek", commandId: 1, senderId: bw.clientId, username: bw.username, ...snapshot(30) });
  const accepted = await a.next((m) => m.type === "timeline");
  assert.equal(accepted.senderId, aw.clientId);
  assert.equal(accepted.username, aw.username);
  a.send({ type: "control", action: "seek", commandId: 1, ...snapshot(5) });
  a.send({ type: "report", ...snapshot(-5) });
  const invalid = await a.next((m) => m.type === "error");
  assert.equal(invalid.code, "INVALID_SNAPSHOT");
  a.ws.send("null");
  a.ws.send("not JSON");
  await barrier(a);
  assert.equal(a.messages.some((m) => m.type === "timeline"), false);
  const health = await (await fetch(relay.health)).json();
  assert.equal(health.protocol, 2);
  assert.equal(health.rooms, 1);
});

test("rapid controls from different clients receive one total order", async (t) => {
  const relay = await startRelay();
  t.after(() => relay.stop());
  const a = await relay.client("Alice");
  await a.next((m) => m.type === "welcome");
  const b = await relay.client("Bob");
  await b.next((m) => m.type === "welcome");
  for (let i = 1; i <= 30; i++) {
    a.send({ type: "control", action: "seek", commandId: i, ...snapshot(i) });
    b.send({ type: "control", action: "seek", commandId: i, ...snapshot(i + 100) });
  }
  const left = [];
  const right = [];
  for (let i = 0; i < 60; i++) {
    left.push(await a.next((m) => m.type === "timeline"));
    right.push(await b.next((m) => m.type === "timeline"));
  }
  assert.deepEqual(left.map((m) => [m.revision, m.time]), right.map((m) => [m.revision, m.time]));
  assert.equal(new Set(left.map((m) => m.revision)).size, 60);
  assert.ok(left.every((m, i) => !i || m.revision > left[i - 1].revision));
});

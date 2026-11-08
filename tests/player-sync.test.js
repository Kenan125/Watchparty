const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarness } = require("./helpers/player-harness");

test("a delayed paused snapshot stays at the exact paused position", () => {
  const h = createHarness({ paused: true });
  h.context.snapshot = { type: "timeline", revision: 1, controllerId: "bob", senderId: "bob", pageKey: "/watch/ep1", time: 42, paused: true, serverTime: h.now() - 3000, timestamp: h.now() - 3000, username: "Bob" };
  h.run("applySyncSnapshot(snapshot)");
  assert.equal(h.player.currentTime, 42);
  assert.equal(h.player.paused, true);
});

test("a slow remote backward seek never echoes a new control or fabricates media events", async () => {
  const h = createHarness({ paused: false, seekDelay: 1600 });
  h.context.control = { type: "timeline", revision: 1, controllerId: "bob", senderId: "bob", cause: "seek", pageKey: "/watch/ep1", time: 20, paused: false, serverTime: h.now(), timestamp: h.now(), username: "Bob" };
  h.run("applySyncSnapshot(control)");
  await h.advance(2200);
  assert.equal(h.sent.filter((m) => m.type === "control").length, 0, "remote native seeked must not bounce back to the room");
  assert.equal(h.player.syntheticEvents, 0, "only the browser should dispatch media lifecycle events");
  assert.ok(h.player.currentTime >= 20 && h.player.currentTime < 22);
});

test("a local scrub takes control and resumes fresh reports after its acknowledgement", async () => {
  const h = createHarness();
  h.run('state.clientId = "alice"');
  h.player.currentTime = 250;
  await h.advance(200);
  const controls = h.sent.filter((m) => m.type === "control");
  assert.equal(controls.length, 1);
  assert.equal(controls[0].action, "seek");
  assert.equal(controls[0].commandId, 1);
  h.deliver({ type: "timeline", pageKey: "/watch/ep1", revision: 1, controllerId: "alice", senderId: "alice", commandId: 1, time: 250, paused: false, buffering: false, rate: 1, serverTime: h.now(), cause: "seek" });
  h.run("publishSnapshot(true)");
  assert.equal(h.sent.filter((m) => m.type === "report").length, 1);
  assert.equal(h.player.seeks.length, 1, "acknowledgement must not seek the sender backward");
});

test("periodic reports do not retry policy-blocked autoplay; a later pause cancels unlock", async () => {
  const h = createHarness({ paused: true });
  h.player.playError = Object.assign(new Error("gesture required"), { name: "NotAllowedError" });
  h.timeline({ cause: "play" });
  await h.advance(10);
  assert.equal(h.state().pendingAutoResume, true);
  const attempts = h.player.playCalls;
  h.timeline({ revision: 2, time: 101 });
  await h.advance(10);
  assert.equal(h.player.playCalls, attempts, "wait for a user gesture instead of retrying on every report");
  assert.equal(h.context.testUi.resumeButton.hidden, false);
  h.timeline({ revision: 3, time: 101, paused: true, cause: "pause" });
  assert.equal(h.state().pendingAutoResume, false);
  h.player.playError = null;
  h.run("setupAutoResumeUnlock(); ui.resumeButton.dispatchEvent(new Event('click'))");
  await h.advance(10);
  assert.equal(h.player.paused, true);
  assert.equal(h.player.muted, false);
});

test("the controller recovering from buffering does not pause itself against its own report", () => {
  const h = createHarness({ paused: false });
  h.timeline({ senderId: "alice", controllerId: "alice", buffering: true });
  h.player.emit("canplay");
  assert.equal(h.player.paused, false);
  assert.equal(h.sent.filter((m) => m.type === "report").at(-1).buffering, false);
});

test("reports correct sub-second position errors while paused", async () => {
  const h = createHarness({ paused: true, time: 100.8 });
  h.timeline({ paused: true, time: 100 });
  await h.advance(100);
  assert.equal(h.player.currentTime, 100);
});

test("a replaced controller video restores the room position before reporting", async () => {
  const h = createHarness({ paused: true, time: 100 });
  h.timeline({ senderId: "alice", controllerId: "alice", paused: true });
  const replacement = h.replacePlayer();
  replacement.position = 0;
  h.run("attachPlayerListeners()");
  await h.advance(100);
  assert.equal(replacement.currentTime, 100);
  assert.equal(replacement.paused, true);
});

test("buffering followers are not repeatedly sought while waiting for media data", () => {
  const h = createHarness({ readyState: 2, time: 90, paused: false });
  h.timeline({ cause: "report", time: 100 });
  h.timeline({ revision: 2, time: 101 });
  h.timeline({ revision: 3, time: 102 });
  assert.equal(h.player.seeks.length, 0);
  assert.equal(h.player.pauseCalls, 0);
  h.player.readyState = 4;
  h.player.emit("canplay");
  assert.equal(h.player.seeks.length, 1);
});

test("old revisions and different episodes cannot move the local player", () => {
  const h = createHarness({ paused: true });
  h.timeline({ revision: 10, paused: true, time: 100 });
  h.timeline({ revision: 9, paused: true, time: 20 });
  h.timeline({ revision: 11, pageKey: "/watch/ep2", paused: true, time: 30 });
  assert.equal(h.player.currentTime, 100);
  assert.equal(h.state().lastRevision, 10);
});

test("latency is counted once and projection uses monotonic elapsed time", async () => {
  const h = createHarness({ paused: false });
  h.run("state.clockOffset = 600000");
  h.timeline({ time: 100, serverTime: h.now() + 599800 });
  await h.advance(2000);
  assert.ok(Math.abs(h.run("timelinePosition()") - 102.2) < 0.001);
});

test("local scrubbing wins over reports received before the control acknowledgement", async () => {
  const h = createHarness({ paused: false });
  h.timeline({ time: 100 });
  h.player.currentTime = 300;
  await h.advance(10);
  h.timeline({ revision: 2, time: 101 });
  assert.equal(h.player.currentTime, 300);
  await h.advance(180);
  h.timeline({ revision: 3, time: 102 });
  assert.ok(h.player.currentTime >= 300);
  assert.equal(h.sent.filter((m) => m.type === "control").length, 1);
});

test("expired timeline references never rewind an advancing player", async () => {
  const h = createHarness({ paused: false });
  h.timeline();
  await h.advance(30000);
  const before = h.player.currentTime;
  h.run("reconcilePlayer(false)");
  assert.equal(h.player.currentTime, before);
  assert.equal(h.player.seeks.length, 0);
  assert.equal(h.player.playbackRate, 1);
});

test("the latest snapshot survives a player that has not loaded metadata", async () => {
  const h = createHarness({ readyState: 0, paused: true });
  h.timeline({ paused: true, time: 20 });
  h.timeline({ revision: 2, paused: true, time: 50 });
  assert.equal(h.player.seeks.length, 0);
  h.player.readyState = 4;
  h.player.emit("loadedmetadata");
  await h.advance(100);
  assert.equal(h.player.currentTime, 50);
  assert.equal(h.sent.filter((m) => m.type === "control").length, 0);
});

test("a multi-second native seek resumes instead of chasing a moving target with endless seeks", async () => {
  const h = createHarness({ paused: true, seekDelay: 4000 });
  h.timeline({ cause: "seek", time: 20 });
  await h.advance(4100);
  assert.equal(h.player.paused, false, "finish the seek and start playback before correcting its unavoidable loading delay");
  assert.equal(h.player.seeks.length, 1);
  h.timeline({ revision: 2, cause: "report", time: 25 });
  assert.equal(h.player.seeks.length, 1, "fresh drift reports should converge gently after an expensive seek");
  assert.equal(h.sent.filter((m) => m.type === "control").length, 0);
});

test("a user pause during a local seek is preserved in the completed seek command", async () => {
  const h = createHarness({ paused: false, seekDelay: 500 });
  h.player.currentTime = 250;
  await h.advance(10);
  h.player.pause();
  await h.advance(650);
  const controls = h.sent.filter((m) => m.type === "control");
  assert.equal(controls.length, 1);
  assert.equal(controls[0].paused, true);
  assert.equal(h.player.paused, true);
});

test("a ready replacement controller resumes the playing intent when the previous controller left while buffering", async () => {
  const h = createHarness({ paused: true, readyState: 4 });
  h.timeline({ cause: "handover", senderId: "bob", controllerId: "alice", buffering: true, paused: false });
  await h.advance(100);
  assert.equal(h.player.paused, false);
  h.run("publishSnapshot(true)");
  assert.equal(h.sent.filter((m) => m.type === "report").at(-1).buffering, false);
});

test("Crunchyroll autoplay during a remote seek cannot take control or stop fresh synchronization", async () => {
  const h = createHarness({ paused: true, seekDelay: 1600 });
  h.timeline({ cause: "join", time: 20 });
  await h.advance(200);
  await h.player.play();
  await h.advance(2000);
  assert.equal(h.sent.filter((m) => m.type === "control").length, 0, "native autoplay is part of the remote seek, not a new user play");
  assert.equal(h.state().remoteSeek, null);
  assert.equal(h.player.paused, false);
});

test("a seek debounce that expires while media is unready does not lock out later snapshots", async () => {
  const h = createHarness({ paused: true });
  h.timeline({ paused: true });
  h.player.currentTime = 250;
  await h.advance(60);
  h.player.readyState = 0;
  await h.advance(120);
  assert.equal(h.sent.filter((m) => m.type === "control").length, 0);
  h.player.readyState = 4;
  h.timeline({ revision: 2, paused: true, time: 200 });
  await h.advance(100);
  assert.equal(h.player.currentTime, 200, "a completed debounce must not permanently block reconciliation");
  assert.equal(h.state().pendingSeekTimer, null);
});

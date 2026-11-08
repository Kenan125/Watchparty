const { test, expect } = require("@playwright/test");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");
const { startRelay } = require("../helpers/relay-harness");

const root = path.resolve(__dirname, "../..");
let relay;
let web;
let origin;
const failures = [];

test.beforeAll(async () => {
  relay = await startRelay();
  const media = fs.readFileSync(path.join(root, "tests/fixtures/video.webm"));
  web = http.createServer((req, res) => {
    if (req.url.split("?")[0] === "/video.webm") {
      const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
      const start = range ? Number(range[1]) : 0;
      const end = range?.[2] ? Number(range[2]) : media.length - 1;
      res.writeHead(range ? 206 : 200, { "content-type": "video/webm", "accept-ranges": "bytes", "content-length": end - start + 1,
        ...(range ? { "content-range": `bytes ${start}-${end}/${media.length}` } : {}) });
      res.end(media.subarray(start, end + 1));
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end('<!doctype html><html><body><div class="header-actions"></div><video controls preload="auto" src="/video.webm"></video></body></html>');
  });
  web.listen(0, "127.0.0.1");
  await once(web, "listening");
  origin = `http://127.0.0.1:${web.address().port}`;
});

test.afterAll(async () => {
  await relay?.stop();
  await new Promise((resolve) => web.close(resolve));
});

async function partyPage(context, name, room) {
  const page = await context.newPage();
  page.on("pageerror", (error) => failures.push(`${name}: ${error.message}`));
  await page.goto(`${origin}/watch/EP1/episode`);
  await page.waitForFunction(() => document.querySelector("video").readyState >= 3);
  await page.evaluate(() => {
    window.chrome = { runtime: { onMessage: { addListener() {} } }, storage: { local: { get: async () => ({}), set: async () => {} } } };
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  for (const script of manifest.content_scripts[0].js) await page.addScriptTag({ path: path.join(root, script) });
  await page.evaluate(({ serverUrl, username, room }) => connect({ serverUrl, username, room }), { serverUrl: relay.url, username: name, room });
  await page.waitForFunction(() => state.connected && state.timeline);
  return page;
}

async function mediaState(page) {
  return page.evaluate(() => ({ time: state.player.currentTime, paused: state.player.paused,
    rate: state.player.playbackRate, revision: state.lastRevision, controllerId: state.controllerId,
    localSeeking: state.localSeeking, remoteSeek: state.remoteSeek, pending: state.pendingCommandId }));
}

async function expectAligned(a, b, paused) {
  await expect.poll(async () => {
    const [left, right] = await Promise.all([mediaState(a), mediaState(b)]);
    return left.paused === paused && right.paused === paused && Math.abs(left.time - right.time) < 0.65;
  }, { message: "players should have the same playback state and be within 650ms", timeout: 7000 }).toBe(true);
}

test("native media + real WebSockets: play, forward/backward seek, pause, and late join", async ({ context }) => {
  failures.length = 0;
  const alice = await partyPage(context, "Alice", "native-media");
  const bob = await partyPage(context, "Bob", "native-media");
  await alice.evaluate(() => state.player.play());
  await expectAligned(alice, bob, false);
  await alice.evaluate(() => { state.player.currentTime = 50; });
  await expect.poll(async () => (await mediaState(bob)).time).toBeGreaterThan(49);
  await expectAligned(alice, bob, false);
  await bob.evaluate(() => { state.player.currentTime = 10; });
  await expect.poll(async () => (await mediaState(alice)).time).toBeLessThan(15);
  await expectAligned(alice, bob, false);
  await bob.evaluate(() => state.player.pause());
  await expectAligned(alice, bob, true);
  const pausedTime = (await mediaState(alice)).time;
  const charlie = await partyPage(context, "Charlie", "native-media");
  await expectAligned(alice, charlie, true);
  expect(Math.abs((await mediaState(alice)).time - pausedTime)).toBeLessThan(0.15);
  await charlie.evaluate(() => state.player.play());
  await expectAligned(alice, bob, false);
  await expectAligned(alice, charlie, false);
  expect(failures).toEqual([]);
});

test("steady playback stays aligned beyond the old ten-second reference cap, then reconnects", async ({ context }) => {
  failures.length = 0;
  const a = await partyPage(context, "Alice", "long-playback");
  const b = await partyPage(context, "Bob", "long-playback");
  await a.evaluate(() => state.player.play());
  await expectAligned(a, b, false);
  for (const page of [a, b]) await page.evaluate(() => {
    window.observedControls = [];
    const original = sendMessage;
    sendMessage = (data) => {
      if (data.type === "control") window.observedControls.push(data);
      return original(data);
    };
  });
  const start = await mediaState(b);
  await expect.poll(async () => (await mediaState(b)).time, { timeout: 18000 }).toBeGreaterThan(start.time + 12);
  await expectAligned(a, b, false);
  expect(await b.evaluate(() => window.observedControls)).toEqual([]);
  await b.evaluate(() => state.ws.close());
  await b.waitForFunction(() => !state.connected);
  await b.waitForFunction(() => state.connected && state.timeline);
  await expectAligned(a, b, false);
  expect(failures).toEqual([]);
});

test("native SPA episode changes isolate timelines and rejoin the existing episode safely", async ({ context }) => {
  failures.length = 0;
  const a = await partyPage(context, "Alice", "episodes");
  const b = await partyPage(context, "Bob", "episodes");
  await a.evaluate(() => { state.player.currentTime = 42; });
  await expectAligned(a, b, true);
  const navigate = async (page, episode) => {
    await page.evaluate((episode) => {
      history.pushState({}, "", `/watch/${episode}/episode`);
      updatePageContext();
      state.player.src = `/video.webm?episode=${episode}`;
      state.player.load();
    }, episode);
    await page.waitForFunction((episode) => state.player.readyState >= 3 && state.timeline?.pageKey === `/watch/${episode.toLowerCase()}`, episode);
  };
  await navigate(b, "EP2");
  await b.evaluate(() => { state.player.currentTime = 10; });
  await expect.poll(async () => (await mediaState(b)).pending).toBe(0);
  expect((await mediaState(a)).time).toBeCloseTo(42, 0);
  await navigate(b, "EP1");
  await expectAligned(a, b, true);
  expect((await mediaState(a)).time).toBeCloseTo(42, 0);
  expect(failures).toEqual([]);
});

test("replacing the controller's native video does not reset everybody to zero", async ({ context }) => {
  failures.length = 0;
  const a = await partyPage(context, "Alice", "replacement");
  const b = await partyPage(context, "Bob", "replacement");
  await a.evaluate(() => { state.player.currentTime = 35; });
  await expect.poll(async () => (await mediaState(b)).time).toBeGreaterThan(34);
  await a.evaluate(() => {
    const old = state.player;
    const replacement = document.createElement("video");
    replacement.src = "/video.webm";
    replacement.controls = true;
    old.replaceWith(replacement);
  });
  await a.waitForFunction(() => state.player?.isConnected && state.player.readyState >= 3);
  await expectAligned(a, b, true);
  expect((await mediaState(b)).time).toBeCloseTo(35, 0);
  expect(failures).toEqual([]);
});

const { test, expect, chromium } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { startRelay } = require("../helpers/relay-harness");
const { packageExtension } = require("../../scripts/package-extension");

const root = path.resolve(__dirname, "../..");

async function withoutGesture(context, frame, expression) {
  // Playwright evaluate() sets CDP userGesture=true, which masks autoplay bugs.
  let session;
  let contextId;
  try { session = await context.newCDPSession(frame); }
  catch {
    session = await context.newCDPSession(frame.page());
    const contexts = [];
    session.on("Runtime.executionContextCreated", ({ context }) => contexts.push(context));
    await session.send("Runtime.enable");
    contextId = contexts.find((entry) => entry.auxData?.isDefault && entry.origin === new URL(frame.url()).origin)?.id;
    if (!contextId) throw new Error("Embedded player's default execution context not found");
  }
  try {
    const response = await session.send("Runtime.evaluate", { expression, contextId, userGesture: false, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result.value;
  } finally { await session.detach(); }
}

for (const strictAutoplay of [false, true]) {
test(`unpacked MV3 cross-origin sync${strictAutoplay ? " with real autoplay blocking and frame-local unlock" : ""}`, async () => {
  const relay = await startRelay();
  const extensionRoot = packageExtension();
  const profile = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "watchparty-browser-"));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: true, executablePath: chromium.executablePath(),
      args: [`--disable-extensions-except=${extensionRoot}`, `--load-extension=${extensionRoot}`, `--autoplay-policy=${strictAutoplay ? "document-user-activation-required" : "no-user-gesture-required"}`]
    });
    await context.grantPermissions(["local-network-access"], { origin: "https://www.crunchyroll.com" });
    const media = fs.readFileSync(path.join(root, "tests/fixtures/video.webm"));
    await context.route("https://www.crunchyroll.com/**", (route) => route.fulfill({ contentType: "text/html",
      body: '<!doctype html><html><body><div class="header-actions"></div><iframe allow="autoplay" src="https://static.crunchyroll.com/vilos-v2/web/vilos/player.html"></iframe></body></html>' }));
    await context.route("https://static.crunchyroll.com/**", (route) => {
      if (route.request().url().endsWith("video.webm")) {
        const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
        const start = range ? Number(range[1]) : 0;
        const end = range?.[2] ? Number(range[2]) : media.length - 1;
        return route.fulfill({ status: range ? 206 : 200, contentType: "video/webm", headers: {
          "accept-ranges": "bytes", "content-length": String(end - start + 1),
          ...(range ? { "content-range": `bytes ${start}-${end}/${media.length}` } : {})
        }, body: media.subarray(start, end + 1) });
      }
      return route.fulfill({ contentType: "text/html", headers: strictAutoplay ? { "permissions-policy": "autoplay=()" } : {}, body: '<!doctype html><html><body><button onclick="document.querySelector(\'video\').play()">Start fixture</button><video controls preload="auto" src="https://static.crunchyroll.com/video.webm"></video></body></html>' });
    });
    const invite = Buffer.from(JSON.stringify({ v: 3, room: "real-extension", serverUrl: relay.url })).toString("base64");
    const url = `https://www.crunchyroll.com/watch/EP1/episode?wp=${encodeURIComponent(invite)}`;
    const a = await context.newPage();
    const b = await context.newPage();
    a.on("console", (message) => { if (message.type() === "error") console.log(message.text()); });
    await a.goto(url);
    await expect(a.locator("#wp-connection")).toContainText("Online");
    await b.goto(url);
    await expect(b.locator("#wp-connection")).toContainText("Online");
    const af = a.frames().find((frame) => frame.url().includes("static.crunchyroll.com"));
    const bf = b.frames().find((frame) => frame.url().includes("static.crunchyroll.com"));
    const arun = (expression) => withoutGesture(context, af, expression);
    const brun = (expression) => withoutGesture(context, bf, expression);
    const unlockVisible = () => brun('[...document.querySelectorAll("button")].some(button => button.textContent === "Enable WatchParty playback" && !button.hidden)');
    await expect.poll(() => arun('document.querySelector("video").readyState')).toBeGreaterThanOrEqual(3);
    await expect.poll(() => brun('document.querySelector("video").readyState')).toBeGreaterThanOrEqual(3);
    await arun('document.querySelector("video").currentTime = 30');
    await expect.poll(() => brun('document.querySelector("video").currentTime'), { timeout: 7000 }).toBeGreaterThan(29);
    if (strictAutoplay) {
      await af.getByRole("button", { name: "Start fixture" }).click();
      await expect.poll(unlockVisible).toBe(true);
      await arun('document.querySelector("video").pause()');
      await expect.poll(unlockVisible).toBe(false);
      await af.getByRole("button", { name: "Start fixture" }).click();
      await expect.poll(unlockVisible).toBe(true);
      await bf.getByRole("button", { name: "Enable WatchParty playback" }).click();
    } else {
      await arun('document.querySelector("video").play()');
    }
    await expect.poll(() => brun('document.querySelector("video").paused')).toBe(false);
    await brun('document.querySelector("video").currentTime = 5');
    await expect.poll(() => arun('document.querySelector("video").currentTime')).toBeLessThan(10);
    await brun('document.querySelector("video").pause()');
    await expect.poll(() => arun('document.querySelector("video").paused')).toBe(true);
    expect(await a.locator("#wp-root").count()).toBe(1);
    expect(await af.locator("#wp-root").count()).toBe(0);
  } finally {
    await context?.close();
    await relay.stop();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
}

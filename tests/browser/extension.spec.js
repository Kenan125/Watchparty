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
  const profile = fs.mkdtempSync(path.join(process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "hermes/cache/scratch") : (process.env.TMPDIR || os.tmpdir()), "watchparty-browser-"));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: true, executablePath: chromium.executablePath(),
      args: [`--disable-extensions-except=${extensionRoot}`, `--load-extension=${extensionRoot}`, `--autoplay-policy=${strictAutoplay ? "document-user-activation-required" : "no-user-gesture-required"}`]
    });
    await context.grantPermissions(["local-network-access"], { origin: "https://www.crunchyroll.com" });
    const media = fs.readFileSync(path.join(root, "tests/fixtures/video.webm"));
    await context.route("https://www.crunchyroll.com/**", (route) => route.fulfill({ contentType: "text/html",
      body: '<!doctype html><html><body><div class="header-actions"></div><iframe width="1100" height="620" allow="autoplay; fullscreen" src="https://static.crunchyroll.com/vilos-v2/web/vilos/player.html"></iframe></body></html>' }));
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
      return route.fulfill({ contentType: "text/html", headers: strictAutoplay ? { "permissions-policy": "autoplay=()" } : {}, body: '<!doctype html><html><body><div class="video-player-wrapper" style="position:relative;height:580px;background:#080c15"><button onclick="document.querySelector(\'video\').play()">Start fixture</button><button id="fixture-fullscreen" onclick="document.querySelector(\'.video-player-wrapper\').requestFullscreen()">Fullscreen</button><video style="display:block;width:100%;height:500px" controls preload="auto" src="https://static.crunchyroll.com/video.webm"></video></div></body></html>' });
    });
    const invite = Buffer.from(JSON.stringify({ v: 3, room: "real-extension", serverUrl: relay.url })).toString("base64");
    const url = `https://www.crunchyroll.com/watch/EP1/episode?wp=${encodeURIComponent(invite)}`;
    const a = await context.newPage();
    const b = await context.newPage();
    a.on("console", (message) => { if (message.type() === "error") console.log(message.text()); });
    await a.goto(`${url}#alice`);
    await b.goto(`${url}#bob`);
    const af = a.frames().find((frame) => frame.url().includes("static.crunchyroll.com"));
    const bf = b.frames().find((frame) => frame.url().includes("static.crunchyroll.com"));
    const arun = (expression) => withoutGesture(context, af, expression);
    const brun = (expression) => withoutGesture(context, bf, expression);
    const unlockVisible = () => brun('Boolean(document.getElementById("wp-player-unlock") && !document.getElementById("wp-player-unlock").hidden)');
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
    // Worker evaluate/runtime messages can activate recipient frames; keep them
    // after the strict gesture-free playback assertions above.
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    expect(await worker.evaluate(() => chrome.sidePanel.getPanelBehavior())).toEqual({ openPanelOnActionClick: true });
    expect(await worker.evaluate(() => chrome.sidePanel.getOptions({}))).toMatchObject({ path: "panel.html", enabled: true });
    const tabs = await worker.evaluate(() => chrome.tabs.query({ url: "https://www.crunchyroll.com/*" }));
    const aId = tabs.find((tab) => tab.url.endsWith("#alice")).id;
    const bId = tabs.find((tab) => tab.url.endsWith("#bob")).id;
    // Do not forward Playwright evaluate's synthetic gesture through runtime messaging.
    const status = (tabId) => worker.evaluate((id) => new Promise((resolve) => {
      setTimeout(() => chrome.tabs.sendMessage(id, { type: "WP_STATUS_REQUEST" }, { frameId: 0 }).then(resolve), 0);
    }), tabId);
    await expect.poll(async () => (await status(aId)).userCount).toBe(2);
    await expect.poll(async () => (await status(bId)).userCount).toBe(2);
    // No chat UI, launcher or panel stylesheet is injected into either streaming document.
    for (const page of [a, b]) {
      await expect(page.locator('#wp-root, #wp-launcher, iframe[data-wp-panel], link[href*="content.css"]')).toHaveCount(0);
    }
    for (const frame of [af, bf]) {
      await expect(frame.locator('#wp-root, #wp-launcher, iframe[data-wp-panel], link[href*="content.css"]')).toHaveCount(0);
    }
    if (!strictAutoplay) {
      // Headless Playwright exercises the real extension document + tabs.connect
      // transport here, not Chrome's native Side Panel shell or toolbar gesture.
      const panelUrl = `chrome-extension://${new URL(worker.url()).host}/panel.html`;
      let panel = await context.newPage();
      await panel.goto(panelUrl);
      const activate = (id) => worker.evaluate((tabId) => chrome.tabs.update(tabId, { active: true }), id);
      await activate(aId);
      await expect(panel.locator("#wp-connection")).toContainText("Online");
      await expect(panel.locator("#wp-user-count")).toHaveText("2 watching");
      await panel.locator("#wp-chat-input").fill("Native panel chat <img src=x onerror=alert(1)>");
      await panel.getByRole("button", { name: "Send message", exact: true }).click();
      await expect(panel.locator(".wp-message")).toHaveCount(1);
      await panel.getByRole("button", { name: "Switch to light mode", exact: true }).click();
      await expect(panel.locator("#wp-root")).toHaveAttribute("data-wp-theme", "light");
      await activate(bId);
      await expect(panel.locator(".wp-message-own")).toHaveCount(0);
      await expect(panel.locator(".wp-message")).toHaveCount(1);
      await expect(panel.locator("#wp-chat")).toContainText("Native panel chat <img src=x onerror=alert(1)>");
      await expect(panel.locator("#wp-chat img")).toHaveCount(0);
      await expect(panel.locator("#wp-root")).toHaveAttribute("data-wp-theme", "light");
      await panel.locator("#wp-chat-input").fill("Reply from Bob's tab");
      await panel.getByRole("button", { name: "Send message", exact: true }).click();
      await activate(aId);
      await expect(panel.locator(".wp-message")).toHaveCount(2);
      await expect(panel.locator("#wp-chat")).toContainText("Reply from Bob's tab");
      await expect(panel.locator(".wp-message-own")).toHaveCount(1);
      await Promise.all([panel.waitForEvent("close"), panel.getByRole("button", { name: "Close chat", exact: true }).click()]);
      expect((await status(aId)).connected).toBe(true);
      expect((await status(bId)).connected).toBe(true);
      await arun('document.querySelector("video").currentTime = 20');
      await expect.poll(() => brun('document.querySelector("video").currentTime')).toBeGreaterThan(19);
      panel = await context.newPage();
      await panel.goto(panelUrl);
      await activate(aId);
      await expect(panel.locator(".wp-message")).toHaveCount(2);
      await expect(panel.locator("#wp-root")).toHaveAttribute("data-wp-theme", "light");
    }
  } finally {
    await context?.close();
    await relay.stop();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
}

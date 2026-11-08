const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../..");

function createHarness(options = {}) {
  let now = 100000;
  let nextId = 1;
  const timers = new Map();
  const sent = [];
  const videos = [];
  const sockets = [];
  const window = new EventTarget();
  const schedule = (fn, delay = 0, interval = 0) => {
    const id = nextId++;
    timers.set(id, { fn, at: now + delay, interval });
    return id;
  };
  class Video extends EventTarget {
    constructor() {
      super();
      this.position = options.time ?? 100;
      this.paused = options.paused ?? false;
      this.readyState = options.readyState ?? 4;
      this.duration = 1500;
      this.playbackRate = 1;
      this.muted = false;
      this.seeking = false;
      this.ended = false;
      this.isConnected = true;
      this.dataset = {};
      this.seeks = [];
      this.playCalls = 0;
      this.pauseCalls = 0;
      this.seekDelay = options.seekDelay ?? 50;
      this.playError = null;
      this.syntheticEvents = 0;
      videos.push(this);
    }
    get currentTime() { return this.position; }
    set currentTime(value) {
      this.position = value;
      this.seeks.push(value);
      this.seeking = true;
      schedule(() => this.emit("seeking"));
      if (this.seekTimer) timers.delete(this.seekTimer);
      this.seekTimer = schedule(() => {
        this.seeking = false;
        this.emit("seeked");
      }, this.seekDelay);
    }
    emit(type) { super.dispatchEvent(new Event(type)); }
    dispatchEvent(event) {
      this.syntheticEvents++;
      return super.dispatchEvent(event);
    }
    play() {
      this.playCalls++;
      if (this.playError) return Promise.reject(this.playError);
      if (this.paused) {
        this.paused = false;
        schedule(() => this.emit("play"));
      }
      return Promise.resolve();
    }
    pause() {
      this.pauseCalls++;
      if (!this.paused) {
        this.paused = true;
        schedule(() => this.emit("pause"));
      }
    }
  }
  let player = options.noPlayer ? null : new Video();
  class Socket extends EventTarget {
    static OPEN = 1;
    constructor(url) { super(); this.url = url; this.readyState = 0; sockets.push(this); }
    send(raw) { sent.push(JSON.parse(raw)); }
    open() { this.readyState = 1; this.dispatchEvent(new Event("open")); }
    close() {
      this.readyState = 3;
      schedule(() => this.dispatchEvent(new Event("close")));
    }
  }
  const document = Object.assign(new EventTarget(), {
    title: "Episode",
    contains: (p) => p.isConnected,
    querySelector: (selector) => selector === "video" ? player : null,
    querySelectorAll: (selector) => selector === "video" && player ? [player] : []
  });
  class Element extends EventTarget {
    constructor(tagName) {
      super();
      this.tagName = tagName.toUpperCase();
      this.attributes = new Map();
      this.parentNode = null;
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    appendChild(child) { child.parentNode = this; return child; }
    remove() { this.parentNode = null; }
    dispatchEvent(event) {
      const result = super.dispatchEvent(event);
      if (event.bubbles && this.parentNode) {
        Object.defineProperty(event, "target", { value: this, configurable: true });
        document.dispatchEvent(event);
      }
      return result;
    }
  }
  document.createElement = (tagName) => new Element(tagName);
  document.documentElement = new Element("html");
  const context = vm.createContext({
    console, URL, Event, EventTarget, AbortController, btoa, performance: { now: () => now },
    Date: class extends Date { static now() { return now; } },
    location: { href: "https://www.crunchyroll.com/watch/EP1/title", pathname: "/watch/EP1/title" },
    document, Element,
    window,
    chrome: {
      runtime: {
        id: "test-extension",
        getURL: (file) => `chrome-extension://test-extension/${file}`,
        onConnect: { addListener() {} },
        onMessage: { addListener() {} }
      },
      storage: {
        local: { set: async () => {}, get: async () => ({}) },
        onChanged: { addListener() {} }
      }
    },
    setTimeout: (fn, ms) => schedule(fn, ms), clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, ms) => schedule(fn, ms, ms), clearInterval: (id) => timers.delete(id),
    WebSocket: Socket
  });
  const run = (source) => vm.runInContext(source, context);
  for (const file of ["content/player-controls-main.js", "content/shared.js", "content/player-controls.js", "content/player-bridge.js", "content/side-panel.js", "content/network.js", "content/player-sync.js"]) {
    vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
  }
  context.testSent = sent;
  run(`state.connected = true; state.clientId = "alice"; state.room = "test"; state.username = "Alice";
    state.ws = { readyState: 1, send: (raw) => testSent.push(JSON.parse(raw)), close() {} };`);
  run("attachPlayerListeners()");
  const advance = async (ms) => {
    const end = now + ms;
    let count = 0;
    while (true) {
      const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      const next = due ? due[1].at : end;
      const elapsed = (next - now) / 1000;
      for (const video of videos) {
        if (!video.paused && !video.seeking && video.readyState >= 3) video.position += elapsed * video.playbackRate;
      }
      now = next;
      if (!due) break;
      if (++count > 10000) throw new Error("Timer feedback loop");
      const [id, timer] = due;
      timers.delete(id);
      if (timer.interval) timers.set(id, { ...timer, at: now + timer.interval });
      timer.fn();
      await Promise.resolve();
    }
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  return { context, run, sent, sockets, advance, now: () => now,
    get player() { return player; },
    replacePlayer() { if (player) player.isConnected = false; player = new Video(); return player; },
    deliver(data) { context.incoming = data; run("handleSocketMessage(JSON.stringify(incoming))"); },
    timeline(data = {}) {
      context.incoming = { type: "timeline", pageKey: "/watch/ep1", revision: 1, controllerId: "bob", senderId: "bob",
        time: 100, paused: false, buffering: false, rate: 1, cause: "report", serverTime: now, ...data };
      run("handleSocketMessage(JSON.stringify(incoming))");
    },
    state: () => run("state") };
}

module.exports = { createHarness, root };

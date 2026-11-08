// The top frame owns the room. The cross-origin frame only exposes media operations.
let framePlayer = null;
let playerFrame = null;
let playerFrameSession = null;
let frameCommandId = 0;
let frameSequence = 0;
let frameListenerAbort = null;
const frameCalls = new Map();

function frameCommand(action, extra = {}, wait = false) {
  const id = ++frameCommandId;
  if (!playerFrame?.isConnected) return wait ? Promise.reject(Object.assign(new Error("Player frame is gone"), { name: "AbortError" })) : null;
  let result = null;
  if (wait) result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      frameCalls.delete(id);
      reject(Object.assign(new Error("Player frame timed out"), { name: "AbortError" }));
    }, 5000);
    frameCalls.set(id, { resolve, reject, timer });
  });
  if (["seek", "play", "pause", "rate"].includes(action) && framePlayer) framePlayer.lastMutationId = id;
  playerFrame.contentWindow.postMessage({ channel: "watchparty-player", type: "command", session: playerFrameSession, id, action, ...extra }, "https://static.crunchyroll.com");
  return result;
}

class FramePlayer extends EventTarget {
  constructor(videoId, media) {
    super();
    this.videoId = videoId;
    this.media = media;
    this.receivedAt = performance.now();
    this.lastMutationId = 0;
  }
  get isConnected() { return Boolean(playerFrame?.isConnected && framePlayer === this); }
  get currentTime() {
    const moving = !this.media.paused && !this.media.seeking && this.media.readyState >= 3;
    return this.media.time + (moving ? (performance.now() - this.receivedAt) / 1000 * this.media.rate : 0);
  }
  set currentTime(value) {
    this.seekTo(value);
  }
  seekTo(value) {
    this.media.time = value;
    this.receivedAt = performance.now();
    this.media.seeking = true;
    frameCommand("seek", { value });
  }
  get paused() { return this.media.paused; }
  get seeking() { return this.media.seeking; }
  get ended() { return this.media.ended; }
  get readyState() { return this.media.readyState; }
  get duration() { return this.media.duration === null ? Infinity : this.media.duration; }
  get playbackRate() { return this.media.rate; }
  set playbackRate(value) {
    this.media.time = this.currentTime;
    this.receivedAt = performance.now();
    this.media.rate = value;
    frameCommand("rate", { value });
  }
  play() { return frameCommand("play", {}, true); }
  pause() {
    this.media.time = this.currentTime;
    this.receivedAt = performance.now();
    this.media.paused = true;
    frameCommand("pause");
  }
  setPlaybackIntent(playing, time, rate) { frameCommand("intent", { playing, time, rate }); }
  showUnlock() { frameCommand("show-unlock"); }
}

function getFramePlayer() {
  return framePlayer?.isConnected ? framePlayer : null;
}

function setupPlayerBridge() {
  const resetSession = () => {
    for (const call of frameCalls.values()) {
      clearTimeout(call.timer);
      call.reject(Object.assign(new Error("Player frame replaced"), { name: "AbortError" }));
    }
    frameCalls.clear();
    framePlayer = null;

    playerFrameSession = crypto.randomUUID();
    frameCommandId = 0;
    frameSequence = 0;
    attachPlayerListeners();
    playerFrame?.contentWindow.postMessage({ channel: "watchparty-player", type: "init", session: playerFrameSession }, "https://static.crunchyroll.com");
  };
  const discover = () => {
    const frame = [...document.querySelectorAll("iframe")].find((element) => {
      try {
        const url = new URL(element.src);
        return url.origin === "https://static.crunchyroll.com" && url.pathname.startsWith("/vilos-v2/");
      } catch { return false; }
    }) || null;
    if (frame !== playerFrame) {
      frameListenerAbort?.abort();
      frameListenerAbort = new AbortController();
      playerFrame = frame || null;
      resetSession();
      frame?.addEventListener?.("load", resetSession, { signal: frameListenerAbort.signal });
    }
    if (frame) frame.contentWindow.postMessage({ channel: "watchparty-player", type: "init", session: playerFrameSession }, "https://static.crunchyroll.com");
  };
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!playerFrame || event.source !== playerFrame.contentWindow || event.origin !== "https://static.crunchyroll.com" ||
        !data || data.channel !== "watchparty-player" || data.session !== playerFrameSession || !Number.isSafeInteger(data.sequence) || data.sequence <= frameSequence) return;
    frameSequence = data.sequence;
    if (data.type === "result") {
      const call = frameCalls.get(data.replyTo);
      if (!call) return;
      clearTimeout(call.timer);
      frameCalls.delete(data.replyTo);
      if (data.error) call.reject(Object.assign(new Error(data.error.message), { name: data.error.name }));
      else call.resolve();
    } else if (data.type === "gone") {
      framePlayer = null;
      attachPlayerListeners();
    } else if (data.type === "local-control" && framePlayer && data.videoId === framePlayer.videoId &&
        data.appliedCommandId >= framePlayer.lastMutationId && ["play", "pause", "seek"].includes(data.action) &&
        Number.isFinite(data.time) && data.time >= 0) {
      handleLocalPlayerControl(data.action, data.time);
    } else if (data.type === "unlocking" && Number.isFinite(data.target)) {
      state.remoteSeek = data.seeking ? { target: data.target, startedAt: performance.now() } : null;
      state.expectedPlay = true;
      state.pendingAutoResume = false;
      setResumeAvailable(false);
    } else if (data.type === "state" && data.media && Number.isFinite(data.media.time)) {
      if (!framePlayer || framePlayer.videoId !== data.videoId) {
        framePlayer = new FramePlayer(data.videoId, data.media);
        attachPlayerListeners();
      }
      if (data.appliedCommandId < framePlayer.lastMutationId) return;
      framePlayer.media = data.media;
      framePlayer.receivedAt = performance.now();
      if (["play", "pause", "seeking", "seeked", "ratechange", "loadedmetadata", "canplay", "waiting", "ended", "emptied", "timeupdate"].includes(data.event)) {
        framePlayer.dispatchEvent(new Event(data.event));
      }
    }
  });
  discover();
  setInterval(discover, 500);
}

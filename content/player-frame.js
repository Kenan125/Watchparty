// Runs only inside Crunchyroll's embedded player. No room, network, or UI panel.
(() => {
  const parentOrigins = new Set(["https://www.crunchyroll.com", "https://beta.crunchyroll.com"]);
  let session = null;
  let parentOrigin = null;
  let player = null;
  let playerAbort = null;
  let videoId = 0;
  let appliedCommandId = 0;
  let sequence = 0;
  let lastProgressAt = -Infinity;
  let playIntent = false;
  let blocked = false;
  let target = null;
  let unlockButton = null;

  function send(payload) {
    if (session) window.parent.postMessage({ channel: "watchparty-player", session, sequence: ++sequence,
      videoId, appliedCommandId, ...payload }, parentOrigin);
  }
  setupLocalSeekListener((action, time) => {
    if (player) send({ type: "local-control", action, time });
  });
  function snapshot(event) {
    if (!player) return;
    if (event === "timeupdate") {
      if (performance.now() - lastProgressAt < 250) return;
      lastProgressAt = performance.now();
    }
    send({ type: "state", event, media: { time: player.currentTime, paused: player.paused,
      seeking: player.seeking, ended: player.ended, readyState: player.readyState,
      duration: Number.isFinite(player.duration) ? player.duration : null, rate: player.playbackRate } });
  }
  function showUnlock() {
    if (!blocked || !playIntent) return;
    if (!unlockButton) {
      unlockButton = document.createElement("button");
      unlockButton.textContent = "Enable WatchParty playback";
      unlockButton.type = "button";
      unlockButton.style.cssText = "position:fixed;top:20px;left:20px;z-index:2147483647;padding:14px;border:0;border-radius:8px;background:#f47521;color:#111;font:600 16px sans-serif;cursor:pointer";
      unlockButton.addEventListener("click", () => {
        if (!playIntent || !player) return;
        const time = target ? target.time + Math.max(0, performance.now() - target.receivedAt) / 1000 * target.rate : player.currentTime;
        const safeTime = Math.max(0, Math.min(time, Number.isFinite(player.duration) ? Math.max(0, player.duration - 0.05) : time));
        const seeking = Math.abs(player.currentTime - safeTime) > 0.5;
        send({ type: "unlocking", target: safeTime, seeking });
        if (seeking) seekCrunchyrollPlayer(player, safeTime);
        player.play().then(() => { blocked = false; unlockButton.hidden = true; }).catch(() => { showUnlock(); });
      });
      document.documentElement.appendChild(unlockButton);
    }
    unlockButton.hidden = false;
  }
  function bindPlayer() {
    const current = document.querySelector("video");
    if (current === player) return;
    playerAbort?.abort();
    player = current;
    videoId++;
    if (!player) { send({ type: "gone" }); return; }
    playerAbort = new AbortController();
    for (const event of ["play", "pause", "seeking", "seeked", "ratechange", "loadedmetadata", "canplay", "waiting", "ended", "emptied", "timeupdate"]) {
      player.addEventListener(event, () => snapshot(event), { signal: playerAbort.signal });
    }
    snapshot();
  }
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (event.source !== window.parent || !parentOrigins.has(event.origin) || !data || data.channel !== "watchparty-player") return;
    if (data.type === "init" && typeof data.session === "string") {
      if (data.session !== session) { session = data.session; appliedCommandId = 0; sequence = 0; }
      parentOrigin = event.origin;
      bindPlayer();
      snapshot();
      return;
    }
    if (data.session !== session || data.type !== "command" || !Number.isSafeInteger(data.id) || data.id <= appliedCommandId) return;
    appliedCommandId = data.id;
    if (!player) { send({ type: "result", replyTo: data.id, error: { name: "AbortError", message: "Video is not mounted" } }); return; }
    if (data.action === "intent") {
      playIntent = data.playing === true;
      if (Number.isFinite(data.time) && Number.isFinite(data.rate)) target = { time: data.time, rate: data.rate, receivedAt: performance.now() };
      if (!playIntent && unlockButton) unlockButton.hidden = true;
    } else if (data.action === "show-unlock") {
      showUnlock();
    } else if (data.action === "seek" && Number.isFinite(data.value) && data.value >= 0) {
      seekCrunchyrollPlayer(player, Math.min(data.value, Number.isFinite(player.duration) ? Math.max(0, player.duration - 0.05) : data.value));
    } else if (data.action === "rate" && Number.isFinite(data.value) && data.value >= 0.1 && data.value <= 8) {
      player.playbackRate = data.value;
    } else if (data.action === "pause") {
      playIntent = false;
      if (unlockButton) unlockButton.hidden = true;
      player.pause();
    } else if (data.action === "play") {
      playIntent = true;
      const requestedPlayer = player;
      player.play().then(() => {
        blocked = false;
        if (unlockButton) unlockButton.hidden = true;
        snapshot();
        send({ type: "result", replyTo: data.id });
      }).catch((error) => {
        if (requestedPlayer !== player) return;
        blocked = error.name === "NotAllowedError";
        if (blocked) showUnlock();
        send({ type: "result", replyTo: data.id, error: { name: error.name, message: error.message } });
      });
    }
    snapshot();
  });
  setInterval(() => { bindPlayer(); snapshot(); }, 250);
})();

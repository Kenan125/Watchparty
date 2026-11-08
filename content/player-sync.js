// Native media events can arrive seconds after a seek. Track the operation,
// not a suppression timeout, and never manufacture browser media events.
function getPlayer() {
  const embedded = getFramePlayer();
  if (embedded) return embedded;
  const player = document.querySelector("video");
  return player?.isConnected ? player : null;
}

function startPlayerPolling() {
  clearInterval(state.playerPoller);
  attachPlayerListeners();
  state.playerPoller = setInterval(() => {
    updatePageContext();
    attachPlayerListeners();
    notifyPlayerReady();
    if (state.connected) {
      if (state.controllerId === state.clientId) publishSnapshot();
      else reconcilePlayer(false);
    }
  }, 500);
}

function attachPlayerListeners() {
  const player = getPlayer();
  if (player === state.player) return;
  state.playerAbort?.abort();
  cancelPlaybackAttempt();
  state.player = player;
  state.remoteSeek = null;
  state.localSeeking = false;
  state.expectedPlay = false;
  state.expectedPause = false;
  state.playerReadySent = false;
  state.awaitingPageMedia = false;
  state.restoringPlayer = Boolean(state.timeline);
  if (!player) return;
  state.playbackIntentPlaying = !player.paused;
  state.baseRate = state.timeline?.rate || player.playbackRate || 1;
  state.playerAbort = new AbortController();
  const on = (type, fn) => player.addEventListener(type, fn, { signal: state.playerAbort.signal });

  on("seeking", () => {
    if (state.remoteSeek && Math.abs(player.currentTime - state.remoteSeek.target) < 0.5) return;
    state.remoteSeek = null;
    state.localSeeking = true;
    cancelPlaybackAttempt();
    clearTimeout(state.pendingSeekTimer);
  });
  on("seeked", () => {
    if (state.remoteSeek && Math.abs(player.currentTime - state.remoteSeek.target) < 0.5) {
      if (Number.isFinite(state.remoteSeek.startedAt)) state.seekCost = (performance.now() - state.remoteSeek.startedAt) / 1000;
      state.remoteSeek = null;
      reconcilePlayer(false);
      return;
    }
    state.remoteSeek = null;
    state.localSeeking = false;
    if (!state.connected) return;
    clearTimeout(state.pendingSeekTimer);
    state.pendingSeekTimer = setTimeout(() => {
      state.pendingSeekTimer = null;
      broadcastControl("seek");
    }, 120);
  });
  on("play", () => {
    if (state.expectedPlay) {
      state.expectedPlay = false;
      return;
    }
    if (state.restoringPlayer) return;
    if (state.playbackIntentPlaying && state.timeline && !state.timeline.paused && !state.localSeeking) {
      state.pendingAutoResume = false;
      if (ui?.resumeButton) ui.resumeButton.hidden = true;
      return;
    }
    state.playbackIntentPlaying = true;
    if (!state.localSeeking) broadcastControl("play");
  });
  on("pause", () => {
    if (state.expectedPause) {
      state.expectedPause = false;
      return;
    }
    if (state.restoringPlayer) return;
    if (state.remoteSeek) return;
    state.playbackIntentPlaying = false;
    if (player.seeking || state.localSeeking) return;
    broadcastControl("pause");
  });
  on("ratechange", () => {
    if (Math.abs(player.playbackRate - state.appliedRate) < 0.001) return;
    state.baseRate = player.playbackRate;
    broadcastControl("rate");
  });
  on("ended", () => {
    state.playbackIntentPlaying = false;
    broadcastControl("pause");
  });
  on("loadedmetadata", () => {
    updatePageContext();
    state.awaitingPageMedia = false;
    notifyPlayerReady();
    reconcilePlayer(true);
  });
  on("canplay", () => {
    reconcilePlayer(false);
    if (state.controllerId === state.clientId) publishSnapshot(true);
  });
  on("waiting", () => {
    if (state.controllerId === state.clientId) publishSnapshot(true);
  });
  on("timeupdate", () => {
    updatePageContext();
    if (state.controllerId === state.clientId) publishSnapshot();
  });
  notifyPlayerReady();
  if (state.timeline) reconcilePlayer(true);
  else if (state.connected) publishSnapshot(true);
}

function broadcastControl(action) {
  const player = state.player;
  updatePageContext();
  if (!state.connected || !player || player.readyState < 1 || player.seeking || state.awaitingPageMedia || state.initialSyncPending) return;
  state.restoringPlayer = false;
  cancelPlaybackAttempt();
  clearTimeout(state.pendingSeekTimer);
  state.pendingSeekTimer = null;
  state.remoteSeek = null;
  resetPlaybackRate(player);
  const commandId = ++state.commandId;
  state.pendingCommandId = commandId;
  if (!sendMessage({ type: "control", action, commandId, ...playerSnapshot() })) {
    state.pendingCommandId = 0;
    state.ws?.close();
    return;
  }
  addLog(`${state.username}: ${action} at ${formatVideoTime(player.currentTime)}.`, "system");
}

function playerSnapshot() {
  const player = state.player;
  return {
    pageKey: state.pageKey,
    time: player.currentTime,
    paused: !state.playbackIntentPlaying,
    buffering: player.readyState < 3 || player.seeking || state.pendingAutoResume,
    rate: state.baseRate
  };
}

function publishSnapshot(force = false) {
  const player = state.player;
  if (!state.connected || state.controllerId !== state.clientId || !player || player.readyState < 1 || state.awaitingPageMedia || state.restoringPlayer) return;
  if (state.localSeeking || state.remoteSeek || state.pendingSeekTimer || state.pendingCommandId) return;
  if (!force && performance.now() - state.lastReportAt < 1000) return;
  state.lastReportAt = performance.now();
  sendMessage({ type: "report", ...playerSnapshot() });
}

function applySyncSnapshot(data) {
  if (!data || data.pageKey !== state.pageKey || !Number.isFinite(data.time) || data.time < 0 ||
      typeof data.paused !== "boolean" || !Number.isSafeInteger(data.revision) || data.revision <= state.lastRevision) return;
  if (state.initialSyncPending || !state.player || state.player.readyState < 1) state.restoringPlayer = true;
  state.initialSyncPending = false;
  state.lastRevision = data.revision;
  state.controllerId = data.controllerId;
  if (data.senderId === state.clientId && data.commandId >= state.pendingCommandId) state.pendingCommandId = 0;
  state.timeline = {
    ...data, rate: Number.isFinite(data.rate) && data.rate >= 0.25 && data.rate <= 4 ? data.rate : 1,
    receivedAt: performance.now(), transit: snapshotTransit(data)
  };
  // Buffer readiness belonged to the departed controller, not its replacement.
  if (data.cause === "handover" && data.controllerId === state.clientId) state.timeline.buffering = false;
  if (state.pendingCommandId || state.localSeeking || state.pendingSeekTimer) return;
  state.baseRate = state.timeline.rate;
  if (data.senderId !== state.clientId && ["play", "pause", "seek", "rate"].includes(data.cause)) {
    addLog(`${data.username}: ${data.cause} at ${formatVideoTime(data.time)}.`, "system", data.serverTime);
  }
  // The controller reports its actual player; it must not chase its own echo.
  if (data.senderId === state.clientId && data.cause !== "join" && data.cause !== "page") {
    if (data.cause === "initial" && state.player?.readyState >= 1) state.restoringPlayer = false;
    return;
  }
  if (data.paused || data.buffering || data.cause !== "report") {
    const blocked = state.pendingAutoResume && !data.paused && !data.buffering;
    cancelPlaybackAttempt();
    state.pendingAutoResume = blocked;
    if (ui?.resumeButton) ui.resumeButton.hidden = !blocked;
  }
  reconcilePlayer(data.cause !== "report");
}

function snapshotTransit(data) {
  if (data.paused || data.buffering) return 0;
  const age = state.clockOffset === null ? state.roundTrip / 2 : Date.now() + state.clockOffset - data.serverTime;
  return Math.max(0, Math.min(1000, Number.isFinite(age) ? age : 0)) / 1000;
}

function timelinePosition() {
  const timeline = state.timeline;
  if (!timeline) return null;
  const elapsed = (performance.now() - timeline.receivedAt) / 1000;
  return timeline.time + (!timeline.paused && !timeline.buffering ? (elapsed + timeline.transit) * timeline.rate : 0);
}

function reconcilePlayer(forceSeek) {
  const player = state.player;
  const timeline = state.timeline;
  if (timeline?.senderId === state.clientId && state.controllerId === state.clientId && !state.restoringPlayer) return;
  if (!state.connected || !player || !timeline || timeline.pageKey !== state.pageKey || player.readyState < 1 ||
      state.pendingCommandId || state.localSeeking || state.pendingSeekTimer || state.awaitingPageMedia) return;
  if (performance.now() - timeline.receivedAt > 5000) {
    resetPlaybackRate(player);
    return;
  }
  const shouldPlay = !timeline.paused && !timeline.buffering;
  state.playbackIntentPlaying = !timeline.paused;
  const target = clampSeekTime(player, timelinePosition());
  player.setPlaybackIntent?.(shouldPlay, target, timeline.rate);
  if (state.pendingAutoResume && shouldPlay) return;
  const error = target - player.currentTime;
  const canCorrect = forceSeek || !shouldPlay || player.readyState >= 3;
  // A costly seek must not immediately trigger another seek to chase its own loading delay.
  const hardDrift = Math.max(2.5, state.seekCost * 2 + 0.5);
  if (canCorrect && !state.remoteSeek && !player.seeking && (((forceSeek || !shouldPlay) && Math.abs(error) > 0.15) || Math.abs(error) > hardDrift)) {
    resetPlaybackRate(player);
    state.remoteSeek = { target, startedAt: performance.now() };
    seekCrunchyrollPlayer(player, target);
  }
  if (!shouldPlay) {
    cancelPlaybackAttempt();
    resetPlaybackRate(player);
    if (!player.paused) {
      state.expectedPause = true;
      player.pause();
    }
    if (!state.remoteSeek) state.restoringPlayer = false;
    return;
  }
  if (state.remoteSeek || player.seeking) return;
  if (player.paused) {
    if (!state.playAttempt && !state.pendingAutoResume) forceResumePlayback(player);
  } else if (player.readyState >= 3) {
    const correction = Math.abs(error) > 0.25 ? (error > 0 ? 1.03 : 0.97) : 1;
    setPlaybackRate(player, state.baseRate * correction);
  }
  state.restoringPlayer = false;
}

function clampSeekTime(player, target) {
  return Math.max(0, Math.min(target, Number.isFinite(player.duration) ? Math.max(0, player.duration - 0.05) : target));
}

function setPlaybackRate(player, rate) {
  state.appliedRate = rate;
  if (Math.abs(player.playbackRate - rate) > 0.001) player.playbackRate = rate;
}

function resetPlaybackRate(player = state.player) {
  if (player) setPlaybackRate(player, state.baseRate || 1);
}

function cancelPlaybackAttempt() {
  state.playGeneration++;
  state.playAttempt = false;
  state.pendingAutoResume = false;
  if (ui?.resumeButton) ui.resumeButton.hidden = true;
}

function forceResumePlayback(player) {
  if (!player || !state.playbackIntentPlaying) return;
  const generation = state.playGeneration;
  state.playAttempt = true;
  state.expectedPlay = player.paused;
  let result;
  try { result = player.play(); } catch (error) { result = Promise.reject(error); }
  Promise.resolve(result).then(() => {
    if (generation !== state.playGeneration) return;
    state.playAttempt = false;
    state.pendingAutoResume = false;
    if (ui?.resumeButton) ui.resumeButton.hidden = true;
  }).catch((error) => {
    if (generation !== state.playGeneration) return;
    state.playAttempt = false;
    state.expectedPlay = false;
    if (error.name === "NotAllowedError") {
      state.pendingAutoResume = true;
      if (ui?.resumeButton) ui.resumeButton.hidden = false;
      addLog("Browser blocked remote playback. Click Enable playback in WatchParty.", "system");
    }
    // AbortError is normal during a seek. canplay/polling retries without
    // pausing the player or seeking back to an obsolete retry target.
  });
}

function setupAutoResumeUnlock() {
  ui.resumeButton?.addEventListener("click", () => {
    if (!state.pendingAutoResume || !state.playbackIntentPlaying) return;
    if (state.player?.showUnlock) {
      state.player.showUnlock();
      addLog("Click Enable WatchParty playback on the video itself to allow audio.", "system");
      return;
    }
    state.pendingAutoResume = false;
    reconcilePlayer(true);
    if (state.player?.paused && !state.remoteSeek) forceResumePlayback(state.player);
  });
}

function updatePageContext() {
  const pageKey = normalizePageKey(location.href);
  if (pageKey === state.pageKey) return;
  resetSyncState();
  state.awaitingPageMedia = Boolean(state.player);
  state.playerReadySent = false;
  state.pageKey = pageKey;
  if (state.connected) sendMessage({ type: "page", pageKey });
}

function resetSyncState() {
  cancelPlaybackAttempt();
  state.player?.setPlaybackIntent?.(false);
  clearTimeout(state.pendingSeekTimer);
  state.pendingSeekTimer = null;
  resetPlaybackRate();
  state.timeline = null;
  state.initialSyncPending = false;
  state.lastRevision = 0;
  state.controllerId = null;
  state.pendingCommandId = 0;
  state.remoteSeek = null;
  state.localSeeking = false;
  state.clockOffset = null;
  state.roundTrip = 0;
  state.lastReportAt = -Infinity;
  state.seekCost = 0;
}
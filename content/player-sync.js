function startPlayerPolling() {
  attachPlayerListeners();

  clearInterval(state.playerPoller);
  state.playerPoller = setInterval(() => {
    const player = getPlayer();
    if (!player) {
      return;
    }

    const wasUnbound = player.dataset.wpBound !== "1";
    attachPlayerListeners();

    if (wasUnbound) {
      if (state.pendingSyncSnapshot) {
        const pending = state.pendingSyncSnapshot;
        state.pendingSyncSnapshot = null;
        state.awaitingInitialSync = false;
        applySyncSnapshot(pending);
      } else if (state.connected && state.awaitingInitialSync) {
        requestSyncSnapshot();
      }
    }

    if (player.dataset.wpBound === "1" && !state.pendingSyncSnapshot) {
      clearInterval(state.playerPoller);
      state.playerPoller = null;
    }
  }, 1000);
}

function attachPlayerListeners() {
  const player = getPlayer();
  if (!player || player.dataset.wpBound === "1") {
    return;
  }

  player.dataset.wpBound = "1";
  state.playbackIntentPlaying = !player.paused;

  player.addEventListener("seeking", () => {
    state.lastSeekObservedAt = Date.now();
  });

  player.addEventListener("pause", () => {
    if (state.suppressPlayerEvents || !state.connected) {
      return;
    }

    clearTimeout(state.forcePlayTimer);
    clearTimeout(state.pendingPauseTimer);

    state.pendingPauseTimer = setTimeout(() => {
      if (state.suppressPlayerEvents || !state.connected) {
        return;
      }

      const recentlySeeked = player.seeking || Date.now() - state.lastSeekObservedAt < SEEK_PAUSE_GUARD_MS;
      if (!player.paused || recentlySeeked) {
        return;
      }

      state.playbackIntentPlaying = false;

      addLog(`${state.username} paused at ${formatVideoTime(player.currentTime)}.`, "system");
      sendMessage({
        type: "control",
        action: "pause",
        room: state.room,
        username: state.username,
        pageKey: state.pageKey,
        time: player.currentTime,
        timestamp: Date.now()
      });
    }, PAUSE_CONFIRM_DELAY_MS);
  });

  player.addEventListener("play", () => {
    if (state.suppressPlayerEvents || !state.connected) {
      return;
    }

    clearTimeout(state.pendingPauseTimer);
    clearTimeout(state.forcePlayTimer);

    // User manually resumed — reset any active slowdown.
    resetPlaybackRate(player);

    state.playbackIntentPlaying = true;

    addLog(`${state.username} resumed at ${formatVideoTime(player.currentTime)}.`, "system");
    sendMessage({
      type: "control",
      action: "play",
      room: state.room,
      username: state.username,
      pageKey: state.pageKey,
      time: player.currentTime,
      timestamp: Date.now()
    });
  });

  player.addEventListener("seeked", () => {
    if (state.suppressPlayerEvents || !state.connected) {
      return;
    }

    clearTimeout(state.pendingPauseTimer);
    clearTimeout(state.forcePlayTimer);

    // User manually seeked — reset any active slowdown so their intent
    // takes priority and we broadcast the authoritative position.
    resetPlaybackRate(player);

    const now = Date.now();
    const shouldPlay = state.playbackIntentPlaying;
    state.lastSeekBroadcastAt = now;

    addLog(`${state.username} jumped to ${formatVideoTime(player.currentTime)}.`, "system");
    sendMessage({
      type: "control",
      action: "seek",
      room: state.room,
      username: state.username,
      pageKey: state.pageKey,
      shouldPlay,
      paused: player.paused,
      time: player.currentTime,
      timestamp: now
    });
  });
}

function dispatchProgrammaticSeekEvents(player) {
  player.dispatchEvent(new Event("seeking", { bubbles: true }));
  player.dispatchEvent(new Event("timeupdate", { bubbles: true }));
  player.dispatchEvent(new Event("seeked", { bubbles: true }));
}

function clampSeekTime(player, targetTime) {
  const safeTarget = Number.isFinite(targetTime) ? targetTime : 0;
  if (Number.isFinite(player.duration)) {
    return Math.min(Math.max(0, safeTarget), Math.max(0, player.duration - 0.05));
  }
  return Math.max(0, safeTarget);
}

function recoverStalledBuffer(player, anchorTime) {
  if (!player || !player.isConnected) {
    return false;
  }

  const baseTime = clampSeekTime(player, anchorTime);
  const recoveryTarget = clampSeekTime(player, baseTime + STALL_RECOVERY_OFFSET);
  if (recoveryTarget <= baseTime) {
    return false;
  }

  player.currentTime = recoveryTarget;
  dispatchProgrammaticSeekEvents(player);
  return true;
}

function seekPlayerTo(player, targetTime, options = {}) {
  if (!player || !Number.isFinite(targetTime)) {
    return;
  }

  const { pauseFirst = false } = options;
  const safeTarget = clampSeekTime(player, targetTime);
  const isBackwardSeek = player.currentTime - safeTarget > 0.25;

  if (pauseFirst && !player.paused) {
    player.pause();
  }

  player.currentTime = safeTarget;
  dispatchProgrammaticSeekEvents(player);

  // Fallback for backward seeks that still stall after the first jump:
  // keep the player slightly ahead to force segment fetch.
  clearTimeout(state.stallNudgeTimer);
  if (!isBackwardSeek) {
    return;
  }

  state.stallNudgeTimer = setTimeout(() => {
    if (!player.isConnected) {
      return;
    }
    // If we've drifted, another seek already happened — let it own the fix.
    if (Math.abs(player.currentTime - safeTarget) > 0.5) {
      return;
    }
    if (player.readyState >= HAVE_FUTURE_DATA) {
      return;
    }
    recoverStalledBuffer(player, safeTarget);
  }, 250);
}

function applyRemoteControl(data) {
  if (data.action === "seek") {
    state.pendingRemoteSeekControl = data;
    clearTimeout(state.pendingRemoteSeekTimer);
    state.pendingRemoteSeekTimer = setTimeout(() => {
      const latestSeek = state.pendingRemoteSeekControl;
      state.pendingRemoteSeekControl = null;
      if (!latestSeek) {
        return;
      }
      applyRemoteControlNow(latestSeek);
    }, REMOTE_SEEK_DEBOUNCE_MS);
    return;
  }

  if (state.pendingRemoteSeekControl) {
    clearTimeout(state.pendingRemoteSeekTimer);
    const latestSeek = state.pendingRemoteSeekControl;
    state.pendingRemoteSeekControl = null;
    applyRemoteControlNow(latestSeek);
  }

  applyRemoteControlNow(data);
}

function applyRemoteControlNow(data) {
  const player = getPlayer();
  if (!player) {
    return;
  }

  const remoteTime = compensateLatency(data);
  const action = data.action;
  const localTimeBeforeSeek = player.currentTime;
  let wasBackwardSeek = false;

  clearTimeout(state.forcePlayTimer);
  clearTimeout(state.pendingPauseTimer);

  state.suppressPlayerEvents = true;

  // Track remote state for periodic drift polling.
  if (Number.isFinite(remoteTime)) {
    state.lastRemoteTime = remoteTime;
    state.lastRemoteTimestamp = data.timestamp || Date.now();
  }

  if (action === "pause") {
    resetPlaybackRate(player);
    state.lastRemotePaused = true;
    state.playbackIntentPlaying = false;
    player.pause();
    addLog(`${data.username} paused at ${formatVideoTime(remoteTime)}.`, "system", data.timestamp);
  }

  if (action === "play") {
    state.lastRemotePaused = false;
    state.playbackIntentPlaying = true;

    // Apply multi-tier correction for position drift, then resume.
    if (Number.isFinite(remoteTime)) {
      wasBackwardSeek = applyMultiTierCorrection(player, remoteTime, data);
      if (wasBackwardSeek && player.readyState < HAVE_FUTURE_DATA) {
        recoverStalledBuffer(player, remoteTime);
      }
    }
    forceResumePlayback(player, remoteTime);
    addLog(`${data.username} resumed at ${formatVideoTime(remoteTime)}.`, "system", data.timestamp);
  }

  if (action === "seek") {
    const shouldPlay =
      typeof data.shouldPlay === "boolean"
        ? data.shouldPlay
        : data.paused === false;

    state.playbackIntentPlaying = shouldPlay;
    state.lastRemotePaused = !shouldPlay;

    // Explicit seek: always match position (intentional jump).
    // Multi-tier slowdown is for playback drift, not deliberate seeks.
    if (Number.isFinite(remoteTime)) {
      resetPlaybackRate(player);
      const isStalled = player.readyState < HAVE_FUTURE_DATA;
      const needsSeek = Math.abs(player.currentTime - remoteTime) > 0.15 || isStalled;
      if (needsSeek) {
        wasBackwardSeek = player.currentTime - remoteTime > 0.25;
        seekPlayerTo(player, remoteTime, {
          pauseFirst: wasBackwardSeek || isStalled
        });
      }
    }

    if (shouldPlay) {
      const needsPauseKick = wasBackwardSeek || player.readyState < HAVE_FUTURE_DATA;
      if (needsPauseKick && !player.paused) {
        player.pause();
      }
      if (wasBackwardSeek && player.readyState < HAVE_FUTURE_DATA && Number.isFinite(remoteTime)) {
        recoverStalledBuffer(player, remoteTime);
      }
      forceResumePlayback(player, remoteTime);
    } else {
      player.pause();
    }
    addLog(`${data.username} jumped to ${formatVideoTime(remoteTime)}.`, "system", data.timestamp);
  }

  // Start polling if not already running (kicks in after first control message).
  if (!state.syncPollTimer && state.connected && Number.isFinite(remoteTime)) {
    startSyncPolling();
  }

  setTimeout(() => {
    state.suppressPlayerEvents = false;
  }, 800);
}

function requestSyncSnapshot() {
  sendMessage({
    type: "sync-request",
    room: state.room,
    username: state.username,
    pageKey: state.pageKey,
    timestamp: Date.now()
  });
}

function publishSnapshot() {
  const player = getPlayer();
  if (!player || !state.connected) {
    return;
  }

  sendMessage({
    type: "sync-state",
    room: state.room,
    username: state.username,
    pageKey: state.pageKey,
    paused: player.paused,
    time: player.currentTime,
    timestamp: Date.now()
  });
}

function applySyncSnapshot(data) {
  const player = getPlayer();
  if (!player) {
    // Player not loaded yet; queue and apply once it appears.
    state.pendingSyncSnapshot = data;
    addLog("Sync received — waiting for video player to load...", "system", data.timestamp);
    return;
  }

  state.awaitingInitialSync = false;

  const remoteTime = compensateLatency(data);
  if (!Number.isFinite(remoteTime)) {
    return;
  }

  // Seed remote state for drift polling.
  state.lastRemoteTime = remoteTime;
  state.lastRemoteTimestamp = data.timestamp || Date.now();
  state.lastRemotePaused = true;

  state.suppressPlayerEvents = true;

  resetPlaybackRate(player);

  if (Math.abs(player.currentTime - remoteTime) > 2) {
    seekPlayerTo(player, remoteTime);
    addLog(`Synced to ${data.username} at ${formatVideoTime(remoteTime)}.`, "system", data.timestamp);
  }

  // New joiner always starts paused so both sides are in sync.
  state.playbackIntentPlaying = false;
  player.pause();

  // Start periodic drift correction now that we have a reference point.
  startSyncPolling();

  setTimeout(() => {
    state.suppressPlayerEvents = false;
  }, 800);
}

function getPlayer() {
  if (state.player && document.contains(state.player)) {
    return state.player;
  }

  const player = document.querySelector("video");
  state.player = player || null;
  return state.player;
}

// --- Multi-tier sync helpers (Syncplay-inspired) ---

function resetPlaybackRate(player) {
  if (!player) {
    return;
  }
  if (player.playbackRate !== 1.0) {
    player.playbackRate = 1.0;
    state.speedChanged = false;
  }
}

function compensateLatency(data) {
  // Adjust remote time by estimated message age so we target where the
  // remote player *is now*, not where it was when the message was sent.
  if (!data.timestamp) {
    return Number(data.time);
  }
  const messageAgeMs = Date.now() - data.timestamp;
  const messageAgeSec = Math.min(messageAgeMs / 1000, 5); // cap at 5s
  return Number(data.time) + messageAgeSec;
}

function applyMultiTierCorrection(player, remoteTime, data) {
  if (!player || !Number.isFinite(remoteTime)) {
    return;
  }

  const diff = player.currentTime - remoteTime;

  // Tier 2: Rewind — way ahead, seek back.
  if (diff > REWIND_THRESHOLD) {
    resetPlaybackRate(player);
    const wasBackward = true;
    seekPlayerTo(player, remoteTime, { pauseFirst: true });
    addLog(`Rewound to sync with ${data.username} (${diff.toFixed(1)}s ahead).`, "system", data.timestamp);
    return wasBackward;
  }

  // Tier 3: Fast-forward — way behind, seek ahead.
  if (diff < -FASTFORWARD_THRESHOLD) {
    resetPlaybackRate(player);
    seekPlayerTo(player, remoteTime + FASTFORWARD_EXTRA_TIME);
    addLog(`Fast-forwarded to sync with ${data.username} (${Math.abs(diff).toFixed(1)}s behind).`, "system", data.timestamp);
    return false;
  }

  // Tier 1: Slowdown — slightly ahead, reduce playback rate.
  if (diff > SLOWDOWN_KICKIN_THRESHOLD && !state.speedChanged) {
    player.playbackRate = SLOWDOWN_RATE;
    state.speedChanged = true;
    return false;
  }

  // Reset slowdown when close enough.
  if (state.speedChanged && Math.abs(diff) < SLOWDOWN_RESET_THRESHOLD) {
    resetPlaybackRate(player);
  }

  return false;
}

function startSyncPolling() {
  stopSyncPolling();
  state.syncPollTimer = setInterval(() => {
    const player = getPlayer();
    if (!player || !state.connected) {
      return;
    }
    // Don't poll while user is actively seeking or we're applying a remote control.
    if (state.suppressPlayerEvents) {
      return;
    }
    // Don't poll during pending auto-resume (waiting for user gesture).
    if (state.pendingAutoResume) {
      return;
    }
    // Only poll when we have a recent remote reference and remote is playing.
    if (state.lastRemoteTime === null || state.lastRemotePaused) {
      return;
    }
    // Don't poll if local player is paused (user paused locally).
    if (player.paused && !state.playbackIntentPlaying) {
      return;
    }

    // Estimate where the remote player should be now.
    const ageSec = (Date.now() - state.lastRemoteTimestamp) / 1000;
    const estimatedRemote = state.lastRemoteTime + Math.min(ageSec, 10);
    const diff = player.currentTime - estimatedRemote;

    // Only correct if we've drifted meaningfully but not so much that
    // an event-driven correction should have already fired.
    if (Math.abs(diff) < 0.3) {
      // Close enough — ensure speed is normal.
      if (state.speedChanged) {
        resetPlaybackRate(player);
      }
      return;
    }

    if (diff > REWIND_THRESHOLD || diff < -FASTFORWARD_THRESHOLD) {
      // Large drift — don't silently correct here; wait for an event or
      // the next sync-state. Just reset speed so we don't compound the issue.
      resetPlaybackRate(player);
      return;
    }

    // Gentle slowdown / speedup for minor drift.
    if (diff > SLOWDOWN_KICKIN_THRESHOLD && !state.speedChanged) {
      player.playbackRate = SLOWDOWN_RATE;
      state.speedChanged = true;
    } else if (state.speedChanged && Math.abs(diff) < SLOWDOWN_RESET_THRESHOLD) {
      resetPlaybackRate(player);
    }
  }, SYNC_POLL_INTERVAL_MS);
}

function stopSyncPolling() {
  clearInterval(state.syncPollTimer);
  state.syncPollTimer = null;
}

async function ensurePlaybackStarted(player) {
  if (!player) {
    return;
  }

  try {
    await player.play();
  } catch {
    // Autoplay blocked — forceResumePlayback will retry or arm the
    // user-gesture unlock. Don't mute; it's impossible to unmute
    // programmatically afterwards.
  }
}

function forceResumePlayback(player, targetTime) {
  clearTimeout(state.forcePlayTimer);

  let attempt = 0;
  const maxAttempts = 20;

  const tick = () => {
    if (!player) {
      return;
    }

    const hasFutureData = player.readyState >= HAVE_FUTURE_DATA;
    if (!player.paused && hasFutureData) {
      state.pendingAutoResume = false;
      state.pendingTargetTime = null;
      state.unlockNoticeShown = false;
      return;
    }

    if (!player.paused && !hasFutureData) {
      player.pause();
    }

    ensurePlaybackStarted(player).catch(() => {});
    attempt += 1;

    const stillNeedsKick = player.paused || player.readyState < HAVE_FUTURE_DATA;
    if (attempt < maxAttempts && stillNeedsKick) {
      state.forcePlayTimer = setTimeout(tick, FORCE_PLAY_RETRY_MS);
    } else if (stillNeedsKick) {
      state.pendingAutoResume = true;
      state.pendingTargetTime = Number.isFinite(targetTime) ? targetTime : null;
      if (!state.unlockNoticeShown) {
        addLog("Remote play is blocked by browser policy. Click anywhere once to enable sync playback.", "system");
        state.unlockNoticeShown = true;
      }
    }
  };

  state.forcePlayTimer = setTimeout(tick, FORCE_PLAY_INITIAL_MS);
}

function setupAutoResumeUnlock() {
  const tryUnlock = () => {
    if (!state.pendingAutoResume) {
      return;
    }

    const player = getPlayer();
    if (!player) {
      return;
    }

    const target = state.pendingTargetTime;
    if (Number.isFinite(target) && Math.abs(player.currentTime - target) > 1.5) {
      player.currentTime = target;
    }

    ensurePlaybackStarted(player)
      .then(() => {
        state.pendingAutoResume = false;
        state.pendingTargetTime = null;
        if (state.unlockNoticeShown) {
          addLog("Sync playback enabled on this tab.", "system");
        }
        state.unlockNoticeShown = false;
      })
      .catch(() => {
        return;
      });
  };

  window.addEventListener("pointerdown", tryUnlock, true);
  window.addEventListener("keydown", tryUnlock, true);
}

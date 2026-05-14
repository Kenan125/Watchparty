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

    clearTimeout(state.pendingSeekTimer);
    state.pendingSeekTimer = setTimeout(() => {
      if (state.suppressPlayerEvents || !state.connected) {
        return;
      }

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
    }, 140);
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

  const remoteTime = Number(data.time);
  const action = data.action;
  const localTimeBeforeSeek = player.currentTime;
  let wasBackwardSeek = false;

  clearTimeout(state.forcePlayTimer);
  clearTimeout(state.pendingPauseTimer);

  state.suppressPlayerEvents = true;

  if (Number.isFinite(remoteTime)) {
    if (action === "seek") {
      const isStalled = player.readyState < HAVE_FUTURE_DATA;
      const needsSeek = Math.abs(localTimeBeforeSeek - remoteTime) > 0.15 || isStalled;
      if (needsSeek) {
        wasBackwardSeek = localTimeBeforeSeek - remoteTime > 0.25;
        // Rewind: seek 0.1 s ahead of the remote time so the DASH player
        // fetches a fresh segment instead of stalling on an uncached one.
        const seekTarget = wasBackwardSeek
          ? clampSeekTime(player, remoteTime + REWIND_RECOVERY_OFFSET)
          : remoteTime;
        seekPlayerTo(player, seekTarget, {
          pauseFirst: wasBackwardSeek || isStalled
        });
      }
    } else if (Math.abs(localTimeBeforeSeek - remoteTime) > 1.2) {
      wasBackwardSeek = localTimeBeforeSeek - remoteTime > 0.25;
      seekPlayerTo(player, remoteTime);
    }
  }

  if (action === "pause") {
    state.playbackIntentPlaying = false;
    player.pause();
    addLog(`${data.username} paused at ${formatVideoTime(remoteTime)}.`, "system", data.timestamp);
  }

  if (action === "play") {
    state.playbackIntentPlaying = true;
    forceResumePlayback(player, remoteTime);
    addLog(`${data.username} resumed at ${formatVideoTime(remoteTime)}.`, "system", data.timestamp);
  }

  if (action === "seek") {
    const shouldPlay =
      typeof data.shouldPlay === "boolean"
        ? data.shouldPlay
        : data.paused === false;

    state.playbackIntentPlaying = shouldPlay;

    if (shouldPlay) {
      if (wasBackwardSeek) {
        // seekPlayerTo already jumped to remoteTime + REWIND_RECOVERY_OFFSET
        // above — just pause (if needed) and resume from the nudged position.
        if (!player.paused) {
          player.pause();
        }
        forceResumePlayback(player, remoteTime + REWIND_RECOVERY_OFFSET);
      } else {
        // Forward seek: keep existing behaviour.
        if (player.readyState < HAVE_FUTURE_DATA && !player.paused) {
          player.pause();
        }
        forceResumePlayback(player, remoteTime);
      }
    } else {
      player.pause();
    }
    addLog(`${data.username} jumped to ${formatVideoTime(remoteTime)}.`, "system", data.timestamp);
  }

  setTimeout(() => {
    state.suppressPlayerEvents = false;
  }, 1500);
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

  const remoteTime = Number(data.time);
  if (!Number.isFinite(remoteTime)) {
    return;
  }

  state.suppressPlayerEvents = true;

  if (Math.abs(player.currentTime - remoteTime) > 2) {
    seekPlayerTo(player, remoteTime);
    addLog(`Synced to ${data.username} at ${formatVideoTime(remoteTime)}.`, "system", data.timestamp);
  }

  if (data.paused) {
    state.playbackIntentPlaying = false;
    player.pause();
  } else {
    state.playbackIntentPlaying = true;
    forceResumePlayback(player, remoteTime);
  }

  setTimeout(() => {
    state.suppressPlayerEvents = false;
  }, 1500);
}

function getPlayer() {
  if (state.player && document.contains(state.player)) {
    return state.player;
  }

  const player = document.querySelector("video");
  state.player = player || null;
  return state.player;
}

async function ensurePlaybackStarted(player) {
  if (!player) {
    return;
  }

  try {
    await player.play();
  } catch {
    // Autoplay can be blocked; caller handles retries and user-unlock flow.
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
      state.forcePlayTimer = setTimeout(tick, 300);
    } else if (stillNeedsKick) {
      state.pendingAutoResume = true;
      state.pendingTargetTime = Number.isFinite(targetTime) ? targetTime : null;
      if (!state.unlockNoticeShown) {
        addLog("Remote play is blocked by browser policy. Click anywhere once to enable sync playback.", "system");
        state.unlockNoticeShown = true;
      }
    }
  };

  state.forcePlayTimer = setTimeout(tick, 120);
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

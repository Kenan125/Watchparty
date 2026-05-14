function connect(payload) {
  const { serverUrl, username, room } = payload || {};

  if (!serverUrl || !username || !room) {
    return;
  }

  disconnect(false);

  state.serverUrl = serverUrl;
  state.username = username;
  state.room = room;
  state.playbackIntentPlaying = false;
  state.pendingSyncSnapshot = null;
  state.awaitingInitialSync = true;
  setUserCount(1);
  ui.settingsName.value = state.username;
  ui.roomText.textContent = state.room;

  setConnectionStatus("Connecting...");

  try {
    state.ws = new WebSocket(serverUrl);
  } catch (err) {
    addLog(`Failed to connect: ${err.message || "unknown error"}`, "system");
    setConnectionStatus("Connection failed");
    scheduleReconnect();
    return;
  }

  state.wsAbort = new AbortController();
  const sig = { signal: state.wsAbort.signal };

  state.ws.addEventListener("open", () => {
    state.connected = true;
    state.reconnectAttempts = 0;
    state.disconnectLogged = false;
    setConnectionStatus(`Online - ${state.username}@${state.room}`);
    ui.root.classList.add("wp-open");

    addLog(`${state.username} joined room ${state.room}.`, "system");

    sendMessage({
      type: "join",
      room: state.room,
      username: state.username,
      pageKey: state.pageKey,
      pageTitle: document.title,
      timestamp: Date.now()
    });

    startPlayerPolling();
    requestSyncSnapshot();
  }, sig);

  state.ws.addEventListener("close", () => {
    const hadRoom = Boolean(state.room);
    state.connected = false;
    setConnectionStatus("Offline");
    setUserCount(0);

    if (hadRoom && !state.disconnectLogged) {
      addLog("Disconnected from relay server.", "system");
      state.disconnectLogged = true;
    }

    if (state.room && state.username) {
      scheduleReconnect();
    }
  }, sig);

  state.ws.addEventListener("error", () => {
    if (!state.disconnectLogged) {
      addLog("Relay socket error.", "system");
    }
  }, sig);

  state.ws.addEventListener("message", (event) => {
    handleSocketMessage(event.data);
  }, sig);
}

function scheduleReconnect() {
  clearTimeout(state.reconnectTimer);
  clearTimeout(state.pendingSeekTimer);
  clearTimeout(state.pendingPauseTimer);
  clearTimeout(state.stallNudgeTimer);
  clearTimeout(state.forcePlayTimer);
  clearTimeout(state.pendingRemoteSeekTimer);
  state.pendingRemoteSeekControl = null;
  clearInterval(state.playerPoller);
  state.playerPoller = null;
  const attempt = state.reconnectAttempts++;
  const base = Math.min(30000, 2000 * Math.pow(2, attempt));
  const delay = base + Math.floor(Math.random() * 500);
  state.reconnectTimer = setTimeout(() => {
    if (!state.connected && state.serverUrl && state.username && state.room) {
      connect({
        serverUrl: state.serverUrl,
        username: state.username,
        room: state.room
      });
    }
  }, delay);
}

function disconnect(manual) {
  clearTimeout(state.reconnectTimer);
  clearTimeout(state.pendingSeekTimer);
  clearTimeout(state.pendingPauseTimer);
  clearTimeout(state.stallNudgeTimer);
  clearTimeout(state.forcePlayTimer);
  clearTimeout(state.pendingRemoteSeekTimer);
  state.pendingRemoteSeekControl = null;
  clearInterval(state.playerPoller);
  state.playerPoller = null;
  state.pendingAutoResume = false;
  state.pendingTargetTime = null;
  state.unlockNoticeShown = false;
  state.pendingSyncSnapshot = null;
  state.awaitingInitialSync = false;

  if (state.connected) {
    sendMessage({
      type: "leave",
      room: state.room,
      username: state.username,
      pageKey: state.pageKey,
      timestamp: Date.now()
    });
  }

  if (state.wsAbort) {
    state.wsAbort.abort();
    state.wsAbort = null;
  }

  if (state.ws) {
    try { state.ws.close(); } catch {}
    state.ws = null;
  }

  state.connected = false;
  setConnectionStatus("Offline");
  state.playbackIntentPlaying = false;
  setUserCount(0);

  if (manual) {
    addLog("Disconnected from party.", "system");
    state.room = null;
    state.username = null;
    state.serverUrl = null;
    state.reconnectAttempts = 0;
    state.disconnectLogged = false;
    ui.roomText.textContent = "Not connected";
  }
}

function sendMessage(payload) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    return;
  }

  const outbound = { ...payload };
  if (state.room && !outbound.room) {
    outbound.room = state.room;
  }
  if (state.username && !outbound.username) {
    outbound.username = state.username;
  }
  if (state.pageKey && !outbound.pageKey) {
    outbound.pageKey = state.pageKey;
  }
  if (!("senderId" in outbound)) {
    outbound.senderId = state.clientId;
  }

  state.ws.send(JSON.stringify(outbound));
}

function handleSocketMessage(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }

  if (!data) {
    return;
  }

  if (data.type === "system" && data.event === "username-updated") {
    const previous = state.username;
    state.username = data.username;
    setConnectionStatus(`Online - ${state.username}@${state.room}`);
    ui.settingsName.value = state.username;
    addLog(
      `Name ${previous} is already used. You are now ${state.username}.`,
      "system",
      data.timestamp
    );
    chrome.storage.local.set({ wpUsername: state.username }).catch(() => {});
    return;
  }

  if (data.type === "system" && data.event === "member-count") {
    setUserCount(Number(data.count));
    return;
  }

  if (data.senderId && data.senderId === state.clientId && data.type !== "system") {
    return;
  }

  if (!data.senderId && data.username === state.username && data.type !== "system") {
    return;
  }

  if (data.type === "chat") {
    addChat(data.username, data.text, data.timestamp);
    return;
  }

  if (data.type === "error") {
    addLog(data.message || "Server error.", "system", data.timestamp);
    return;
  }

  if (data.type === "join") {
    addLog(`${data.username} joined.`, "system", data.timestamp);
    // A new member joined - they will request a snapshot; we publish proactively too
    // so they can sync even if their request races our open handler.
    publishSnapshot();
    return;
  }

  if (data.type === "leave") {
    addLog(`${data.username} left.`, "system", data.timestamp);
    return;
  }

  if (data.type === "control") {
    applyRemoteControl(data);
    return;
  }

  if (data.type === "sync-request") {
    publishSnapshot();
    return;
  }

  if (data.type === "sync-state") {
    applySyncSnapshot(data);
  }
}

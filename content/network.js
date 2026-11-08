function connect(payload, retry = false) {
  const { serverUrl, username, room } = payload || {};
  if (typeof serverUrl !== "string" || typeof username !== "string" || typeof room !== "string" ||
      !username.trim() || username.length > 40 || !room.trim() || room.length > 80) return false;
  try {
    const url = new URL(serverUrl);
    if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password) return false;
  } catch { return false; }
  disconnect(false);
  if (!retry) state.reconnectAttempts = 0;
  state.serverUrl = serverUrl;
  state.username = username.trim();
  state.room = room.trim();
  state.pageKey = normalizePageKey(location.href);
  state.initialSyncPending = true;
  ui.settingsName.value = state.username;
  ui.roomText.textContent = state.room;
  setConnectionStatus("Connecting...");
  startPlayerPolling();
  let socket;
  try { socket = new WebSocket(serverUrl); }
  catch {
    setConnectionStatus("Connection failed");
    scheduleReconnect();
    return false;
  }
  state.ws = socket;
  state.wsAbort = new AbortController();
  const options = { signal: state.wsAbort.signal };
  state.handshakeTimer = setTimeout(() => socket.close(), 45000);
  socket.addEventListener("open", () => {
    if (socket !== state.ws) return;
    clearTimeout(state.handshakeTimer);
    state.handshakeTimer = setTimeout(() => {
      if (!state.connected) {
        disconnect(false);
        setConnectionStatus("Relay update required");
        addLog("Relay did not acknowledge protocol 2. Deploy the updated relay before using this extension.", "system");
      }
    }, 5000);
    sendMessage({ type: "join", protocol: PROTOCOL_VERSION, username: state.username,
      snapshot: state.player?.readyState >= 1 ? playerSnapshot() : null });
  }, options);
  socket.addEventListener("message", (event) => {
    if (socket === state.ws) handleSocketMessage(event.data);
  }, options);
  socket.addEventListener("close", () => {
    if (socket !== state.ws) return;
    disconnect(false);
    setConnectionStatus("Offline — reconnecting");
    scheduleReconnect();
  }, options);
  socket.addEventListener("error", () => {
    if (socket === state.ws) addLog("Relay connection error.", "system");
  }, options);
  return true;
}

function scheduleReconnect() {
  clearTimeout(state.reconnectTimer);
  if (!state.room || !state.serverUrl || !state.username) return;
  const delay = Math.min(30000, 1000 * 2 ** Math.min(state.reconnectAttempts++, 5)) + Math.random() * 500;
  state.reconnectTimer = setTimeout(() => {
    connect({ serverUrl: state.serverUrl, username: state.username, room: state.room }, true);
  }, delay);
}

function disconnect(manual) {
  clearTimeout(state.reconnectTimer);
  clearTimeout(state.handshakeTimer);
  clearInterval(state.clockTimer);
  clearInterval(state.playerPoller);
  if (state.connected) sendMessage({ type: "leave" });
  state.wsAbort?.abort();
  state.wsAbort = null;
  const socket = state.ws;
  state.ws = null;
  try { socket?.close(); } catch {}
  state.connected = false;
  resetSyncState();
  state.playerAbort?.abort();
  state.playerAbort = null;
  state.player = null;
  state.playerReadySent = false;
  state.ping = null;
  state.bestRoundTrip = Infinity;
  setConnectionStatus("Offline");
  setUserCount(0);
  if (manual) {
    state.room = null;
    state.username = null;
    state.serverUrl = null;
    state.reconnectAttempts = 0;
    ui.roomText.textContent = "Not connected";
    addLog("Disconnected from party.", "system");
  }
}

function sendMessage(payload) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN || (!state.connected && payload.type !== "join")) return false;
  try {
    state.ws.send(JSON.stringify({ room: state.room, pageKey: state.pageKey, ...payload }));
    return true;
  } catch { return false; }
}

function notifyPlayerReady() {
  if (!state.connected || state.playerReadySent || !state.player || state.player.readyState < 1 || state.awaitingPageMedia) return;
  state.playerReadySent = true;
  sendMessage({ type: "ready", snapshot: playerSnapshot() });
}

function pingRelay() {
  if (!state.connected) return;
  if (state.ping) {
    if (performance.now() - state.ping.sent > 10000) state.ws?.close();
    return;
  }
  const nonce = ++state.pingNonce;
  state.ping = { nonce, sent: performance.now(), wall: Date.now() };
  sendMessage({ type: "ping", nonce });
}

function handleSocketMessage(raw) {
  let data;
  try { data = JSON.parse(raw); } catch { return; }
  if (!data || typeof data !== "object" || Array.isArray(data)) return;
  updatePageContext();
  if (data.type === "welcome") {
    if (data.protocol !== PROTOCOL_VERSION || typeof data.clientId !== "string" || typeof data.username !== "string" || data.room !== state.room) {
      disconnect(false);
      setConnectionStatus("Relay protocol mismatch");
      return;
    }
    clearTimeout(state.handshakeTimer);
    state.clientId = data.clientId;
    state.username = data.username;
    state.connected = true;
    state.reconnectAttempts = 0;
    ui.settingsName.value = state.username;
    ui.root.classList.add("wp-open");
    setConnectionStatus(`Online — ${state.username}@${state.room}`);
    chrome.storage.local.set({ wpUsername: state.username }).catch(() => {});
    addLog(`Joined room ${state.room}.`, "system");
    notifyPlayerReady();
    pingRelay();
    clearInterval(state.clockTimer);
    state.clockTimer = setInterval(pingRelay, 2000);
    return;
  }
  if (data.type === "error") {
    addLog(data.message || "Relay rejected a request.", "system");
    if (data.code === "PROTOCOL_MISMATCH" || data.code === "INVALID_ROOM") {
      disconnect(false);
      setConnectionStatus(data.message);
    }
    return;
  }
  if (!state.connected) return;
  if (data.type === "pong") {
    if (!state.ping || data.nonce !== state.ping.nonce || !Number.isFinite(data.serverTime)) return;
    const roundTrip = performance.now() - state.ping.sent;
    if (roundTrip <= state.bestRoundTrip * 1.5) {
      state.clockOffset = data.serverTime - (state.ping.wall + roundTrip / 2);
      state.roundTrip = roundTrip;
      state.bestRoundTrip = Math.min(state.bestRoundTrip, roundTrip);
    }
    state.ping = null;
    return;
  }
  if (data.type === "system" && data.event === "member-count") {
    setUserCount(data.count);
  } else if (data.type === "timeline") {
    applySyncSnapshot(data);
  } else if (data.type === "role" && data.pageKey === state.pageKey) {
    state.controllerId = data.controllerId;
  } else if (data.type === "page-ready") {
    state.playerReadySent = false;
    notifyPlayerReady();
  } else if (data.type === "chat") {
    addChat(data.username, data.text, data.timestamp);
  } else if (data.type === "join" || data.type === "leave") {
    addLog(`${data.username} ${data.type === "join" ? "joined" : "left"}.`, "system");
  }
}
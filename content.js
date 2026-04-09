(() => {
  const state = {
    ws: null,
    room: null,
    username: null,
    roomPassword: "",
    serverUrl: null,
    pageKey: normalizePageKey(location.href),
    connected: false,
    authFailed: false,
    suppressPlayerEvents: false,
    lastSeekBroadcastAt: 0,
    reconnectTimer: null,
    player: null,
    playerPoller: null,
    mismatchNotices: new Set()
  };

  const ui = buildUi();

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || !message.type) {
      return;
    }

    if (message.type === "WP_CONNECT") {
      connect(message.payload);
    }

    if (message.type === "WP_DISCONNECT") {
      disconnect(true);
    }
  });

  function buildUi() {
    if (document.getElementById("wp-root")) {
      return {
        root: document.getElementById("wp-root"),
        connection: document.getElementById("wp-connection"),
        log: document.getElementById("wp-log"),
        chat: document.getElementById("wp-chat"),
        form: document.getElementById("wp-chat-form"),
        input: document.getElementById("wp-chat-input")
      };
    }

    const root = document.createElement("section");
    root.id = "wp-root";

    const header = document.createElement("div");
    header.id = "wp-header";
    header.innerHTML = `<span>WatchParty</span><span id="wp-connection">Offline</span>`;

    const log = document.createElement("div");
    log.id = "wp-log";

    const chat = document.createElement("div");
    chat.id = "wp-chat";

    const form = document.createElement("form");
    form.id = "wp-chat-form";

    const input = document.createElement("input");
    input.id = "wp-chat-input";
    input.type = "text";
    input.maxLength = 500;
    input.placeholder = "Type a message...";

    const send = document.createElement("button");
    send.id = "wp-chat-send";
    send.type = "submit";
    send.textContent = "Send";

    form.append(input, send);
    root.append(header, log, chat, form);
    document.body.appendChild(root);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text || !state.connected) {
        return;
      }

      sendMessage({
        type: "chat",
        room: state.room,
        username: state.username,
        pageKey: state.pageKey,
        text,
        timestamp: Date.now()
      });

      input.value = "";
    });

    return {
      root,
      connection: header.querySelector("#wp-connection"),
      log,
      chat,
      form,
      input
    };
  }

  function connect(payload) {
    const { serverUrl, username, room, roomPassword } = payload || {};

    if (!serverUrl || !username || !room) {
      return;
    }

    disconnect(false);

    state.serverUrl = serverUrl;
    state.username = username;
    state.room = room;
    state.roomPassword = roomPassword || "";
    state.authFailed = false;

    setConnectionStatus("Connecting...");

    try {
      state.ws = new WebSocket(serverUrl);
    } catch (err) {
      addLog(`Failed to connect: ${err.message || "unknown error"}`, "system");
      setConnectionStatus("Connection failed");
      return;
    }

    state.ws.addEventListener("open", () => {
      state.connected = true;
      setConnectionStatus(`Online - ${state.username}@${state.room}`);

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
    });

    state.ws.addEventListener("close", () => {
      const hadRoom = Boolean(state.room);
      state.connected = false;
      setConnectionStatus("Offline");

      if (hadRoom) {
        addLog("Disconnected from relay server.", "system");
      }

      if (state.room && state.username && !state.authFailed) {
        scheduleReconnect();
      }
    });

    state.ws.addEventListener("error", () => {
      addLog("Relay socket error.", "system");
    });

    state.ws.addEventListener("message", (event) => {
      handleSocketMessage(event.data);
    });
  }

  function scheduleReconnect() {
    clearTimeout(state.reconnectTimer);
    clearInterval(state.playerPoller);
    state.playerPoller = null;
    state.reconnectTimer = setTimeout(() => {
      if (!state.connected && state.serverUrl && state.username && state.room) {
        connect({
          serverUrl: state.serverUrl,
          username: state.username,
          room: state.room,
          roomPassword: state.roomPassword
        });
      }
    }, 2000);
  }

  function disconnect(manual) {
    clearTimeout(state.reconnectTimer);

    if (state.connected) {
      sendMessage({
        type: "leave",
        room: state.room,
        username: state.username,
        pageKey: state.pageKey,
        timestamp: Date.now()
      });
    }

    if (state.ws) {
      state.ws.close();
      state.ws = null;
    }

    state.connected = false;
    setConnectionStatus("Offline");

    if (manual) {
      addLog("Disconnected from party.", "system");
      state.room = null;
      state.username = null;
      state.roomPassword = "";
      state.serverUrl = null;
      state.authFailed = false;
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
    if (!("roomPassword" in outbound)) {
      outbound.roomPassword = state.roomPassword || "";
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

    if (!data || data.username === state.username && data.type !== "system") {
      return;
    }

    if (data.type === "chat") {
      addChat(data.username, data.text, data.timestamp);
      return;
    }

    if (data.type === "error") {
      addLog(data.message || "Server error.", "system", data.timestamp);
      if (data.code === "AUTH_FAILED") {
        state.authFailed = true;
        setConnectionStatus("Auth failed");
        if (state.ws) {
          state.ws.close();
        }
      }
      return;
    }

    if (data.type === "join") {
      addLog(`${data.username} joined.`, "system", data.timestamp);
      return;
    }

    if (data.type === "leave") {
      addLog(`${data.username} left.`, "system", data.timestamp);
      return;
    }

    if (data.type === "control") {
      if (!isSamePage(data.pageKey)) {
        addMismatchNotice(data);
        return;
      }
      applyRemoteControl(data);
      return;
    }

    if (data.type === "sync-request") {
      publishSnapshot();
      return;
    }

    if (data.type === "sync-state") {
      if (!isSamePage(data.pageKey)) {
        addMismatchNotice(data);
        return;
      }
      applySyncSnapshot(data);
    }
  }

  function startPlayerPolling() {
    attachPlayerListeners();

    clearInterval(state.playerPoller);
    state.playerPoller = setInterval(() => {
      const player = getPlayer();
      if (!player) {
        return;
      }

      attachPlayerListeners();
      if (player.dataset.wpBound === "1") {
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

    player.addEventListener("pause", () => {
      if (state.suppressPlayerEvents || !state.connected) {
        return;
      }

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
    });

    player.addEventListener("play", () => {
      if (state.suppressPlayerEvents || !state.connected) {
        return;
      }

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

      const now = Date.now();
      if (now - state.lastSeekBroadcastAt < 500) {
        return;
      }
      state.lastSeekBroadcastAt = now;

      addLog(`${state.username} jumped to ${formatVideoTime(player.currentTime)}.`, "system");
      sendMessage({
        type: "control",
        action: "seek",
        room: state.room,
        username: state.username,
        pageKey: state.pageKey,
        time: player.currentTime,
        timestamp: now
      });
    });
  }

  function applyRemoteControl(data) {
    const player = getPlayer();
    if (!player) {
      return;
    }

    const remoteTime = Number(data.time);
    const action = data.action;

    state.suppressPlayerEvents = true;

    if (Number.isFinite(remoteTime) && Math.abs(player.currentTime - remoteTime) > 1.2) {
      player.currentTime = remoteTime;
    }

    if (action === "pause") {
      player.pause();
      addLog(`${data.username} paused at ${formatVideoTime(remoteTime)}.`, "system", data.timestamp);
    }

    if (action === "play") {
      player.play().catch(() => {});
      addLog(`${data.username} resumed at ${formatVideoTime(remoteTime)}.`, "system", data.timestamp);
    }

    if (action === "seek") {
      addLog(`${data.username} jumped to ${formatVideoTime(remoteTime)}.`, "system", data.timestamp);
    }

    setTimeout(() => {
      state.suppressPlayerEvents = false;
    }, 80);
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
      return;
    }

    const remoteTime = Number(data.time);
    if (!Number.isFinite(remoteTime)) {
      return;
    }

    state.suppressPlayerEvents = true;

    if (Math.abs(player.currentTime - remoteTime) > 2) {
      player.currentTime = remoteTime;
      addLog(`Synced to ${data.username} at ${formatVideoTime(remoteTime)}.`, "system", data.timestamp);
    }

    if (data.paused) {
      player.pause();
    } else {
      player.play().catch(() => {});
    }

    setTimeout(() => {
      state.suppressPlayerEvents = false;
    }, 80);
  }

  function getPlayer() {
    if (state.player && document.contains(state.player)) {
      return state.player;
    }

    const player = document.querySelector("video");
    state.player = player || null;
    return state.player;
  }

  function setConnectionStatus(text) {
    ui.connection.textContent = text;
  }

  function addLog(text, kind, timestamp) {
    const line = document.createElement("div");
    line.className = `wp-line ${kind === "system" ? "wp-system" : "wp-user"}`;
    line.innerHTML = `<span class="wp-time">[${formatClock(timestamp || Date.now())}]</span> ${escapeHtml(text)}`;
    ui.log.appendChild(line);
    ui.log.scrollTop = ui.log.scrollHeight;
  }

  function addChat(username, text, timestamp) {
    const line = document.createElement("div");
    line.className = "wp-line wp-user";
    line.innerHTML = `<span class="wp-time">[${formatClock(timestamp || Date.now())}]</span> <strong>${escapeHtml(username)}:</strong> ${escapeHtml(text)}`;
    ui.chat.appendChild(line);
    ui.chat.scrollTop = ui.chat.scrollHeight;
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatClock(ms) {
    const d = new Date(ms);
    return d.toLocaleTimeString();
  }

  function formatVideoTime(seconds) {
    const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    const s = safe % 60;

    if (h > 0) {
      return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }

    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function normalizePageKey(url) {
    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return location.pathname;
    }
  }

  function isSamePage(remotePageKey) {
    if (!remotePageKey) {
      return true;
    }
    return remotePageKey === state.pageKey;
  }

  function addMismatchNotice(data) {
    const key = `${data.username || "unknown"}:${data.pageKey || "unknown"}`;
    if (state.mismatchNotices.has(key)) {
      return;
    }
    state.mismatchNotices.add(key);
    addLog(
      `${data.username || "Someone"} is on a different episode. Ignoring sync from that page.`,
      "system",
      data.timestamp
    );
  }

  window.addEventListener("beforeunload", () => {
    disconnect(false);
  });

  addLog("WatchParty loaded. Connect from extension popup.", "system");
})();
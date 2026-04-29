(() => {
  const RELAY_SERVER = "wss://watchparty-relay.onrender.com";

  const state = {
    ws: null,
    room: null,
    username: null,
    clientId: `cid-${Math.random().toString(36).slice(2, 10)}`,
    serverUrl: null,
    pageKey: normalizePageKey(location.href),
    connected: false,
    activeTab: "chat",
    userCount: 0,
    playbackIntentPlaying: false,
    suppressPlayerEvents: false,
    lastSeekBroadcastAt: 0,
    pendingSeekTimer: null,
    forcePlayTimer: null,
    pendingAutoResume: false,
    pendingTargetTime: null,
    unlockNoticeShown: false,
    reconnectTimer: null,
    reconnectAttempts: 0,
    wsAbort: null,
    disconnectLogged: false,
    player: null,
    playerPoller: null,
    pendingSyncSnapshot: null,
    awaitingInitialSync: false
  };

  const ui = buildUi();
  setupAutoResumeUnlock();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) {
      return;
    }

    if (message.type === "WP_CONNECT") {
      connect(message.payload);
      return;
    }

    if (message.type === "WP_DISCONNECT") {
      disconnect(true);
      return;
    }

    if (message.type === "WP_STATUS_REQUEST") {
      sendResponse({
        connected: state.connected,
        room: state.room,
        username: state.username,
        userCount: state.userCount
      });
      return;
    }
  });

  autoConnectFromInviteLink().catch(() => {});

  function buildUi() {
    document.getElementById("wp-root")?.remove();
    document.getElementById("wp-launcher")?.remove();

    const launcher = document.createElement("button");
    launcher.id = "wp-launcher";
    launcher.type = "button";
    launcher.textContent = "WP";

    const root = document.createElement("section");
    root.id = "wp-root";

    root.innerHTML = `
      <div id="wp-header">
        <div>
          <div>WatchParty</div>
          <div id="wp-connection">Offline</div>
        </div>
        <div id="wp-header-right">
          <span id="wp-user-count">Users: 0</span>
          <button id="wp-settings-quick" class="wp-header-btn" type="button">Settings</button>
        </div>
      </div>
      <div id="wp-tabs">
        <button id="wp-tab-btn-chat" class="wp-tab-btn wp-active" type="button">Chat</button>
        <button id="wp-tab-btn-settings" class="wp-tab-btn" type="button">Settings</button>
      </div>
      <section id="wp-tab-chat" class="wp-tab wp-active">
        <div id="wp-log"></div>
        <div id="wp-chat"></div>
        <form id="wp-chat-form">
          <input id="wp-chat-input" type="text" maxlength="500" placeholder="Type a message..." />
          <button id="wp-chat-send" type="submit">Send</button>
        </form>
      </section>
      <section id="wp-tab-settings" class="wp-tab">
        <div class="wp-setting-row">
          <div class="wp-setting-label">Room</div>
          <div id="wp-settings-room">Not connected</div>
        </div>
        <div class="wp-setting-row">
          <label class="wp-setting-label" for="wp-settings-name">Display name</label>
          <input id="wp-settings-name" type="text" maxlength="24" placeholder="Your name" />
        </div>
        <div class="wp-setting-actions">
          <button id="wp-settings-save-name" type="button" class="wp-action-btn">Save Name</button>
          <button id="wp-settings-copy-link" type="button" class="wp-muted-btn">Copy Invite</button>
        </div>
      </section>
    `;

    document.body.append(launcher, root);

    const refs = {
      launcher,
      root,
      connection: root.querySelector("#wp-connection"),
      userCount: root.querySelector("#wp-user-count"),
      roomText: root.querySelector("#wp-settings-room"),
      chatTabBtn: root.querySelector("#wp-tab-btn-chat"),
      settingsTabBtn: root.querySelector("#wp-tab-btn-settings"),
      settingsQuickBtn: root.querySelector("#wp-settings-quick"),
      chatTab: root.querySelector("#wp-tab-chat"),
      settingsTab: root.querySelector("#wp-tab-settings"),
      log: root.querySelector("#wp-log"),
      chat: root.querySelector("#wp-chat"),
      form: root.querySelector("#wp-chat-form"),
      input: root.querySelector("#wp-chat-input"),
      settingsName: root.querySelector("#wp-settings-name"),
      saveNameBtn: root.querySelector("#wp-settings-save-name"),
      copyInviteBtn: root.querySelector("#wp-settings-copy-link")
    };

    refs.launcher.addEventListener("click", () => {
      refs.root.classList.toggle("wp-open");
    });

    refs.chatTabBtn.addEventListener("click", () => {
      switchTab("chat");
    });

    refs.settingsTabBtn.addEventListener("click", () => {
      switchTab("settings");
    });

    refs.settingsQuickBtn.addEventListener("click", () => {
      switchTab("settings");
      refs.root.classList.add("wp-open");
    });

    refs.form.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = refs.input.value.trim();
      if (!text || !state.connected) {
        return;
      }

      const now = Date.now();
      addChat(state.username, text, now);

      sendMessage({
        type: "chat",
        room: state.room,
        username: state.username,
        pageKey: state.pageKey,
        text,
        timestamp: now
      });

      refs.input.value = "";
    });

    refs.saveNameBtn.addEventListener("click", () => {
      saveDisplayName().catch(() => {
        addLog("Could not update name.", "system");
      });
    });

    refs.copyInviteBtn.addEventListener("click", () => {
      copyInviteLink().catch(() => {
        addLog("Could not copy invite link.", "system");
      });
    });

    return refs;
  }

  function switchTab(tabName) {
    state.activeTab = tabName;
    const isChat = tabName === "chat";

    ui.chatTabBtn.classList.toggle("wp-active", isChat);
    ui.settingsTabBtn.classList.toggle("wp-active", !isChat);
    ui.chatTab.classList.toggle("wp-active", isChat);
    ui.settingsTab.classList.toggle("wp-active", !isChat);
  }

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
    clearTimeout(state.forcePlayTimer);
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
    clearTimeout(state.forcePlayTimer);
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

    player.addEventListener("pause", () => {
      if (state.suppressPlayerEvents || !state.connected) {
        return;
      }

      clearTimeout(state.forcePlayTimer);
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
    });

    player.addEventListener("play", () => {
      if (state.suppressPlayerEvents || !state.connected) {
        return;
      }

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

      clearTimeout(state.forcePlayTimer);

      clearTimeout(state.pendingSeekTimer);
      state.pendingSeekTimer = setTimeout(() => {
        if (state.suppressPlayerEvents || !state.connected) {
          return;
        }

        const now = Date.now();
        state.lastSeekBroadcastAt = now;

        addLog(`${state.username} jumped to ${formatVideoTime(player.currentTime)}.`, "system");
        sendMessage({
          type: "control",
          action: "seek",
          room: state.room,
          username: state.username,
          pageKey: state.pageKey,
          shouldPlay: state.playbackIntentPlaying,
          paused: player.paused,
          time: player.currentTime,
          timestamp: now
        });
      }, 140);
    });
  }

  function applyRemoteControl(data) {
    const player = getPlayer();
    if (!player) {
      return;
    }

    const remoteTime = Number(data.time);
    const action = data.action;

    clearTimeout(state.forcePlayTimer);

    state.suppressPlayerEvents = true;

    if (Number.isFinite(remoteTime) && Math.abs(player.currentTime - remoteTime) > 1.2) {
      player.currentTime = remoteTime;
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
        forceResumePlayback(player, remoteTime);
      } else {
        player.pause();
      }
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
      player.currentTime = remoteTime;
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

  function setUserCount(count) {
    const safe = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    state.userCount = safe;
    ui.userCount.textContent = `Users: ${safe}`;
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
      return sanitizePathKey(parsed.pathname);
    } catch {
      return sanitizePathKey(location.pathname);
    }
  }

  function sanitizePathKey(pathname) {
    const clean = String(pathname || "").trim();
    if (!clean) {
      return "/";
    }

    // Crunchyroll watch URLs are /[locale/]watch/{EPISODE_ID}/{slug}. The locale
    // prefix and slug both vary per user, so collapse to the episode ID alone.
    const watchMatch = clean.match(/\/watch\/([A-Za-z0-9]+)/i);
    if (watchMatch) {
      return `/watch/${watchMatch[1].toLowerCase()}`;
    }

    const noTrailing = clean.endsWith("/") && clean.length > 1 ? clean.slice(0, -1) : clean;
    return noTrailing.toLowerCase();
  }

  async function autoConnectFromInviteLink() {
    const invite = parseInviteFromUrl();
    if (!invite) {
      return;
    }

    stripInviteParamFromUrl();

    const saved = await chrome.storage.local.get(["wpUsername"]);
    const username = (saved.wpUsername || "").trim() || randomGuestName();
    ui.settingsName.value = username;

    addLog(`Invite loaded for room ${invite.room}. Connecting as ${username}...`, "system");

    connect({
      serverUrl: invite.serverUrl,
      username,
      room: invite.room
    });
  }

  async function saveDisplayName() {
    const desired = (ui.settingsName.value || "").trim() || randomGuestName();
    ui.settingsName.value = desired;

    await chrome.storage.local.set({ wpUsername: desired });

    if (!state.connected || !state.room) {
      state.username = desired;
      addLog(`Name saved as ${desired}.`, "system");
      return;
    }

    if (desired === state.username) {
      addLog(`Name is already ${desired}.`, "system");
      return;
    }

    addLog(`Changing name to ${desired}...`, "system");

    connect({
      serverUrl: state.serverUrl || RELAY_SERVER,
      username: desired,
      room: state.room
    });
  }

  async function copyInviteLink() {
    if (!state.room) {
      addLog("Connect to a room first to copy invite link.", "system");
      return;
    }

    const payload = { v: 4, room: state.room };

    const next = new URL(location.href);
    next.hash = "";
    next.searchParams.delete("wp");
    next.searchParams.set("wp", btoa(JSON.stringify(payload)));
    const inviteLink = next.toString();

    await navigator.clipboard.writeText(inviteLink);
    addLog("Invite link copied.", "system");
  }

  function parseInviteFromUrl() {
    let wp;
    try {
      wp = new URL(location.href).searchParams.get("wp");
    } catch {
      return null;
    }

    if (!wp) {
      return null;
    }

    try {
      const parsed = JSON.parse(atob(decodeURIComponent(wp)));
      if (!parsed || ![2, 3, 4].includes(parsed.v)) {
        return null;
      }

      if (!parsed.room) {
        return null;
      }

      return {
        serverUrl: String(parsed.serverUrl || RELAY_SERVER).trim(),
        room: String(parsed.room).trim()
      };
    } catch {
      return null;
    }
  }

  function stripInviteParamFromUrl() {
    try {
      const next = new URL(location.href);
      if (!next.searchParams.has("wp")) {
        return;
      }

      next.searchParams.delete("wp");
      const updated = `${next.pathname}${next.search}${next.hash}`;
      history.replaceState(null, "", updated);
    } catch {
      return;
    }
  }

  function randomGuestName() {
    const left = ["Sunny", "Swift", "Nova", "Quiet", "Pixel", "Cosmo", "Lunar", "Blaze"];
    const right = ["Fox", "Wolf", "Otter", "Panda", "Koala", "Hawk", "Tiger", "Raven"];
    const a = left[Math.floor(Math.random() * left.length)];
    const b = right[Math.floor(Math.random() * right.length)];
    const n = Math.floor(100 + Math.random() * 900);
    return `${a}${b}${n}`;
  }

  async function ensurePlaybackStarted(player) {
    if (!player) {
      return;
    }

    try {
      await player.play();
      return;
    } catch {
      // Fallback for autoplay policies: muted autoplay is often allowed.
    }

    const previousMuted = player.muted;
    player.muted = true;

    try {
      await player.play();
      setTimeout(() => {
        player.muted = previousMuted;
      }, 250);
    } catch {
      player.muted = previousMuted;
      addLog("Remote play was blocked by browser autoplay policy. Click video once.", "system");
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

      if (!player.paused) {
        state.pendingAutoResume = false;
        state.pendingTargetTime = null;
        state.unlockNoticeShown = false;
        return;
      }

      ensurePlaybackStarted(player).catch(() => {});
      attempt += 1;

      if (attempt < maxAttempts && player.paused) {
        state.forcePlayTimer = setTimeout(tick, 300);
      } else if (player.paused) {
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

  window.addEventListener("beforeunload", () => {
    disconnect(false);
  });

  addLog("WatchParty loaded. Connect from extension popup.", "system");
})();

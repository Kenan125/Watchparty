function buildUi() {
  document.getElementById("wp-root")?.remove();
  document.getElementById("wp-launcher")?.remove();
  document.getElementById("wp-launcher-slot")?.remove();

  const launcher = document.createElement("button");
  launcher.id = "wp-launcher";
  launcher.type = "button";
  launcher.setAttribute("aria-label", "WatchParty");
  launcher.title = "WatchParty";
  launcher.innerHTML = `
    <span class="wp-launcher-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <path d="M3 5h18v11H3V5zm2 2v7h14V7H5zm3 12h8v2H8v-2zm2-9.5 5 2.5-5 2.5v-5z" fill="currentColor"/>
      </svg>
    </span>
  `;

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

  mountRoot(root);
  attachLauncherToHeader(launcher);

  const headerObserver = new MutationObserver(() => {
    if (!root.isConnected) {
      mountRoot(root);
    }
    if (!launcher.isConnected) {
      attachLauncherToHeader(launcher);
      return;
    }
    const headerActions = document.querySelector(".header-actions");
    if (headerActions && launcher.parentElement !== headerActions) {
      attachLauncherToHeader(launcher);
    }
  });
  headerObserver.observe(document.documentElement, { childList: true, subtree: true });

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

  const togglePanel = () => {
    if (!refs.root.isConnected) {
      mountRoot(refs.root);
    }
    const open = refs.root.classList.toggle("wp-open");
    refs.launcher.classList.toggle("wp-launcher-active", open);
  };
  const handleLauncherPress = (event) => {
    const target = event.target;
    if (!target || !target.closest || !target.closest("#wp-launcher")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) {
      event.stopImmediatePropagation();
    }
    if (event.type === "pointerdown") {
      togglePanel();
    }
  };
  window.addEventListener("pointerdown", handleLauncherPress, true);
  window.addEventListener("click", handleLauncherPress, true);
  window.addEventListener("mousedown", handleLauncherPress, true);
  refs.launcher.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!refs.root.classList.contains("wp-open")) {
      togglePanel();
    }
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

function mountRoot(root) {
  // Crunchyroll's /watch/ pages let React reconcile <body>, which strips
  // anything we append there. Mounting as a sibling of <body> on the <html>
  // element keeps the panel outside React's reconciliation root while still
  // letting position: fixed work normally.
  const host = document.documentElement || document.body;
  if (root.parentElement !== host) {
    host.append(root);
  }
}

function attachLauncherToHeader(launcher) {
  const headerActions = document.querySelector(".header-actions");
  if (!headerActions) {
    launcher.classList.add("wp-launcher-floating");
    launcher.classList.remove("wp-launcher-in-header");
    if (launcher.parentElement !== document.body) {
      document.body.appendChild(launcher);
    }
    return;
  }

  const searchTile = headerActions.querySelector('a[href="/search"]');
  const searchItem = searchTile ? searchTile.closest(".nav-horizontal-layout__action-item--KZBne") : null;
  if (launcher.parentElement !== headerActions) {
    if (searchItem && searchItem.parentNode === headerActions) {
      headerActions.insertBefore(launcher, searchItem);
    } else {
      headerActions.prepend(launcher);
    }
  }
  launcher.classList.add("wp-launcher-in-header");
  launcher.classList.remove("wp-launcher-floating");
}

function switchTab(tabName) {
  state.activeTab = tabName;
  const isChat = tabName === "chat";

  ui.chatTabBtn.classList.toggle("wp-active", isChat);
  ui.settingsTabBtn.classList.toggle("wp-active", !isChat);
  ui.chatTab.classList.toggle("wp-active", isChat);
  ui.settingsTab.classList.toggle("wp-active", !isChat);
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

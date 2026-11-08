// Shared presentation only. The top page remains the sole room/WebSocket owner.
let partyUiOptions = {};
let partyTheme = "dark";
let applyingPartyView = false;
const partyHistory = [];

function watchPartyMark() {
  // Original overlapping screening/chat frames; no third-party icon assets.
  return `<svg class="wp-mark" viewBox="0 0 28 28" fill="none" aria-hidden="true" focusable="false">
    <path d="M8 4.5h12a4 4 0 0 1 4 4v9a4 4 0 0 1-4 4h-3l-4.5 3v-3H8a4 4 0 0 1-4-4v-9a4 4 0 0 1 4-4Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M11 10v7l6-3.5-6-3.5Z" fill="currentColor"/>
    <path d="m23.5 1 .9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1Z" fill="#ffb59c"/>
  </svg>`;
}

function partyIcon(name) {
  const paths = {
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    theme: '<path d="M20 13a8 8 0 0 1-9-9 8 8 0 1 0 9 9Z"/>',
    settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="3"/><path d="M15 4H7a3 3 0 0 0-3 3v8"/>',
    send: '<path d="m4 4 17 8-17 8 3-8-3-8Zm3 8h14"/>',
    people: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/>'
  };
  return `<svg class="wp-small-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ""}</svg>`;
}

function renderPartyPanel() {
  return `<header id="wp-header">
    <div class="wp-brand">${watchPartyMark()}<div><h2>WatchParty</h2><span class="wp-brand-caption">A little closer, wherever you are.</span></div></div>
    <div id="wp-header-right">
      <button id="wp-theme-toggle" class="wp-icon-btn" type="button" aria-label="Switch to light mode">${partyIcon("theme")}</button>
      <button id="wp-close" class="wp-icon-btn" type="button" aria-label="Close chat">${partyIcon("close")}</button>
    </div>
  </header>
  <div class="wp-presence"><span class="wp-presence-dot"></span><span id="wp-connection" role="status">Not in a room</span><span id="wp-user-count">0 watching</span></div>
  <div id="wp-tabs" role="tablist" aria-label="Party views">
    <button id="wp-tab-btn-chat" class="wp-tab-btn wp-active" type="button" role="tab" aria-selected="true" aria-controls="wp-tab-chat">Chat</button>
    <button id="wp-tab-btn-settings" class="wp-tab-btn" type="button" role="tab" aria-selected="false" aria-controls="wp-tab-settings">Room</button>
    <button id="wp-copy-quick" class="wp-icon-btn" type="button" aria-label="Copy invite link">${partyIcon("copy")}</button>
  </div>
  <section id="wp-tab-chat" class="wp-tab wp-active" role="tabpanel" aria-labelledby="wp-tab-btn-chat">
    <button id="wp-enable-playback" type="button" class="wp-action-btn" hidden>Enable playback</button>
    <div id="wp-chat" role="log" aria-label="Party messages" aria-live="polite" aria-relevant="additions">
      <div id="wp-empty"><div class="wp-empty-art">${watchPartyMark()}</div><h3>Better together.</h3><p>Same moment. Your people.<br>Create a room, send a link, settle in.</p><button id="wp-create-room" class="wp-action-btn" type="button">Start a watch party</button><span class="wp-empty-note">Everyone watches on their own account.</span></div>
    </div>
    <details class="wp-activity"><summary>Party activity</summary><div id="wp-log" role="log" aria-label="Party activity" aria-live="polite"></div></details>
    <form id="wp-chat-form"><label class="wp-sr-only" for="wp-chat-input">Message your party</label><input id="wp-chat-input" type="text" maxlength="500" autocomplete="off" placeholder="Join a room to chat" disabled /><button id="wp-chat-send" type="submit" aria-label="Send message" disabled>${partyIcon("send")}</button></form>
    <div class="wp-composer-note">A shared screen. Not a shared password.</div>
  </section>
  <section id="wp-tab-settings" class="wp-tab" role="tabpanel" aria-labelledby="wp-tab-btn-settings">
    <div class="wp-setting-row"><span class="wp-setting-label">Your room</span><div id="wp-settings-room">Not connected</div><p class="wp-help">Invite people you trust. Anyone with the link can join and control playback.</p></div>
    <div class="wp-setting-row"><label class="wp-setting-label" for="wp-settings-name">Display name</label><input id="wp-settings-name" type="text" maxlength="24" placeholder="What should we call you?" /></div>
    <div class="wp-setting-actions"><button id="wp-settings-save-name" type="button" class="wp-action-btn">Save name</button><button id="wp-settings-copy-link" type="button" class="wp-muted-btn">Copy invite</button></div>
    <button id="wp-leave-room" class="wp-leave-btn" type="button">Leave room</button>
    <div class="wp-room-footer"><span>Made for movie nights.</span><span>Crunchyroll available · More services planned</span><span>v${chrome.runtime?.getManifest?.()?.version || "development"} · Experimental side panel</span></div>
  </section>`;
}

function setPanelOpen(open, restoreFocus = false) {
  ui.root.classList.toggle("wp-open", Boolean(open));
  ui.launcher.classList.toggle("wp-launcher-active", Boolean(open));
  ui.launcher.setAttribute("aria-expanded", String(Boolean(open)));
  ui.root.setAttribute("aria-hidden", String(!open));
  ui.root.inert = !open;
  if (!partyUiOptions.sidePanel) layoutPartyPlayer();
  if (restoreFocus) ui.launcher.focus({ preventScroll: true });
  if (partyUiOptions.send && !applyingPartyView) partyUiOptions.send("open", { open: Boolean(open), restoreFocus });
  publishPartyView();
}

function setPartyTheme(theme, persist = false) {
  partyTheme = theme === "light" ? "light" : "dark";
  ui.root.dataset.wpTheme = partyTheme;
  ui.themeToggle.setAttribute("aria-label", `Switch to ${partyTheme === "dark" ? "light" : "dark"} mode`);
  ui.themeToggle.setAttribute("aria-pressed", String(partyTheme === "light"));
  if (persist) {
    if (partyUiOptions.send) partyUiOptions.send("theme", { theme: partyTheme });
    else chrome.storage.local.set({ wpTheme: partyTheme }).catch(() => {});
  }
  publishPartyView();
}

function rememberPartyEvent(kind, username, text, timestamp) {
  partyHistory.push({ kind, username: String(username || "").slice(0, 40), text: String(text).slice(0, 1000), timestamp: timestamp || Date.now() });
  if (partyHistory.length > 100) partyHistory.shift();
}

function publishPartyView() {
  if (partyUiOptions.panel || applyingPartyView || !ui) return;
  const view = currentPartyView();
  if (partyUiOptions.sidePanel) { publishSidePanelView(view); return; }
  publishPanelView(view);
  if (!partyUiOptions.embedded && typeof frameCommand === "function") frameCommand("ui-state", { view });
}

function applyPartyView(view) {
  if (!view || typeof view !== "object" || typeof view.status !== "string" || !Array.isArray(view.history)) return;
  if (partyUiOptions.hosted) { applyHostedPartyView(view); return; }
  applyingPartyView = true;
  try {
    state.connected = view.connected === true;
    state.username = String(view.username || "").slice(0, 40);
    state.room = String(view.room || "").slice(0, 80);
    if (document.activeElement !== ui.settingsName) ui.settingsName.value = state.username;
    ui.roomText.textContent = state.room || "Not connected";
    setPanelOpen(view.open === true);
    setPartyTheme(view.theme);
    switchTab(view.tab === "settings" ? "settings" : "chat");
    setConnectionStatus(view.status.slice(0, 200));
    setUserCount(view.count);
    ui.resumeButton.hidden = view.resume !== true;
    ui.chat.querySelectorAll(".wp-message").forEach((element) => element.remove());
    ui.log.replaceChildren();
    partyHistory.length = 0;
    for (const entry of view.history.slice(-100)) {
      if (!entry || typeof entry.text !== "string" || typeof entry.username !== "string" || !Number.isFinite(entry.timestamp)) continue;
      if (entry.kind === "chat") addChat(entry.username.slice(0, 40), entry.text.slice(0, 1000), entry.timestamp);
      else addLog(entry.text.slice(0, 1000), "system", entry.timestamp);
    }
    ui.root.querySelector("#wp-empty").hidden = ui.chat.querySelector(".wp-message") !== null;
  } finally { applyingPartyView = false; }
}

async function partyAction(action, payload = {}) {
  if (partyUiOptions.send) {
    partyUiOptions.send(action, payload);
    return;
  }
  if (action === "open" && typeof payload.open === "boolean") setPanelOpen(payload.open, payload.restoreFocus === true);
  else if (action === "tab" && ["chat", "settings"].includes(payload.tab)) switchTab(payload.tab);
  else if (action === "theme" && ["dark", "light"].includes(payload.theme)) setPartyTheme(payload.theme, true);
  else if (action === "chat" && typeof payload.text === "string" && state.connected) {
    const text = payload.text.trim().slice(0, 500);
    if (!text) return;
    const timestamp = Date.now();
    if (sendMessage({ type: "chat", text, timestamp })) addChat(state.username, text, timestamp);
    else addLog("Message not sent. Reconnect and try again.", "system");
  } else if (action === "create" && !state.connected) {
    const saved = await chrome.storage.local.get(["wpUsername"]);
    const username = String(saved.wpUsername || "").trim().slice(0, 24) || randomGuestName();
    connect({ serverUrl: RELAY_SERVER, username, room: `room-${crypto.randomUUID().slice(0, 8)}` });
  } else if (action === "copy") await copyInviteLink();
  else if (action === "save-name" && typeof payload.username === "string") {
    ui.settingsName.value = payload.username.slice(0, 24);
    await saveDisplayName();
  } else if (action === "leave") disconnect(true);
}

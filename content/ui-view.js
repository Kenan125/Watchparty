// Native Side Panel presentation only. The selected tab owns the room.
const state = { connected: false, username: "", room: "", activeTab: "chat", userCount: 0 };
let partyUiOptions = {};
let partyTheme = "dark";
let applyingPartyView = false;

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

    copy: '<rect x="8" y="8" width="12" height="12" rx="3"/><path d="M15 4H7a3 3 0 0 0-3 3v8"/>',
    send: '<path d="m4 4 17 8-17 8 3-8-3-8Zm3 8h14"/>'
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
    <div class="wp-room-footer"><span>Made for movie nights.</span><span>Crunchyroll available · More services planned</span><span>v${chrome.runtime?.getManifest?.()?.version || "development"} · Side panel</span></div>
  </section>`;
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
}

function applyPartyView(view) {
  if (!view || typeof view !== "object" || typeof view.status !== "string" || !Array.isArray(view.history)) return;

  applyingPartyView = true;
  try {
    state.connected = view.connected === true;
    state.username = String(view.username || "").slice(0, 40);
    state.room = String(view.room || "").slice(0, 80);
    if (document.activeElement !== ui.settingsName) ui.settingsName.value = state.username;
    ui.roomText.textContent = state.room || "Not connected";

    setPartyTheme(view.theme);
    switchTab(view.tab === "settings" ? "settings" : "chat");
    setConnectionStatus(view.status.slice(0, 200));
    setUserCount(view.count);
    ui.resumeButton.hidden = view.resume !== true;
    ui.chat.querySelectorAll(".wp-message").forEach((element) => element.remove());
    ui.log.replaceChildren();

    for (const entry of view.history.slice(-100)) {
      if (!entry || typeof entry.text !== "string" || typeof entry.username !== "string" || !Number.isFinite(entry.timestamp)) continue;
      if (entry.kind === "chat") addChat(entry.username.slice(0, 40), entry.text.slice(0, 1000), entry.timestamp);
      else addLog(entry.text.slice(0, 1000), "system", entry.timestamp);
    }
    ui.root.querySelector("#wp-empty").hidden = ui.chat.querySelector(".wp-message") !== null;
  } finally { applyingPartyView = false; }
}

async function partyAction(action, payload = {}) {
  return partyUiOptions.send(action, payload);
}

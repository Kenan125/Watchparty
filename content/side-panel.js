// Tab-owned room state. The native panel is presentation-only.
const partyPanelPorts = new Set();
const partyHistory = [];
let partyTheme = "dark";
let partyStatus = "Not in a room";

function setupSidePanel() {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "watchparty-side-panel" || port.sender?.id !== chrome.runtime.id ||
        port.sender?.url !== chrome.runtime.getURL("panel.html")) return;
    partyPanelPorts.add(port);
    port.onDisconnect.addListener(() => partyPanelPorts.delete(port));
    port.onMessage.addListener((message) => {
      if (!message || !["theme", "tab", "chat", "create", "save-name", "leave", "resume"].includes(message.action) ||
          !message.payload || typeof message.payload !== "object" || Array.isArray(message.payload)) return;
      partyAction(message.action, message.payload).catch(() => addLog("Could not complete that action. Try again.", "system"));
    });
    publishPartyView();
  });
  chrome.storage.local.get(["wpTheme", "wpUsername"]).then((saved) => {
    if (!state.username) state.username = saved.wpUsername || "";
    partyTheme = saved.wpTheme === "light" ? "light" : "dark";
    publishPartyView();
  }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.wpTheme) {
      partyTheme = changes.wpTheme.newValue === "light" ? "light" : "dark";
      publishPartyView();
    }
  });
}

function publishPartyView() {
  const invite = new URL(location.href);
  invite.hash = "";
  invite.searchParams.delete("wp");
  if (state.room) invite.searchParams.set("wp", btoa(JSON.stringify({ v: 4, room: state.room })));
  const view = { theme: partyTheme, tab: state.activeTab, connected: state.connected,
    username: state.username || "", room: state.room || "", count: state.userCount,
    status: partyStatus, history: partyHistory, resume: state.resumeAvailable === true,
    inviteUrl: state.room ? invite.toString() : "" };
  for (const port of partyPanelPorts) {
    try { port.postMessage({ type: "state", view }); }
    catch { partyPanelPorts.delete(port); }
  }
}

function setConnectionStatus(text) { partyStatus = text; publishPartyView(); }
function setUserCount(count) {
  state.userCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  publishPartyView();
}
function setResumeAvailable(available) {
  if (state.resumeAvailable === available) return;
  state.resumeAvailable = available;
  publishPartyView();
}
function rememberPartyEvent(kind, username, text, timestamp) {
  partyHistory.push({ kind, username: String(username || "").slice(0, 40),
    text: String(text).slice(0, 1000), timestamp: Number.isFinite(timestamp) ? timestamp : Date.now() });
  if (partyHistory.length > 100) partyHistory.shift();
  publishPartyView();
}
function addLog(text, _kind, timestamp) { rememberPartyEvent("log", "", text, timestamp); }
function addChat(username, text, timestamp) { rememberPartyEvent("chat", username, text, timestamp); }
function formatVideoTime(seconds) {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor(safe % 3600 / 60);
  const time = `${minutes}:${String(safe % 60).padStart(2, "0")}`;
  return hours ? `${hours}:${time.padStart(5, "0")}` : time;
}
async function partyAction(action, payload = {}) {
  if (action === "tab" && ["chat", "settings"].includes(payload.tab)) {
    state.activeTab = payload.tab;
    publishPartyView();
  } else if (action === "theme" && ["dark", "light"].includes(payload.theme)) {
    await chrome.storage.local.set({ wpTheme: payload.theme });
  } else if (action === "chat" && typeof payload.text === "string" && state.connected) {
    const text = payload.text.trim().slice(0, 500);
    if (!text) return;
    const timestamp = Date.now();
    if (sendMessage({ type: "chat", text, timestamp })) addChat(state.username, text, timestamp);
    else addLog("Message not sent. Reconnect and try again.", "system");
  } else if (action === "create" && !state.connected && !state.ws) {
    const saved = await chrome.storage.local.get(["wpUsername"]);
    const username = String(saved.wpUsername || "").trim().slice(0, 24) || randomGuestName();
    connect({ serverUrl: RELAY_SERVER, username, room: `room-${crypto.randomUUID().slice(0, 8)}` });
  } else if (action === "save-name" && typeof payload.username === "string") {
    await saveDisplayName(payload.username.slice(0, 24));
  } else if (action === "leave") disconnect(true);
  else if (action === "resume") resumePlayback();
}

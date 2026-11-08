// Native Side Panel transport. The content script remains the only room owner.
const partyPanelPorts = new Set();

function buildSidePanelHost() {
  partyUiOptions = { hosted: true, sidePanel: true };
  // Remove the old in-page shortcut when upgrading to the native panel.
  document.getElementById("wp-launcher")?.remove();
  document.getElementById("wp-launcher-slot")?.remove();
  // Detached compatibility references for the existing playback/room controllers.
  const refs = { root: document.createElement("section"), launcher: document.createElement("button"),
    settingsName: document.createElement("input"), roomText: document.createElement("span"),
    connection: document.createElement("span"), resumeButton: document.createElement("button"),
    themeToggle: document.createElement("button") };
  refs.connection.textContent = "Not in a room";
  refs.resumeButton.hidden = true;
  new MutationObserver(publishPartyView).observe(refs.resumeButton, { attributes: true, attributeFilter: ["hidden"] });
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "watchparty-side-panel" || port.sender?.id !== chrome.runtime.id ||
        port.sender?.url !== chrome.runtime.getURL("panel.html")) return;
    partyPanelPorts.add(port);
    port.onDisconnect.addListener(() => partyPanelPorts.delete(port));
    port.onMessage.addListener((message) => {
      if (!message || !["theme", "tab", "chat", "create", "save-name", "leave", "resume"].includes(message.action) ||
          !message.payload || typeof message.payload !== "object" || Array.isArray(message.payload)) return;
      if (message.action === "resume") refs.resumeButton.click();
      else partyAction(message.action, message.payload).catch(() => addLog("Could not complete that action. Try again.", "system"));
    });
    publishPartyView();
  });
  chrome.storage.local.get(["wpTheme", "wpUsername"]).then((saved) => {
    if (!state.username) state.username = saved.wpUsername || "";
    refs.settingsName.value = state.username;
    setPartyTheme(saved.wpTheme);
  }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.wpTheme) setPartyTheme(changes.wpTheme.newValue);
  });
  return refs;
}

function publishSidePanelView(view) {
  const invite = new URL(location.href);
  invite.hash = "";
  invite.searchParams.delete("wp");
  if (state.room) invite.searchParams.set("wp", btoa(JSON.stringify({ v: 4, room: state.room })));
  for (const port of partyPanelPorts) {
    try { port.postMessage({ type: "state", view: { ...view, open: true, inviteUrl: state.room ? invite.toString() : "" } }); }
    catch { partyPanelPorts.delete(port); }
  }
}

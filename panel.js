// Native Side Panel presentation. The selected Crunchyroll tab owns the room.
(() => {
  let port = null;
  let tabId = null;
  let windowId = null;
  let generation = 0;
  let inviteUrl = "";
  async function send(action, payload = {}) {

    if (action === "copy") {
      if (!inviteUrl) { addLog("Create or join a room first.", "system"); return; }
      try { await navigator.clipboard.writeText(inviteUrl); addLog("Invite link copied.", "system"); }
      catch { addLog("Clipboard blocked. Try copying the invite again.", "system"); }
      return;
    }
    if (!port) return;
    try { port.postMessage({ action, payload }); }
    catch { unavailable("Refresh the Crunchyroll tab to reconnect."); }
  }
  ui = buildUi(send);
  ui.resumeButton.addEventListener("click", () => send("resume"));
  function unavailable(status) {
    inviteUrl = "";
    applyPartyView({ connected: false, username: "", room: "", count: 0,
      theme: partyTheme, status, history: [], resume: false });
    ui.root.querySelector("#wp-create-room").disabled = true;
    ui.root.querySelector("#wp-empty p").textContent = status;
    ui.saveNameBtn.disabled = true;
  }
  async function bindTab() {
    const request = ++generation;
    const old = port;
    port = null;
    old?.disconnect();
    tabId = null;
    ui.input.value = "";
    ui.settingsName.value = "";
    unavailable("Open a Crunchyroll episode tab to start.");
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (request !== generation) return;
    if (!tab?.id || !/^https:\/\/(www|beta)\.crunchyroll\.com\//.test(tab.url || "")) return;
    tabId = tab.id;
    unavailable("Connecting to this tab. If it stays disconnected, refresh Crunchyroll.");
    const connection = chrome.tabs.connect(tab.id, { name: "watchparty-side-panel", frameId: 0 });
    port = connection;
    connection.onMessage.addListener((message) => {
      if (port !== connection || message?.type !== "state") return;
      inviteUrl = message.view?.inviteUrl || "";
      applyPartyView(message.view);
      ui.root.querySelector("#wp-create-room").disabled = false;
      ui.saveNameBtn.disabled = false;
    });
    connection.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (port !== connection) return;
      port = null;
      unavailable("Refresh the Crunchyroll tab to reconnect.");
    });
  }
  chrome.tabs.onActivated.addListener((info) => {
    if (info.windowId === windowId) bindTab().catch(() => unavailable("Could not reach this tab."));
  });
  chrome.tabs.onUpdated.addListener((id, changes) => {
    if (id === tabId && (changes.status === "complete" || changes.url)) {
      bindTab().catch(() => unavailable("Could not reach this tab."));
    }
  });
  chrome.windows.getCurrent().then((current) => {
    windowId = current.id;
    return bindTab();
  }).catch(() => unavailable("Could not find the active tab."));
})();

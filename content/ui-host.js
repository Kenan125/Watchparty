// Native-page shell only. The chat document and all its CSS live in panel.html,
// following the reference extension's iframe sidebar boundary.
function createPartyLauncher(id, label, text = false) {
  const host = document.createElement("span");
  host.id = id;
  host.className = text ? "wp-launcher-host wp-unlock-host" : "wp-launcher-host";
  host.setAttribute("role", "button");
  host.setAttribute("tabindex", "0");
  host.setAttribute("aria-label", label);
  const shadow = host.attachShadow({ mode: "open" });
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = chrome.runtime.getURL("host.css");
  const content = document.createElement("span");
  if (text) content.textContent = label;
  else content.innerHTML = watchPartyMark();
  shadow.append(css, content);
  host.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      host.click();
    }
  });
  return host;
}

function buildPartyHost(options) {
  partyUiOptions = { ...options, hosted: true };
  document.getElementById("wp-root")?.remove();
  document.getElementById("wp-launcher")?.remove();
  const root = document.createElement("section");
  root.id = "wp-root";
  root.className = "wp-panel-host";
  root.dataset.wpUiBoundary = "extension-iframe";
  root.dataset.wpBuild = chrome.runtime.getManifest().version;
  root.setAttribute("aria-label", "WatchParty chat");
  root.setAttribute("aria-hidden", "true");
  root.inert = true;
  const shadow = root.attachShadow({ mode: "open" });
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = chrome.runtime.getURL("host.css");
  const frame = document.createElement("iframe");
  const session = crypto.randomUUID();
  const origin = chrome.runtime.getURL("").replace(/\/$/, "");
  frame.title = "WatchParty chat";
  frame.setAttribute("data-wp-panel", "");
  const parameters = new URLSearchParams({ session, parent: location.origin });
  frame.src = `${chrome.runtime.getURL("panel.html")}#${parameters}`;
  shadow.append(css, frame);
  const launcher = createPartyLauncher("wp-launcher", "Open WatchParty chat");
  launcher.setAttribute("aria-controls", "wp-root");
  launcher.setAttribute("aria-expanded", "false");

  // Compatibility references for the existing room/playback controllers. These
  // state-holder elements are never mounted in the streaming-service document.
  const refs = { root, launcher, frame, session, origin, sequence: 0,
    settingsName: document.createElement("input"), roomText: document.createElement("span"),
    connection: document.createElement("span"), resumeButton: document.createElement("button"),
    themeToggle: document.createElement("button") };
  refs.connection.textContent = "Not in a room";
  refs.resumeButton.hidden = true;
  let received = 0;
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (event.source !== frame.contentWindow || event.origin !== origin || !data ||
        data.channel !== "watchparty-ui" || data.session !== session ||
        !Number.isSafeInteger(data.sequence) || data.sequence <= received) return;
    if (data.type === "ready") {
      received = data.sequence;
      publishPartyView();
    } else if (data.type === "action" && ["open", "theme", "tab", "chat", "create", "copy", "save-name", "leave", "resume"].includes(data.action) &&
        data.payload && typeof data.payload === "object" && !Array.isArray(data.payload)) {
      received = data.sequence;
      if (data.action === "resume") refs.resumeButton.click();
      else partyAction(data.action, data.payload).catch(() => addLog("Could not complete that action. Try again.", "system"));
    }
  });
  frame.addEventListener("load", () => { received = 0; publishPartyView(); });
  new MutationObserver(publishPartyView).observe(refs.resumeButton, { attributes: true, attributeFilter: ["hidden"] });
  launcher.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setPanelOpen(!root.classList.contains("wp-open"));
  });
  mountRoot(root);
  attachLauncherToHeader(launcher);
  new MutationObserver(remountPartyUi).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("fullscreenchange", remountPartyUi);
  window.addEventListener("resize", layoutPartyPlayer);
  window.addEventListener("scroll", layoutPartyPlayer, { passive: true });
  if (!options.embedded) {
    chrome.storage.local.get(["wpTheme", "wpUsername"]).then((saved) => {
      setPartyTheme(saved.wpTheme);
      if (!refs.settingsName.value) refs.settingsName.value = saved.wpUsername || "";
    }).catch(() => {});
    chrome.storage.onChanged?.addListener((changes, area) => {
      if (area === "local" && changes.wpTheme) setPartyTheme(changes.wpTheme.newValue);
    });
  }
  queueMicrotask(remountPartyUi);
  return refs;
}

function currentPartyView() {
  return { open: ui.root.classList.contains("wp-open"), theme: partyTheme, tab: state.activeTab,
    connected: state.connected, username: state.username || "", room: state.room || "",
    count: state.userCount, status: ui.connection.textContent, history: partyHistory,
    resume: !ui.resumeButton.hidden };
}

function publishPanelView(view) {
  if (!partyUiOptions.hosted || !ui?.frame?.contentWindow) return;
  ui.frame.contentWindow.postMessage({ channel: "watchparty-ui", type: "state", session: ui.session,
    sequence: ++ui.sequence, view }, ui.origin);
}

function applyHostedPartyView(view) {
  applyingPartyView = true;
  try {
    state.connected = view.connected === true;
    state.username = String(view.username || "").slice(0, 40);
    state.room = String(view.room || "").slice(0, 80);
    state.userCount = Number.isFinite(view.count) ? Math.max(0, Math.floor(view.count)) : 0;
    state.activeTab = view.tab === "settings" ? "settings" : "chat";
    ui.settingsName.value = state.username;
    ui.roomText.textContent = state.room || "Not connected";
    ui.connection.textContent = view.status.slice(0, 200);
    ui.resumeButton.hidden = view.resume !== true;
    partyHistory.length = 0;
    for (const entry of view.history.slice(-100)) {
      if (!entry || typeof entry.text !== "string" || typeof entry.username !== "string" || !Number.isFinite(entry.timestamp)) continue;
      rememberPartyEvent(entry.kind === "chat" ? "chat" : "log", entry.username, entry.text.slice(0, 1000), entry.timestamp);
    }
    setPartyTheme(view.theme);
    setPanelOpen(view.open === true);
  } finally { applyingPartyView = false; }
  publishPanelView(currentPartyView());
}

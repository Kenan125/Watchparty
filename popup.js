const DEFAULT_SERVER = "ws://localhost:8787";

const els = {
  serverUrl: document.getElementById("serverUrl"),
  username: document.getElementById("username"),
  room: document.getElementById("room"),
  roomPassword: document.getElementById("roomPassword"),
  inviteCode: document.getElementById("inviteCode"),
  copyInviteBtn: document.getElementById("copyInviteBtn"),
  applyInviteBtn: document.getElementById("applyInviteBtn"),
  connectBtn: document.getElementById("connectBtn"),
  disconnectBtn: document.getElementById("disconnectBtn"),
  status: document.getElementById("status")
};

function setStatus(msg, cls) {
  els.status.textContent = msg;
  els.status.className = `status${cls ? ` ${cls}` : ""}`;
}

function isValidWsUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "ws:" || parsed.protocol === "wss:";
  } catch {
    return false;
  }
}

function toInviteCode(serverUrl, room, roomPassword) {
  const payload = {
    v: 1,
    serverUrl,
    room,
    roomPassword: roomPassword || ""
  };
  return `wp1:${btoa(JSON.stringify(payload))}`;
}

function parseInviteCode(code) {
  if (!code || !code.startsWith("wp1:")) {
    throw new Error("Invite code must start with wp1:");
  }

  const encoded = code.slice(4);
  const parsed = JSON.parse(atob(encoded));

  if (!parsed || parsed.v !== 1) {
    throw new Error("Unsupported invite code version");
  }

  if (!isValidWsUrl(parsed.serverUrl || "")) {
    throw new Error("Invite code contains invalid server URL");
  }

  return {
    serverUrl: (parsed.serverUrl || "").trim(),
    room: (parsed.room || "").trim(),
    roomPassword: (parsed.roomPassword || "").trim()
  };
}

function refreshInviteCode() {
  const serverUrl = (els.serverUrl.value || "").trim();
  const room = (els.room.value || "").trim();
  const roomPassword = (els.roomPassword.value || "").trim();

  if (!serverUrl || !room || !isValidWsUrl(serverUrl)) {
    els.inviteCode.value = "";
    return;
  }

  els.inviteCode.value = toInviteCode(serverUrl, room, roomPassword);
}

async function getActiveCrunchyrollTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];

  if (!tab || !tab.id || !tab.url) {
    return null;
  }

  const onCrunchyroll =
    tab.url.startsWith("https://www.crunchyroll.com/") ||
    tab.url.startsWith("https://beta.crunchyroll.com/");

  return onCrunchyroll ? tab : null;
}

async function restoreSettings() {
  const data = await chrome.storage.local.get([
    "wpServerUrl",
    "wpUsername",
    "wpRoom",
    "wpRoomPassword"
  ]);

  els.serverUrl.value = data.wpServerUrl || DEFAULT_SERVER;
  els.username.value = data.wpUsername || "";
  els.room.value = data.wpRoom || "";
  els.roomPassword.value = data.wpRoomPassword || "";
  refreshInviteCode();
}

async function sendToContent(message) {
  const tab = await getActiveCrunchyrollTab();
  if (!tab) {
    setStatus("Open a Crunchyroll episode tab first.", "warn");
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, message);
  } catch (err) {
    setStatus("Could not reach page script. Refresh Crunchyroll tab.", "err");
    return;
  }

  if (message.type === "WP_CONNECT") {
    setStatus(`Connected as ${message.payload.username} in room ${message.payload.room}.`, "ok");
  } else if (message.type === "WP_DISCONNECT") {
    setStatus("Disconnected.", "warn");
  }
}

els.connectBtn.addEventListener("click", async () => {
  const serverUrl = (els.serverUrl.value || "").trim();
  const username = (els.username.value || "").trim();
  const room = (els.room.value || "").trim();
  const roomPassword = (els.roomPassword.value || "").trim();

  if (!serverUrl || !username || !room) {
    setStatus("Server URL, username, and room are required.", "err");
    return;
  }

  if (!isValidWsUrl(serverUrl)) {
    setStatus("Server URL must start with ws:// or wss://", "err");
    return;
  }

  if (
    serverUrl.startsWith("ws://") &&
    !serverUrl.includes("localhost") &&
    !serverUrl.includes("127.0.0.1")
  ) {
    setStatus("Use wss:// for public servers (required on HTTPS pages).", "warn");
    return;
  }

  await chrome.storage.local.set({
    wpServerUrl: serverUrl,
    wpUsername: username,
    wpRoom: room,
    wpRoomPassword: roomPassword
  });

  await sendToContent({
    type: "WP_CONNECT",
    payload: { serverUrl, username, room, roomPassword }
  });
});

els.disconnectBtn.addEventListener("click", async () => {
  await sendToContent({ type: "WP_DISCONNECT" });
});

els.copyInviteBtn.addEventListener("click", async () => {
  refreshInviteCode();
  if (!els.inviteCode.value) {
    setStatus("Fill valid server URL + room to generate invite code.", "warn");
    return;
  }

  try {
    await navigator.clipboard.writeText(els.inviteCode.value);
    setStatus("Invite code copied.", "ok");
  } catch {
    setStatus("Clipboard blocked. Copy invite code manually.", "warn");
  }
});

els.applyInviteBtn.addEventListener("click", () => {
  const current = (els.inviteCode.value || "").trim();
  if (!current) {
    setStatus("Paste an invite code into the Invite Code field first.", "warn");
    return;
  }

  try {
    const parsed = parseInviteCode(current);
    els.serverUrl.value = parsed.serverUrl;
    els.room.value = parsed.room;
    els.roomPassword.value = parsed.roomPassword;
    setStatus("Invite code applied. Add your username and connect.", "ok");
  } catch (err) {
    setStatus(err.message || "Invalid invite code.", "err");
  }
});

[els.serverUrl, els.room, els.roomPassword].forEach((input) => {
  input.addEventListener("input", refreshInviteCode);
});

restoreSettings().catch(() => {
  setStatus("Failed to load previous settings.", "err");
});
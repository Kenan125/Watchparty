const RELAY_SERVER = "wss://watchparty-relay.onrender.com";

const els = {
  username: document.getElementById("username"),
  randomNameBtn: document.getElementById("randomNameBtn"),
  inviteCode: document.getElementById("inviteCode"),
  copyInviteBtn: document.getElementById("copyInviteBtn"),
  connectBtn: document.getElementById("connectBtn"),
  disconnectBtn: document.getElementById("disconnectBtn"),
  status: document.getElementById("status"),
  relayDot: document.getElementById("relayDot"),
  relayStatus: document.getElementById("relayStatus"),
  relayUsers: document.getElementById("relayUsers")
};

function setStatus(msg, cls) {
  els.status.textContent = msg;
  els.status.className = `status${cls ? ` ${cls}` : ""}`;
}

function setRelay(connected, userCount) {
  els.relayStatus.textContent = `Relay: ${connected ? "Connected" : "Disconnected"}`;
  els.relayDot.className = `dot ${connected ? "dot-on" : "dot-off"}`;
  if (connected && Number.isFinite(userCount) && userCount > 0) {
    els.relayUsers.textContent = `${userCount} user${userCount === 1 ? "" : "s"}`;
  } else {
    els.relayUsers.textContent = "";
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

function randomRoomName() {
  const partA = ["anime", "party", "otaku", "binge", "watch", "episode"];
  const partB = ["night", "club", "crew", "zone", "room", "squad"];
  const a = partA[Math.floor(Math.random() * partA.length)];
  const b = partB[Math.floor(Math.random() * partB.length)];
  const n = Math.floor(100 + Math.random() * 900);
  return `${a}-${b}-${n}`;
}

function toInviteLink(room, episodeUrl) {
  const payload = { v: 4, room };
  const encoded = btoa(JSON.stringify(payload));

  let base = "https://www.crunchyroll.com/";
  if (episodeUrl) {
    try {
      const normalized = new URL(episodeUrl);
      normalized.hash = "";
      normalized.searchParams.delete("wp");
      base = normalized.toString();
    } catch {
      base = "https://www.crunchyroll.com/";
    }
  }

  const inviteUrl = new URL(base);
  inviteUrl.searchParams.set("wp", encoded);
  return inviteUrl.toString();
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

async function queryRelayStatus() {
  const tab = await getActiveCrunchyrollTab();
  if (!tab) {
    setRelay(false);
    els.inviteCode.value = "";
    return null;
  }

  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { type: "WP_STATUS_REQUEST" });
    setRelay(Boolean(resp?.connected), Number(resp?.userCount));
    if (resp?.room) {
      els.inviteCode.value = toInviteLink(resp.room, tab.url);
    }
    return resp || null;
  } catch {
    setRelay(false);
    return null;
  }
}

async function restoreSettings() {
  const data = await chrome.storage.local.get(["wpUsername"]);
  els.username.value = data.wpUsername || randomGuestName();
  await queryRelayStatus();
}

async function sendToContent(message) {
  const tab = await getActiveCrunchyrollTab();
  if (!tab) {
    setStatus("Open a Crunchyroll episode tab first.", "warn");
    return false;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    setStatus("Could not reach page script. Refresh Crunchyroll tab.", "err");
    return false;
  }

  return true;
}

async function createRoomFromFields() {
  const username = (els.username.value || "").trim() || randomGuestName();
  const room = randomRoomName();

  els.username.value = username;
  await chrome.storage.local.set({ wpUsername: username });

  const sent = await sendToContent({
    type: "WP_CONNECT",
    payload: {
      serverUrl: RELAY_SERVER,
      username,
      room
    }
  });

  if (!sent) {
    return;
  }

  const tab = await getActiveCrunchyrollTab();
  els.inviteCode.value = toInviteLink(room, tab?.url);
  setRelay(true, 1);

  try {
    await navigator.clipboard.writeText(els.inviteCode.value);
    setStatus("Room created. Invite link copied.", "ok");
  } catch {
    setStatus("Room created. Copy invite link manually.", "ok");
  }

  setTimeout(() => {
    queryRelayStatus().catch(() => {});
  }, 600);
}

els.connectBtn.addEventListener("click", () => {
  createRoomFromFields().catch(() => {
    setStatus("Could not create room.", "err");
  });
});

els.disconnectBtn.addEventListener("click", async () => {
  const done = await sendToContent({ type: "WP_DISCONNECT" });
  if (done) {
    setStatus("Disconnected.", "warn");
    setRelay(false);
    els.inviteCode.value = "";
  }
});

els.copyInviteBtn.addEventListener("click", async () => {
  if (!els.inviteCode.value) {
    setStatus("Create a room first to generate invite link.", "warn");
    return;
  }
  try {
    await navigator.clipboard.writeText(els.inviteCode.value);
    setStatus("Invite link copied.", "ok");
  } catch {
    setStatus("Clipboard blocked. Copy invite link manually.", "warn");
  }
});

els.randomNameBtn.addEventListener("click", () => {
  els.username.value = randomGuestName();
  setStatus("Random guest name generated.", "ok");
});

restoreSettings().catch(() => {
  setStatus("Failed to load previous settings.", "err");
});

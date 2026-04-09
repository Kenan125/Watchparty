const RELAY_SERVER = "wss://watchparty-relay.onrender.com";

const els = {
  username: document.getElementById("username"),
  randomNameBtn: document.getElementById("randomNameBtn"),
  room: document.getElementById("room"),
  roomPassword: document.getElementById("roomPassword"),
  inviteCode: document.getElementById("inviteCode"),
  copyInviteBtn: document.getElementById("copyInviteBtn"),
  connectBtn: document.getElementById("connectBtn"),
  disconnectBtn: document.getElementById("disconnectBtn"),
  status: document.getElementById("status")
};

function setStatus(msg, cls) {
  els.status.textContent = msg;
  els.status.className = `status${cls ? ` ${cls}` : ""}`;
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

function toInviteLink(room, hasPassword, episodeUrl) {
  const payload = {
    v: 3,
    room,
    hasPassword: Boolean(hasPassword)
  };

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

async function refreshInviteCode() {
  const room = (els.room.value || "").trim();
  const roomPassword = (els.roomPassword.value || "").trim();

  if (!room) {
    els.inviteCode.value = "";
    return;
  }

  const tab = await getActiveCrunchyrollTab();
  const episodeUrl = tab?.url || "https://www.crunchyroll.com/";
  els.inviteCode.value = toInviteLink(room, Boolean(roomPassword), episodeUrl);
}

async function restoreSettings() {
  const data = await chrome.storage.local.get([
    "wpUsername",
    "wpRoom",
    "wpRoomPassword"
  ]);

  els.username.value = data.wpUsername || randomGuestName();
  els.room.value = data.wpRoom || "";
  els.roomPassword.value = data.wpRoomPassword || "";
  await refreshInviteCode();
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
  const room = (els.room.value || "").trim() || randomRoomName();
  const roomPassword = (els.roomPassword.value || "").trim();

  els.username.value = username;
  els.room.value = room;

  await chrome.storage.local.set({
    wpServerUrl: RELAY_SERVER,
    wpUsername: username,
    wpRoom: room,
    wpRoomPassword: roomPassword
  });

  const sent = await sendToContent({
    type: "WP_CONNECT",
    payload: {
      serverUrl: RELAY_SERVER,
      username,
      room,
      roomPassword
    }
  });

  if (!sent) {
    return;
  }

  await refreshInviteCode();
  if (els.inviteCode.value) {
    try {
      await navigator.clipboard.writeText(els.inviteCode.value);
      setStatus("Room created and connected. Invite link copied.", "ok");
    } catch {
      setStatus("Room created and connected. Copy invite link manually.", "ok");
    }
  } else {
    setStatus("Room created and connected.", "ok");
  }
}

els.connectBtn.addEventListener("click", async () => {
  await createRoomFromFields();
});

els.disconnectBtn.addEventListener("click", async () => {
  const done = await sendToContent({ type: "WP_DISCONNECT" });
  if (done) {
    setStatus("Disconnected.", "warn");
  }
});

els.copyInviteBtn.addEventListener("click", async () => {
  await refreshInviteCode();
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

[els.room, els.roomPassword].forEach((input) => {
  input.addEventListener("input", () => {
    refreshInviteCode().catch(() => {});
  });
});

restoreSettings().catch(() => {
  setStatus("Failed to load previous settings.", "err");
});
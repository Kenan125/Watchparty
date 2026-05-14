async function autoConnectFromInviteLink() {
  const invite = parseInviteFromUrl();
  if (!invite) {
    return;
  }

  stripInviteParamFromUrl();

  const saved = await chrome.storage.local.get(["wpUsername"]);
  const username = (saved.wpUsername || "").trim() || randomGuestName();
  ui.settingsName.value = username;

  addLog(`Invite loaded for room ${invite.room}. Connecting as ${username}...`, "system");

  connect({
    serverUrl: invite.serverUrl,
    username,
    room: invite.room
  });
}

async function saveDisplayName() {
  const desired = (ui.settingsName.value || "").trim() || randomGuestName();
  ui.settingsName.value = desired;

  await chrome.storage.local.set({ wpUsername: desired });

  if (!state.connected || !state.room) {
    state.username = desired;
    addLog(`Name saved as ${desired}.`, "system");
    return;
  }

  if (desired === state.username) {
    addLog(`Name is already ${desired}.`, "system");
    return;
  }

  addLog(`Changing name to ${desired}...`, "system");

  connect({
    serverUrl: state.serverUrl || RELAY_SERVER,
    username: desired,
    room: state.room
  });
}

async function copyInviteLink() {
  if (!state.room) {
    addLog("Connect to a room first to copy invite link.", "system");
    return;
  }

  const payload = { v: 4, room: state.room };

  const next = new URL(location.href);
  next.hash = "";
  next.searchParams.delete("wp");
  next.searchParams.set("wp", btoa(JSON.stringify(payload)));
  const inviteLink = next.toString();

  await navigator.clipboard.writeText(inviteLink);
  addLog("Invite link copied.", "system");
}

function parseInviteFromUrl() {
  let wp;
  try {
    wp = new URL(location.href).searchParams.get("wp");
  } catch {
    return null;
  }

  if (!wp) {
    return null;
  }

  try {
    const parsed = JSON.parse(atob(decodeURIComponent(wp)));
    if (!parsed || ![2, 3, 4].includes(parsed.v)) {
      return null;
    }

    if (!parsed.room) {
      return null;
    }

    return {
      serverUrl: String(parsed.serverUrl || RELAY_SERVER).trim(),
      room: String(parsed.room).trim()
    };
  } catch {
    return null;
  }
}

function stripInviteParamFromUrl() {
  try {
    const next = new URL(location.href);
    if (!next.searchParams.has("wp")) {
      return;
    }

    next.searchParams.delete("wp");
    const updated = `${next.pathname}${next.search}${next.hash}`;
    history.replaceState(null, "", updated);
  } catch {
    return;
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

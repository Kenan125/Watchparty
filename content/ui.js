let ui = null;

function buildUi(send) {
  partyUiOptions = { send };
  document.getElementById("wp-root")?.remove();

  const root = document.createElement("section");
  root.id = "wp-root";

  root.setAttribute("aria-label", "WatchParty chat");
  root.dataset.wpTheme = "dark";
  root.innerHTML = renderPartyPanel();
  document.body.append(root);

  const refs = {

    root,
    connection: root.querySelector("#wp-connection"),
    resumeButton: root.querySelector("#wp-enable-playback"),
    userCount: root.querySelector("#wp-user-count"),
    roomText: root.querySelector("#wp-settings-room"),
    chatTabBtn: root.querySelector("#wp-tab-btn-chat"),
    settingsTabBtn: root.querySelector("#wp-tab-btn-settings"),
    themeToggle: root.querySelector("#wp-theme-toggle"),
    closeBtn: root.querySelector("#wp-close"),
    chatTab: root.querySelector("#wp-tab-chat"),
    settingsTab: root.querySelector("#wp-tab-settings"),
    log: root.querySelector("#wp-log"),
    chat: root.querySelector("#wp-chat"),
    form: root.querySelector("#wp-chat-form"),
    input: root.querySelector("#wp-chat-input"),
    settingsName: root.querySelector("#wp-settings-name"),
    saveNameBtn: root.querySelector("#wp-settings-save-name"),
    copyInviteBtn: root.querySelector("#wp-settings-copy-link")
  };

  refs.closeBtn.addEventListener("click", () => window.close());
  refs.themeToggle.addEventListener("click", () => setPartyTheme(partyTheme === "dark" ? "light" : "dark", true));
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.stopPropagation(); window.close(); }
  });
  root.querySelector("#wp-create-room").addEventListener("click", () => partyAction("create").catch(() => addLog("Could not create a room. Try again.", "system")));
  root.querySelector("#wp-leave-room").addEventListener("click", () => partyAction("leave"));
  root.querySelector("#wp-copy-quick").addEventListener("click", () => partyAction("copy").catch(() => addLog("Could not copy invite link.", "system")));

  refs.chatTabBtn.addEventListener("click", () => {
    switchTab("chat");
  });

  refs.settingsTabBtn.addEventListener("click", () => {
    switchTab("settings");
  });

  refs.form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = refs.input.value.trim();
    if (!text || !state.connected) {
      return;
    }

    partyAction("chat", { text });
    refs.input.value = "";
  });

  refs.saveNameBtn.addEventListener("click", () => {
    partyAction("save-name", { username: refs.settingsName.value }).catch(() => {
      addLog("Could not update name.", "system");
    });
  });

  refs.copyInviteBtn.addEventListener("click", () => {
    partyAction("copy").catch(() => {
      addLog("Could not copy invite link.", "system");
    });
  });

  return refs;
}

function switchTab(tabName) {
  state.activeTab = tabName;

  const isChat = tabName === "chat";

  ui.chatTabBtn.classList.toggle("wp-active", isChat);
  ui.settingsTabBtn.classList.toggle("wp-active", !isChat);
  ui.chatTab.classList.toggle("wp-active", isChat);
  ui.settingsTab.classList.toggle("wp-active", !isChat);
  ui.chatTabBtn.setAttribute("aria-selected", String(isChat));
  ui.settingsTabBtn.setAttribute("aria-selected", String(!isChat));
  if (partyUiOptions.send && !applyingPartyView) partyUiOptions.send("tab", { tab: tabName });
}

function setConnectionStatus(text) {
  ui.connection.textContent = text;

  ui.root.dataset.connected = String(state.connected);
  ui.input.disabled = !state.connected;
  ui.root.querySelector("#wp-chat-send").disabled = !state.connected;
  ui.input.placeholder = state.connected ? "Message your party…" : "Join a room to chat";
  const empty = ui.root.querySelector("#wp-empty");
  empty.hidden = ui.chat.querySelector(".wp-message") !== null;
  empty.querySelector("h3").textContent = state.connected ? "Your room is ready." : "Better together.";
  empty.querySelector("p").textContent = state.connected ? "Send an invite. The best part is who's watching." : "Same moment. Your people. Create a room, send a link, settle in.";
  empty.querySelector("button").hidden = state.connected;

}

function setUserCount(count) {
  const safe = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  state.userCount = safe;
  ui.userCount.textContent = `${safe} watching`;
}

function addLog(text, kind, timestamp) {

  const line = document.createElement("div");
  line.className = `wp-line ${kind === "system" ? "wp-system" : "wp-user"}`;
  line.innerHTML = `<span class="wp-time">[${formatClock(timestamp || Date.now())}]</span> ${escapeHtml(text)}`;
  ui.log.appendChild(line);
  while (ui.log.children.length > 100) ui.log.firstElementChild.remove();
  ui.log.scrollTop = ui.log.scrollHeight;

}

function addChat(username, text, timestamp) {

  const line = document.createElement("div");
  line.className = "wp-message";
  if (username === state.username) line.classList.add("wp-message-own");
  const avatar = document.createElement("span");
  avatar.className = "wp-avatar";
  avatar.textContent = String(username || "?").slice(0, 1).toUpperCase();
  const body = document.createElement("div");
  body.className = "wp-message-body";
  const heading = document.createElement("div");
  heading.className = "wp-message-heading";
  const name = document.createElement("strong");
  name.textContent = username;
  const time = document.createElement("time");
  const date = new Date(Number.isFinite(timestamp) ? timestamp : Date.now());
  if (!Number.isFinite(date.getTime())) date.setTime(Date.now());
  time.dateTime = date.toISOString();
  time.textContent = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  heading.append(name, time);
  const message = document.createElement("p");
  message.textContent = text;
  body.append(heading, message);
  line.append(avatar, body);
  ui.chat.appendChild(line);
  ui.root.querySelector("#wp-empty").hidden = true;
  while (ui.chat.querySelectorAll(".wp-message").length > 100) ui.chat.querySelector(".wp-message").remove();
  ui.chat.scrollTop = ui.chat.scrollHeight;

}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatClock(ms) {
  const d = new Date(ms);
  return d.toLocaleTimeString();
}

ui = buildUi();
setupAutoResumeUnlock();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) {
    return;
  }

  if (message.type === "WP_CONNECT") {
    connect(message.payload);
    return;
  }

  if (message.type === "WP_DISCONNECT") {
    disconnect(true);
    return;
  }

  if (message.type === "WP_STATUS_REQUEST") {
    sendResponse({
      connected: state.connected,
      room: state.room,
      username: state.username,
      userCount: state.userCount
    });
    return;
  }
});

autoConnectFromInviteLink().catch(() => {});

window.addEventListener("beforeunload", () => {
  disconnect(false);
});

addLog("WatchParty loaded. Connect from extension popup.", "system");

setupSidePanel();
setupPlayerBridge();
setupLocalSeekListener(handleLocalPlayerControl);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) {
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

addLog("WatchParty loaded. Open the extension side panel to start a room.", "system");

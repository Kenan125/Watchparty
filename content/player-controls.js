function setupLocalSeekListener(callback) {
  document.addEventListener("watchparty-local-seek", (event) => {
    const notice = event.target;
    if (!(notice instanceof Element) || notice.tagName !== "WATCHPARTY-LOCAL-SEEK") return;
    const action = notice.getAttribute("action");
    const time = Number(notice.getAttribute("time"));
    if (["play", "pause"].includes(action) || (action === "seek" && Number.isFinite(time) && time >= 0)) callback(action, time);
  }, true);
}

function seekCrunchyrollPlayer(player, time) {
  // Embedded players execute this helper in their own document.
  if (typeof player.seekTo === "function") {
    player.seekTo(time);
    return;
  }
  const request = document.createElement("watchparty-seek");
  request.hidden = true;
  request.setAttribute("time", String(time));
  document.documentElement.appendChild(request);
  try {
    request.dispatchEvent(new Event("watchparty-seek", { bubbles: true }));
    const result = request.getAttribute("result");
    if (result === "failed") throw new Error(request.getAttribute("error") || "Crunchyroll seek failed");
    // Older Vilos players may not expose either of the React control APIs.
    if (result !== "applied") player.currentTime = time;
  } finally {
    request.remove();
  }
}

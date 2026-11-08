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

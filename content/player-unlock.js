// Chrome may require activation inside the cross-origin player, not the panel.
function createPlaybackUnlock() {
  const host = document.createElement("span");
  host.id = "wp-player-unlock";
  host.setAttribute("role", "button");
  host.setAttribute("tabindex", "0");
  host.setAttribute("aria-label", "Enable WatchParty playback");
  const shadow = host.attachShadow({ mode: "open" });
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = chrome.runtime.getURL("host.css");
  const text = document.createElement("span");
  text.textContent = "Enable WatchParty playback";
  shadow.append(css, text);
  host.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      host.click();
    }
  });
  return host;
}

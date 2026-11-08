// MAIN world: React's player objects are not visible to isolated content scripts.
(() => {
  function fiber(element) {
    const key = element && Object.keys(element).find((name) => name.startsWith("__reactFiber$"));
    return key ? element[key] : null;
  }

  function seek(time) {
    // Use the same Crunchyroll player-control path as the installed reference.
    const container = fiber(document.querySelector("#player-container"));
    const player = container?.return?.stateNode?.player?._viewModels?.nextEpisodeVM?._player;
    if (typeof player?.seek === "function") {
      player.seek(time);
      return true;
    }
    const controls = fiber(document.querySelector('[data-testid="bottom-controls-autohide"]'));
    const seekTo = controls?.child?.child?.child?.child?.memoizedProps?.seekTo;
    if (typeof seekTo === "function") {
      seekTo(time);
      return true;
    }
    return false;
  }

  // A synchronous DOM bridge keeps the seek in the originating command's order.
  document.addEventListener("watchparty-seek", (event) => {
    const request = event.target;
    if (!(request instanceof Element) || request.tagName !== "WATCHPARTY-SEEK") return;
    const time = Number(request.getAttribute("time"));
    if (!Number.isFinite(time) || time < 0) return;
    try {
      request.setAttribute("result", seek(time) ? "applied" : "unavailable");
    } catch (error) {
      request.setAttribute("result", "failed");
      request.setAttribute("error", String(error.message || error));
    }
  }, true);
})();

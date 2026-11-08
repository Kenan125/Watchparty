// MAIN world: React's player objects are not visible to isolated content scripts.
(() => {
  let applyingRemoteSeek = false;
  const wrappedSeek = Symbol("watchparty-seek");
  function fiber(element) {
    const key = element && Object.keys(element).find((name) => name.startsWith("__reactFiber$"));
    return key ? element[key] : null;
  }

  function seekControl() {
    // Use the same Crunchyroll player-control path as the installed reference.
    const container = fiber(document.querySelector("#player-container"));
    const player = container?.return?.stateNode?.player?._viewModels?.nextEpisodeVM?._player;
    if (typeof player?.seek === "function") {
      return { owner: player, name: "seek" };
    }
    const controls = fiber(document.querySelector('[data-testid="bottom-controls-autohide"]'));
    const props = controls?.child?.child?.child?.child?.memoizedProps;
    if (typeof props?.seekTo === "function") {
      return { owner: props, name: "seekTo" };
    }
    return null;
  }

  function installSeekHook() {
    const control = seekControl();
    if (!control) return null;
    const { owner, name } = control;
    hookControl(owner, name, "seek");
    if (name === "seek") {
      hookControl(owner, "play", "play");
      hookControl(owner, "pause", "pause");
    }
    return control;
  }

  function hookControl(owner, name, action) {
    const original = owner[name];
    if (typeof original === "function" && !original[wrappedSeek]) {
      const wrapped = function (...args) {
        const time = Number(args[0]);
        if (!applyingRemoteSeek && (action !== "seek" || (Number.isFinite(time) && time >= 0))) {
          const notice = document.createElement("watchparty-local-seek");
          notice.hidden = true;
          notice.setAttribute("action", action);
          if (action === "seek") notice.setAttribute("time", String(time));
          document.documentElement.appendChild(notice);
          try {
            notice.dispatchEvent(new Event("watchparty-local-seek", { bubbles: true }));
          } finally {
            notice.remove();
          }
        }
        return original.apply(this, args);
      };
      wrapped[wrappedSeek] = true;
      try { owner[name] = wrapped; } catch { /* Frozen props retain the native-event fallback. */ }
    }
  }

  // A synchronous DOM bridge keeps the seek in the originating command's order.
  document.addEventListener("watchparty-seek", (event) => {
    const request = event.target;
    if (!(request instanceof Element) || request.tagName !== "WATCHPARTY-SEEK") return;
    const time = Number(request.getAttribute("time"));
    if (!Number.isFinite(time) || time < 0) return;
    applyingRemoteSeek = true;
    try {
      const control = installSeekHook();
      if (control) control.owner[control.name](time);
      request.setAttribute("result", control ? "applied" : "unavailable");
    } catch (error) {
      request.setAttribute("result", "failed");
      request.setAttribute("error", String(error.message || error));
    } finally {
      applyingRemoteSeek = false;
    }
  }, true);
  installSeekHook();
  setInterval(installSeekHook, 250);
})();

# Project guidance

Instructions for all coding agents working in WatchParty.

## Architecture

Chrome's **native Side Panel is the only chat and room UI**. Crunchyroll is the
first supported service; do not claim other integrations work. There is no popup,
header shortcut, injected chat iframe, player mirror, or fullscreen chat overlay.

- `background.js` configures toolbar clicks to open `panel.html` using `chrome.sidePanel`.
- `panel.js`, `content/ui-view.js`, and `content/ui.js` are presentation only.
  The panel follows the active tab in its own browser window through a frame-0
  `tabs.connect` port named `watchparty-side-panel`. Clear drafts/history across tabs.
- The top Crunchyroll content script owns the **only room WebSocket**.
  `content/side-panel.js` holds bounded history, validates panel actions, and publishes
  snapshots. Room state is plain data, never detached DOM elements. Closing the
  panel does not leave the room; Leave room or closing/refreshing the streaming tab does.
- `content/shared.js`: constants/state and the single production relay URL,
  `wss://watchparty-relay.onrender.com`. `content/network.js`: handshake/reconnect/routing.
- `content/player-sync.js`: native video and embedded `FramePlayer` synchronization.
- `content/player-bridge.js`: exact origin/window/session/sequence validation for
  cross-origin media commands; reset sessions when the iframe reloads.
- `content/player-frame.js`: media-only embedded adapter. `content/player-unlock.js`
  creates the only player-local UI, an autoplay-unlock button in Shadow DOM.
  A Side Panel click cannot be assumed to unlock a cross-origin player.
- `content/player-controls-main.js`: MAIN-world Crunchyroll player integration.
  `content/player-controls.js`: isolated-world seek/control bridge. Preserve native
  fallback, immediate local intent, and remote-event suppression.
- `content/invite.js`: invite parsing/stripping and display-name persistence.
- `relay-server/server.js`: in-memory protocol-2 room/timeline server, not a dumb
  broadcaster. The server assigns identities, controller roles, and ordered revisions.
  A valid protocol-2 `welcome`, not socket open, makes the client online.
  `render.yaml` drives deployment. No room authentication or durable chat storage.

## Playback and invites

Normalize episode keys to `/watch/{id}` regardless of locale/slug. Never advance
paused/buffering snapshots. Preserve ordered revisions, bounded transit age,
monotonic projection, one reporter per episode, and actual seek completion.
Do not replace seek suppression with a fixed timeout. Respect local scrubbing;
cancel obsolete autoplay work on pause/navigation/disconnect. Restore replacement
players before publishing their default position.

Invites use a `wp` query parameter encoding JSON `{ v: 4, room }` in base64.
Parse versions 2, 3, and 4; honor legacy `serverUrl` overrides. New invites omit
that URL. Strip the invite using `history.replaceState` after loading.

## Build and styling

Plain JavaScript, Manifest V3, Node.js 22+, no JS bundler/TypeScript. Requires a
browser supporting the Side Panel API (Chrome 116+). Approved permissions are
`storage`, `tabs`, `sidePanel`, and the manifest's Crunchyroll host scopes. Ask
before adding permissions. Only `wpUsername` and `wpTheme` persist locally.

Use Tailwind `wp:` utilities or `@apply` in `styles/content.css` and `styles/host.css`,
sharing `styles/foundation.css`. Root CSS is generated. All normal/watch builds
use `scripts/build-css.js` to namespace `--tw-*` as `--wp-tw-*`; Preflight remains
disabled. Scan runtime UI files only. No handcrafted/inline styles or CDN Tailwind.
`content.css` loads only in the Side Panel; `host.css` only in unlock Shadow DOM.
Content-script `css` fields stay absent. Never resize/reclass/restyle native media
or controls. Browser chrome may be hidden in fullscreen; do not promise fullscreen chat.

- `npm run package:extension`: build CSS; whitelist assets into `build/extension`.
- Reload the unpacked extension there, then fully refresh existing streaming tabs.
- `npm run check`: JavaScript/manifest checks. `npm test`: unit and real relay tests.
- `npm run test:browser`: local native-media and unpacked MV3 browser tests.
- `npm run verify`: CSS build, checks, unit tests, browser tests.
- `npm run watch:css:content` / `npm run watch:css:host`: isolated CSS watch builds.
- `npm start --prefix relay-server`: local relay on port 8787; `/health` reports protocol.

## Workflow

Automatically use `karpathy-guidelines` here, not `ponytail`. Use project-local
`frontend-design` for UI work. Never use/reinstall Graphify or regenerate its output.
Preserve unrelated dirty files and personal notes. Do not edit old ZIP bundles.
Keep checks proportional: run relevant coverage once, then rerun only after fixes.
Do not add repetitive scaffolding or hide failures. Fix stale test dependencies.
GitHub Actions runs `npm run verify` on push/PR. Read exact-head checks before
merging; a local smoke is not CI success. Merge only with user acceptance and
read back the merge/remote state. Check production `/health` for matching protocol
before shipping. Local fixtures do not prove live Crunchyroll DRM compatibility.

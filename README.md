# WatchParty

**Different places. Same movie night.**

WatchParty is a browser extension for watching together: synchronized playback,
room invite links, and chat in Chrome's native Side Panel. Everyone streams through their own
account; WatchParty does not share passwords or rebroadcast the video.

The project is intended to grow across streaming services. **Crunchyroll is the
first supported service today.** Other integrations are planned, not yet available.

## What it does

- Keeps play, pause, and seeking in sync across a room.
- Lets friends join through an invite link.
- Keeps chat and room settings beside the page in the browser's Side Panel.
- Offers a dark-first interface and an optional light theme.
- Uses a small WebSocket relay for room messages and playback state.

## Run locally

Requires Node.js 22+ and a Chromium browser with the Side Panel API (Chrome 116+).

```sh
npm ci
npm ci --prefix relay-server
npm run package:extension
```

Open your browser's extensions page, enable **Developer mode**, and load
`build/extension` using **Load unpacked**. Open a Crunchyroll episode, click the
WatchParty toolbar icon to open the Side Panel, create a room,
and share its invite link. Each participant needs the extension and their own
access to the same episode.

The Room view identifies this build as **v2.0.4 · Experimental side panel**. After
updating, reload the extension and fully refresh existing streaming tabs; SPA
navigation does not remove CSS already injected by an older version.

For a local relay, run `npm start --prefix relay-server`. Keep production deployment
settings outside public setup examples; never commit credentials or private invite links.

## Development

The extension is plain JavaScript (Manifest V3), with Tailwind CSS and a Node.js
WebSocket relay. The top page owns the room connection; the embedded player uses
a validated message bridge for playback. Chat renders in a native extension
Side Panel, connected to the active Crunchyroll tab through an extension port.
Switching tabs shows that tab's room; closing the panel does not leave the room.
The page never receives our UI stylesheet. Only the frame-local autoplay-unlock
button remains in the embedded player, with styles confined to Shadow DOM.

- `npm run build:css` compiles `styles/` into the root stylesheets.
- `npm run watch:css:popup` / `npm run watch:css:content` rebuild styles while editing.
- `npm run watch:css:host` rebuilds only the isolated launcher/shell styles.
- `npm run check` checks JavaScript syntax and manifest consistency.
- `npm test` runs Node tests.
- Existing overlay browser tests target the previous UI and are not acceptance tests for this experimental branch.
- `npm run verify` builds CSS and runs all checks; packaging also builds CSS automatically.

Use Tailwind for styling. Do not edit generated `popup.css`, `content.css`, or `host.css`.
The chat stylesheet loads only inside `panel.html`, not through content-script CSS
injection. Preflight is disabled and Tailwind internals remain namespaced as defense
in depth. WatchParty never resizes or restyles native video controls. Test new
service integrations before adding their host permissions or claiming support.

## Privacy and limitations

Display name and theme preference are stored locally. The relay holds room state
in memory, with no durable chat history. Room links are not authentication:
anyone with a link can join and control playback, so share them only with people
you trust and do not send sensitive information in chat.

Automated tests use local media, not streaming-service accounts or DRM. Real
playback, autoplay rules, ad differences, and site changes still need service-specific
verification. WatchParty is independent of the streaming services it supports.

The native Side Panel is browser chrome, not part of player fullscreen. It may
be hidden in fullscreen depending on the browser. Use windowed playback for chat.
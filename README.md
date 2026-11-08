# Crunchyroll WatchParty

Chrome/Chromium Manifest V3 extension with synchronized playback, invite links,
chat, and a WebSocket relay. There is no bundler; a packaging command copies only
runtime assets into a clean folder that Brave/Chrome can load.

## Install and use

1. Run `npm run package:extension`, then open `brave://extensions` (or
   `chrome://extensions`), enable Developer mode, and load `build/extension`.
2. Open a Crunchyroll episode, open the extension popup, and click **Create Room**.
3. Share the copied invite link. Other participants need the same extension version
   and access to the episode through their own Crunchyroll accounts.
4. Use the normal video controls. Anyone can play, pause, change speed, or seek.
5. If Chrome blocks remote autoplay, click **Enable WatchParty playback** inside the
   video frame. A click on the surrounding page may not unlock a cross-origin frame.

The approved site permissions cover `www`, `beta`, and `static.crunchyroll.com`.
Only the top frame creates the panel and WebSocket connection. A small script in
the static-domain Vilos player forwards native media state/events and executes
validated player commands. It does not create another panel or join the room.
Direct, top-document video elements are also supported.

## Synchronization

**Version 2.0.0 requires relay protocol 2. Deploy the relay and update every
participant's extension together.** Old relays/clients are deliberately rejected
instead of silently falling back to the broken broadcast protocol.

- The relay maintains one in-memory timeline per room and episode and assigns
  monotonically increasing revisions. Old revisions and other episodes are ignored.
- Any explicit user control becomes the latest ordered intent and makes that client
  the controller. Only that controller publishes actual playback samples, once a
  second. Reports from previous controllers are ignored.
- Joining does not pause existing viewers. The new participant receives the current
  timeline, not competing snapshots from every member.
- Paused/buffering positions do not advance. Clock ping/pong estimates relay offset;
  local projection uses monotonic elapsed time, counts latency once, and expires
  after five seconds without a fresh sample.
- Small drift uses bounded playback-speed correction; large drift or explicit
  controls seek to the current authoritative position. Buffering does not trigger
  repeated pause/play kicks or fabricated native media events.
- Native seek completion, not an 800ms suppression timer, ends remote seek handling.
  Metadata loading, player replacement, reconnects, and SPA episode changes retain
  or reset the appropriate timeline rather than replaying obsolete targets.
- A departing controller hands control to a ready participant on the same episode.
  Rooms disappear when empty; the relay has no database or durable playback history.

## Development and tests

Node.js 22 or newer is recommended.

```sh
npm ci
npm ci --prefix relay-server
npx playwright install chromium
npm run verify
npm run package:extension
```

`npm test` runs deterministic player/network regressions and real WebSocket relay
integration tests. `npm run test:browser` runs native video tests in headless Chromium,
including the actual unpacked extension in cross-origin HTTPS frame fixtures and
real autoplay denial. These tests use isolated profiles, not your open browser.
They use local test video, not Crunchyroll content, accounts, or DRM.

GitHub Actions runs the syntax/manifest checks and both test suites on pushes and
pull requests. A passing local run does not mean that workflow has run remotely.

Start a local relay:

```sh
npm start --prefix relay-server
```

It listens at `ws://localhost:8787`; `http://localhost:8787/health` returns
`{"ok":true,"protocol":2,"rooms":0}` when no rooms exist. `PORT` overrides the port.

## Deployment

`render.yaml` configures the Node relay using `npm ci`, `npm start`, and `/health`.
The deployed endpoint is `wss://watchparty-relay.onrender.com`. To change it, update
both `popup.js` and `content/shared.js`; `npm run check` enforces that they match.

1. Run `npm run verify` and review/merge the change through your deployment workflow.
2. Deploy the new relay and verify `/health` reports `"protocol":2`.
3. Reload the extension and refresh all Crunchyroll tabs. Update every participant.

The repository does not grant access to the Render service. Deployment is a separate
operation; editing the relay or the workflow does not update the live service.

## Invites and local manual verification

Invites use a `wp` URL query parameter containing base64 JSON `{v:4,room}`. Versions
2 and 3 remain accepted, including their optional `serverUrl`, for compatibility and
local testing. Newly generated production links use the configured relay.

For a local two-tab test without changing the production relay constants, append
`?wp=` plus the URL-encoded base64 of
`{"v":3,"room":"local-check","serverUrl":"ws://localhost:8787"}` to the same episode
URL in both tabs. Chrome may request local-network access for this loopback relay;
that is a browser permission for local testing, not an extra extension permission.

Before calling a release production-ready, verify real Crunchyroll playback:

- Same episode in two clients: pause/resume, forward seek, and repeated backward seeks.
- Play for at least one minute without a jump back or a stuck/muted receiver.
- Join while playing and while paused; reconnect a participant.
- Exercise a seek during buffering and a remote play before the receiver has clicked.
- Navigate to the next episode, then return; other episodes must not affect playback.

Automated native media tests cannot establish Crunchyroll DRM, ads, or account-specific
player behavior. Ad timelines that differ between accounts are not normalized.

## Security and limitations

The relay has input/size validation and connection liveness checks but no
authentication or rate limiting. Anyone with the room link can participate and
control playback. Do not use room chat for sensitive information. Internet relays
should use `wss://`. Only the display name (`wpUsername`) is persisted locally.
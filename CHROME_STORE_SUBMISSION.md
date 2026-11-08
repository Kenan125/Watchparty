# Chrome Web Store submission

## Build the upload

Run `npm run package:extension`, then ZIP the **contents** of `build/extension`
with `manifest.json` at the archive root. Do not upload the repository or reuse an
old ZIP. This checklist is not a claim of store approval or live-service verification.

## Listing

- Name: WatchParty — Watch together
- Description: Synchronized playback, room invites, and Side Panel chat. Currently supports Crunchyroll.
- Category: Social Communication
- Browser requirement: Chrome 116+ / compatible Side Panel API.

The toolbar opens the native Side Panel. There is no popup, header icon, or player
chat overlay. Everyone uses their own streaming account and episode access.

## Permission justifications

- `storage`: persist only display name (`wpUsername`) and theme (`wpTheme`).
- `tabs`: identify the active tab in the panel's window and connect the panel to
  that tab's content script. Do not claim browsing-history collection.
- `sidePanel`: show chat, room actions, invites, name, and theme in browser UI.
- `https://www.crunchyroll.com/*` and `https://beta.crunchyroll.com/*`: episode
  identity, invite handling, and playback synchronization.
- `https://static.crunchyroll.com/*`: embedded Vilos player access. It forwards
  media commands/state only and never opens a separate room connection.

## Before submission

1. Check manifest/package versions and package assets.
2. Require matching production relay protocol at `/health` and production `wss://`.
3. Check GitHub CI and manually verify supported-service playback and autoplay.
4. Publish [PRIVACY_POLICY.md](PRIVACY_POLICY.md) at an accessible URL and supply a real support contact.
5. Use screenshots of the Side Panel's Chat/Room views and real synchronized clients.
   Do not use retired popup/overlay screenshots or claim fullscreen chat.
6. Explain the Side Panel permission addition for review, then upload the new archive.

For updates, bump manifest/package/lockfile versions together and rebuild.

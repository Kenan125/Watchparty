# Privacy Policy for WatchParty

Effective date: November 8, 2026

## Overview

WatchParty is a browser extension that synchronizes video controls and chat messages between users in a shared room. Crunchyroll is the first supported service.

## Data We Collect

The extension stores the display name (`wpUsername`) and light/dark theme preference (`wpTheme`) in Chrome extension storage.
Relay URLs, room membership, and playback state are kept in memory while connected.
The extension does not store or request a Crunchyroll password or authentication token.

The extension does not collect personal identifiers beyond what users voluntarily enter in the username field.

## Data Sent Over Network

When connected to a relay server, the extension sends:

- Room events (join/leave)
- Playback controls and periodic playback position, paused/buffering state, and speed
- Chat messages
- Current supported episode page key used to prevent cross-episode sync (not a general browsing-history log)

This data is transmitted to the configured relay server so room participants can receive synchronized updates.
The embedded-player script runs on `static.crunchyroll.com` to access the video.
It exchanges media state and playback commands with the Crunchyroll page; only the top page
connects to the relay. Chat and room controls appear in the native browser Side Panel,
which connects to the active supported tab through an extension message port.
Video/audio content and DRM credentials are not transmitted.

## Data Sharing

Data is shared only with participants in the same room through the selected relay server.

## Data Retention

- Local settings remain in browser storage until user changes or clears them.
- The included relay retains room membership and the latest per-episode playback
  timeline in memory until the room becomes empty; it does not persist chat history.
  Hosting-provider logs are governed by that provider.

## Third-Party Services

If using a hosted relay service (for example Render), network traffic passes through that provider.

## Security

For public use, users should connect with `wss://` relay URLs.

## User Controls

Users can:

- Disconnect at any time using Leave room in the Side Panel (closing the panel alone does not disconnect)
- Change display name or create/join a different room
- Remove extension to clear behavior
- Clear extension storage from browser settings

## Contact

For privacy questions and support, contact the project through [WatchParty's GitHub issues](https://github.com/Kenan125/Watchparty/issues). Do not include passwords, private room links, or sensitive information in public issues.
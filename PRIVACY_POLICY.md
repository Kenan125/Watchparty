# Privacy Policy for Crunchyroll WatchParty

Effective date: April 10, 2026

## Overview

Crunchyroll WatchParty is a browser extension that synchronizes video controls and chat messages between users in a shared room.

## Data We Collect

The extension stores only the display name (`wpUsername`) in Chrome extension storage.
Relay URLs, room membership, and playback state are kept in memory while connected.
The extension does not store or request a Crunchyroll password or authentication token.

The extension does not collect personal identifiers beyond what users voluntarily enter in the username field.

## Data Sent Over Network

When connected to a relay server, the extension sends:

- Room events (join/leave)
- Playback controls and periodic playback position, paused/buffering state, and speed
- Chat messages
- Episode page key used to prevent cross-episode sync

This data is transmitted to the configured relay server so room participants can receive synchronized updates.
The embedded-player script runs on `static.crunchyroll.com` to access the video.
It exchanges media state and commands with the Crunchyroll page; only the top page
connects to the relay. Video/audio content and DRM credentials are not transmitted.

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

- Disconnect at any time
- Change display name or create/join a different room
- Remove extension to clear behavior
- Clear extension storage from browser settings

## Contact

If you publish this extension, replace this section with your support email or project contact link.
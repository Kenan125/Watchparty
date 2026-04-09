# Privacy Policy for Crunchyroll WatchParty

Effective date: April 10, 2026

## Overview

Crunchyroll WatchParty is a browser extension that synchronizes video controls and chat messages between users in a shared room.

## Data We Collect

The extension stores the following data locally in the browser using Chrome extension storage:

- Relay server URL
- Username
- Room code
- Optional room password

The extension does not collect personal identifiers beyond what users voluntarily enter in the username field.

## Data Sent Over Network

When connected to a relay server, the extension sends:

- Room events (join/leave)
- Playback control events (pause/play/seek with timestamp)
- Chat messages
- Episode page key used to prevent cross-episode sync

This data is transmitted to the configured relay server so room participants can receive synchronized updates.

## Data Sharing

Data is shared only with participants in the same room through the selected relay server.

## Data Retention

- Local settings remain in browser storage until user changes or clears them.
- Relay server behavior depends on server implementation and hosting logs.

## Third-Party Services

If using a hosted relay service (for example Render), network traffic passes through that provider.

## Security

For public use, users should connect with `wss://` relay URLs.

## User Controls

Users can:

- Disconnect at any time
- Change username/room/password at any time
- Remove extension to clear behavior
- Clear extension storage from browser settings

## Contact

If you publish this extension, replace this section with your support email or project contact link.
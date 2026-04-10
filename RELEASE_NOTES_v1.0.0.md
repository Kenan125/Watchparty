# Release Title

Crunchyroll WatchParty v1.0.0 - Public Launch (Synced Playback, Chat, and Invite Links)

## Release Notes

This is the first public release of Crunchyroll WatchParty.

WatchParty lets friends watch the same Crunchyroll episode together with synced controls, in-page chat, and room activity logs.

### Highlights

- Synced playback actions across room members: play, pause, and seek/jump.
- In-page chat overlay with room event logs and timestamps.
- Invite-link flow to quickly bring others into the same room.
- Optional room password support for private room access.
- Automatic unique guest naming and username conflict handling.
- Member count updates and stronger room/session state handling.

### Included In This Release

- Chrome extension popup for server URL, username, room code, and room password.
- Crunchyroll in-page WatchParty panel for chat, logs, and quick settings.
- Relay server for WebSocket room messaging with room lifecycle handling.
- Render deployment blueprint (`render.yaml`) for easier public hosting.
- Chrome Web Store submission and privacy policy documentation.

### Improvements During Finalization

- Improved playback intent handling for better sync reliability.
- Hardened state management for reconnect and disconnect paths.
- Refined side panel UI and playback sync behavior.
- Simplified room creation flow and auto-copy invite experience.

### Notes

- Playback sync is ignored when users are on different episode URLs.
- For internet use, configure a public `wss://` relay URL.
- Browser autoplay policies may require local user interaction before auto-play can start.

### Thank You

Thanks for trying Crunchyroll WatchParty. Feedback from real watch sessions will guide the next updates.

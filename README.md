# Crunchyroll WatchParty Extension

This project is a complete watch party setup:

- Chrome extension UI for username + room.
- Playback sync across party members.
- Chat box on Crunchyroll pages.
- Event log with timestamps (join, leave, pause, resume, jump).
- WebSocket relay server for public internet use.

## Features

- Popup GUI for:
  - server URL
  - username
  - room code
  - optional room password
  - invite code copy/apply
- In-page panel for:
  - live chat
  - activity logs with timestamps
- Playback sync actions:
  - pause
  - resume/play
  - seek/jump
- Episode safety:
  - sync actions are ignored if someone is on a different episode URL

## Local Development

From project root:

```bash
cd relay-server
npm install
npm start
```

Local relay URL:

`ws://localhost:8787`

## Internet Deployment (for everyone)

For real public use, deploy relay server and use a `wss://` URL.

### Option A: Render (recommended)

This repo includes [render.yaml](render.yaml), so Render can auto-configure your service.

1. Push this project to GitHub.
2. Create a new Render Blueprint from that repo.
3. Deploy.
4. Your service URL will look like:
   - `https://watchparty-relay-xxxx.onrender.com`
5. In extension popup, set server URL to:
   - `wss://watchparty-relay-xxxx.onrender.com`

Health check endpoint:

- `https://watchparty-relay-xxxx.onrender.com/health`

## Load Extension in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project root folder (`watchparty`).

## Party Setup Steps

1. All users install/load the extension.
2. All users open the same Crunchyroll episode page.
3. All users click extension icon and enter:
   - same server URL (`wss://...` for internet, `ws://localhost:8787` for same machine testing)
   - unique username
   - same room code (example: `one-piece-sunday`)
  - same room password if host set one
4. Click **Connect**.
5. Use video controls normally; events sync to the room.

## Invite Code

The popup generates an invite code in this format: `wp1:...`

- **Copy** shares server URL + room + room password.
- Another user can paste it in the Invite Code field and click **Apply**.
- They only need to enter their own username and connect.

## Troubleshooting

- If popup says it cannot reach page script:
  - refresh the Crunchyroll tab and try again.
- If sync seems blocked between remote users:
  - ensure server URL is `wss://` and publicly reachable.
- If play action does not auto-start on some clients:
  - browser autoplay policy requires user interaction first.
- If someone is on a different episode:
  - they still get chat/logs, but playback sync from that page is ignored.

## Security and Limitations

- This relay is a simple room broadcast service with no authentication.
- Do not use it for sensitive/private chats.
- For production hardening, add auth tokens and rate limiting at the server edge.
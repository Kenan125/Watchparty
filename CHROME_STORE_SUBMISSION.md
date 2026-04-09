# Chrome Web Store Submission Guide

This project is ready for Chrome Web Store submission.

## 1) Upload Package

Upload this file to the Developer Dashboard:

- [watchparty-chrome-store.zip](watchparty-chrome-store.zip)

## 2) Required Store Listing Fields

Use these suggested values and adjust as you like.

- Name: Crunchyroll WatchParty
- Short description: Watch Crunchyroll together with synced playback, chat, and room events.
- Category: Social Communication
- Language: English

## 3) Permission Justifications

### `storage`

Used to save user settings locally:

- relay server URL
- username
- room code
- optional room password

### `tabs`

Used to message the active Crunchyroll tab when user clicks Connect/Disconnect from the extension popup.

### Host permissions

The extension only injects on:

- `https://www.crunchyroll.com/*`
- `https://beta.crunchyroll.com/*`

Reason: watch party controls and chat overlay are only needed on Crunchyroll video pages.

## 4) Privacy Disclosure

Use this document as your privacy policy content:

- [PRIVACY_POLICY.md](PRIVACY_POLICY.md)

Host it on a public URL (GitHub Pages is fine) and paste that URL into the Web Store listing.

## 5) Screenshots You Should Upload

Take at least 3 screenshots:

1. Popup with server URL, username, room, and invite code.
2. In-page WatchParty overlay showing chat and logs.
3. Two clients synced at same timestamp.

## 6) Final Checklist Before Submit

1. Confirm [manifest.json](manifest.json) version is correct.
2. Confirm [watchparty-chrome-store.zip](watchparty-chrome-store.zip) includes extension files only.
3. Confirm relay URL uses `wss://` in production.
4. Confirm privacy policy URL is public and accessible.
5. Submit for review.

## 7) Updating Later

For updates:

1. Bump `version` in [manifest.json](manifest.json).
2. Rebuild [watchparty-chrome-store.zip](watchparty-chrome-store.zip).
3. Upload new package in Developer Dashboard.
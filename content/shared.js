function normalizePageKey(url) {
  try {
    const parsed = new URL(url);
    return sanitizePathKey(parsed.pathname);
  } catch {
    return sanitizePathKey(location.pathname);
  }
}

function sanitizePathKey(pathname) {
  const clean = String(pathname || "").trim();
  if (!clean) {
    return "/";
  }

  // Crunchyroll watch URLs are /[locale/]watch/{EPISODE_ID}/{slug}. The locale
  // prefix and slug both vary per user, so collapse to the episode ID alone.
  const watchMatch = clean.match(/\/watch\/([A-Za-z0-9]+)/i);
  if (watchMatch) {
    return `/watch/${watchMatch[1].toLowerCase()}`;
  }

  const noTrailing = clean.endsWith("/") && clean.length > 1 ? clean.slice(0, -1) : clean;
  return noTrailing.toLowerCase();
}

const RELAY_SERVER = "wss://watchparty-relay.onrender.com";
const HAVE_FUTURE_DATA = 3;
const REMOTE_SEEK_DEBOUNCE_MS = 50;
const STALL_RECOVERY_OFFSET = 0.08;
const PAUSE_CONFIRM_DELAY_MS = 60;
const SEEK_PAUSE_GUARD_MS = 300;
const FORCE_PLAY_INITIAL_MS = 50;
const FORCE_PLAY_RETRY_MS = 150;

const state = {
  ws: null,
  room: null,
  username: null,
  clientId: `cid-${Math.random().toString(36).slice(2, 10)}`,
  serverUrl: null,
  pageKey: normalizePageKey(location.href),
  connected: false,
  activeTab: "chat",
  userCount: 0,
  playbackIntentPlaying: false,
  suppressPlayerEvents: false,
  lastSeekBroadcastAt: 0,
  pendingSeekTimer: null,
  pendingPauseTimer: null,
  stallNudgeTimer: null,
  forcePlayTimer: null,
  pendingRemoteSeekTimer: null,
  pendingRemoteSeekControl: null,
  pendingAutoResume: false,
  pendingTargetTime: null,
  unlockNoticeShown: false,
  reconnectTimer: null,
  reconnectAttempts: 0,
  wsAbort: null,
  disconnectLogged: false,
  player: null,
  playerPoller: null,
  pendingSyncSnapshot: null,
  awaitingInitialSync: false,
  lastSeekObservedAt: 0
};

let ui = null;

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
const PROTOCOL_VERSION = 2;

const state = {
  ws: null,
  room: null,
  username: null,
  clientId: null,
  serverUrl: null,
  pageKey: normalizePageKey(location.href),
  connected: false,
  activeTab: "chat",
  userCount: 0,
  playbackIntentPlaying: false,
  pendingSeekTimer: null,

  pendingAutoResume: false,
  reconnectTimer: null,
  reconnectAttempts: 0,
  wsAbort: null,
  handshakeTimer: null,
  clockTimer: null,
  ping: null,
  pingNonce: 0,
  playerReadySent: false,
  awaitingPageMedia: false,
  restoringPlayer: false,
  initialSyncPending: false,
  player: null,
  playerAbort: null,
  playerPoller: null,
  remoteSeek: null,
  seekCost: 0,
  localSeeking: false,
  expectedPlay: false,
  expectedPause: false,
  playGeneration: 0,
  playAttempt: false,
  baseRate: 1,
  appliedRate: 1,
  timeline: null,
  lastRevision: 0,
  controllerId: null,
  commandId: 0,
  pendingCommandId: 0,
  clockOffset: null,
  roundTrip: 0,
  bestRoundTrip: Infinity,
  lastReportAt: -Infinity
};

let ui = null;

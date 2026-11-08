const http = require("node:http");
const { randomUUID } = require("node:crypto");
const { performance } = require("node:perf_hooks");
const { WebSocketServer, WebSocket } = require("ws");

const PROTOCOL_VERSION = 2;
const rooms = new Map();
const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ ok: true, protocol: PROTOCOL_VERSION, rooms: rooms.size }));
    return;
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("WatchParty relay. Connect using WebSocket protocol 2.");
});
const wss = new WebSocketServer({ server, maxPayload: 16384 });

function send(socket, data) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data));
}

function error(socket, code, message) {
  send(socket, { type: "error", code, message });
}

function broadcast(room, data, pageKey = null, except = null) {
  for (const socket of room.members) {
    if (socket !== except && (pageKey === null || socket.meta.pageKey === pageKey)) send(socket, data);
  }
}

function memberCount(room) {
  broadcast(room, { type: "system", event: "member-count", count: room.members.size });
}

function validPage(value) {
  return typeof value === "string" && /^\/watch\/[a-z0-9]+$/.test(value);
}

function validSnapshot(data) {
  return data && Number.isFinite(data.time) && data.time >= 0 && data.time <= 604800 &&
    typeof data.paused === "boolean" && typeof data.buffering === "boolean" &&
    Number.isFinite(data.rate) && data.rate >= 0.25 && data.rate <= 4;
}

function uniqueName(room, value) {
  const base = typeof value === "string" && value.trim() ? value.trim().slice(0, 40) : "anonymous";
  const names = new Set([...room.members].map((s) => s.meta.username));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) {
    const suffix = `_${i}`;
    const name = base.slice(0, 40 - suffix.length) + suffix;
    if (!names.has(name)) return name;
  }
}

function episode(room, pageKey) {
  if (!room.episodes.has(pageKey)) room.episodes.set(pageKey, { controllerId: null, snapshot: null });
  return room.episodes.get(pageKey);
}

function timeline(room, pageKey, cause) {
  const entry = room.episodes.get(pageKey);
  if (!entry?.snapshot) return null;
  const snapshot = entry.snapshot;
  const age = Math.max(0, performance.now() - snapshot.sampleAt);
  const advance = !snapshot.paused && !snapshot.buffering ? Math.min(age, 5000) / 1000 * snapshot.rate : 0;
  return {
    type: "timeline", pageKey, revision: snapshot.revision, controllerId: entry.controllerId,
    senderId: snapshot.senderId, username: snapshot.username, commandId: snapshot.commandId,
    time: snapshot.time + advance, paused: snapshot.paused,
    buffering: snapshot.buffering || age > 5000, rate: snapshot.rate,
    serverTime: Date.now(), cause
  };
}

function acceptSnapshot(socket, data, cause) {
  const { room, pageKey, id, username } = socket.meta;
  const entry = episode(room, pageKey);
  entry.snapshot = {
    time: data.time, paused: data.paused, buffering: data.buffering, rate: data.rate,
    revision: ++room.revision, sampleAt: performance.now(),
    senderId: id, username, commandId: data.commandId || 0
  };
  broadcast(room, timeline(room, pageKey, cause), pageKey);
}

function chooseController(room, pageKey) {
  if (!validPage(pageKey)) return;
  const entry = room.episodes.get(pageKey);
  if (!entry) return;
  const members = [...room.members].filter((s) => s.meta.pageKey === pageKey);
  if (!members.length) {
    room.episodes.delete(pageKey);
    return;
  }
  if (members.some((s) => s.meta.id === entry.controllerId && s.meta.ready)) return;
  entry.controllerId = members.find((s) => s.meta.ready)?.meta.id || null;
  if (entry.snapshot) entry.snapshot.revision = ++room.revision;
  broadcast(room, { type: "role", pageKey, controllerId: entry.controllerId }, pageKey);
  const data = timeline(room, pageKey, "handover");
  if (data) broadcast(room, data, pageKey);
}

function markReady(socket, snapshot) {
  const { room, pageKey, id } = socket.meta;
  if (!validPage(pageKey) || !validSnapshot(snapshot)) return;
  socket.meta.ready = true;
  const entry = episode(room, pageKey);
  chooseController(room, pageKey);
  if (!entry.snapshot && entry.controllerId === id) acceptSnapshot(socket, snapshot, "initial");
  else {
    const data = timeline(room, pageKey, "join");
    if (data) send(socket, data);
  }
}

function cleanup(socket) {
  const meta = socket.meta;
  if (!meta.room) return;
  const room = meta.room;
  if (!room.members.delete(socket)) return;
  chooseController(room, meta.pageKey);
  broadcast(room, { type: "leave", username: meta.username, senderId: meta.id });
  memberCount(room);
  if (!room.members.size) rooms.delete(meta.roomName);
  meta.room = null;
}

wss.on("connection", (socket) => {
  socket.isAlive = true;
  socket.meta = { id: randomUUID(), room: null, roomName: null, pageKey: null, ready: false, lastCommandId: 0 };
  const joinTimer = setTimeout(() => socket.close(1008, "Join required"), 10000);
  socket.on("pong", () => { socket.isAlive = true; });
  socket.on("message", (raw, binary) => {
    if (binary) return;
    let data;
    try { data = JSON.parse(raw.toString()); } catch { return; }
    if (!data || typeof data !== "object" || Array.isArray(data)) return;
    const meta = socket.meta;

    if (data.type === "join") {
      if (meta.room) return;
      if (data.protocol !== PROTOCOL_VERSION) {
        error(socket, "PROTOCOL_MISMATCH", "Update the WatchParty extension and relay to protocol 2.");
        socket.close(1008, "Protocol mismatch");
        return;
      }
      if (typeof data.room !== "string" || !data.room.trim() || data.room.trim().length > 80) {
        error(socket, "INVALID_ROOM", "Room must be between 1 and 80 characters.");
        return;
      }
      clearTimeout(joinTimer);
      const name = data.room.trim();
      if (!rooms.has(name)) rooms.set(name, { members: new Set(), episodes: new Map(), revision: 0 });
      const room = rooms.get(name);
      meta.username = uniqueName(room, data.username);
      meta.room = room;
      meta.roomName = name;
      meta.pageKey = validPage(data.pageKey) ? data.pageKey : null;
      room.members.add(socket);
      if (meta.pageKey) episode(room, meta.pageKey);
      send(socket, { type: "welcome", protocol: PROTOCOL_VERSION, clientId: meta.id, username: meta.username, room: name });
      broadcast(room, { type: "join", username: meta.username, senderId: meta.id }, null, socket);
      memberCount(room);
      markReady(socket, data.snapshot);
      const initial = timeline(room, meta.pageKey, "join");
      if (initial) send(socket, initial);
      return;
    }

    if (!meta.room) return;
    const room = meta.room;
    if (data.type === "ping") {
      if (Number.isFinite(data.nonce)) send(socket, { type: "pong", nonce: data.nonce, serverTime: Date.now() });
      return;
    }
    if (data.type === "leave") {
      cleanup(socket);
      socket.close(1000, "Left room");
      return;
    }
    if (data.type === "chat") {
      if (typeof data.text === "string" && data.text.trim() && data.text.length <= 1000) {
        broadcast(room, { type: "chat", text: data.text, username: meta.username, senderId: meta.id, timestamp: Date.now() }, null, socket);
      }
      return;
    }
    if (data.type === "page") {
      const oldPage = meta.pageKey;
      meta.pageKey = validPage(data.pageKey) ? data.pageKey : null;
      meta.ready = false;
      chooseController(room, oldPage);
      if (meta.pageKey) episode(room, meta.pageKey);
      send(socket, { type: "page-ready", pageKey: meta.pageKey });
      return;
    }
    if (!validPage(meta.pageKey) || data.pageKey !== meta.pageKey) return;
    if (data.type === "ready") {
      markReady(socket, data.snapshot);
      return;
    }
    if (data.type !== "control" && data.type !== "report") return;
    if (!validSnapshot(data)) {
      error(socket, "INVALID_SNAPSHOT", "Playback position, state, or rate is invalid.");
      return;
    }
    const entry = episode(room, meta.pageKey);
    if (data.type === "control") {
      if (!["play", "pause", "seek", "rate"].includes(data.action) || !Number.isSafeInteger(data.commandId) || data.commandId <= meta.lastCommandId) return;
      meta.lastCommandId = data.commandId;
      meta.ready = true;
      entry.controllerId = meta.id;
      acceptSnapshot(socket, data, data.action);
    } else if (entry.controllerId === meta.id) {
      acceptSnapshot(socket, data, "report");
    }
  });
  socket.on("close", () => { clearTimeout(joinTimer); cleanup(socket); });
  socket.on("error", () => { cleanup(socket); });
});

const pingInterval = setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.isAlive) socket.terminate();
    else { socket.isAlive = false; socket.ping(); }
  }
}, 15000);
wss.on("close", () => clearInterval(pingInterval));
server.listen(Number(process.env.PORT || 8787), () => {
  console.log(`WatchParty protocol ${PROTOCOL_VERSION} relay listening on port ${server.address().port}`);
});
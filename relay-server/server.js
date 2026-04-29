const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT || 8787);
const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }

  res.writeHead(200, { "content-type": "text/plain" });
  res.end("WatchParty relay is running. Use WebSocket endpoint at this host.");
});

const wss = new WebSocketServer({ server });

const rooms = new Map();

function ensureRoom(name) {
  if (!rooms.has(name)) {
    rooms.set(name, {
      members: new Set(),
      usernames: new Set()
    });
  }
  return rooms.get(name);
}

function normalizeUsername(value) {
  if (typeof value !== "string") {
    return "anonymous";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "anonymous";
  }

  return trimmed.slice(0, 40);
}

function randomSuffix() {
  return Math.floor(100 + Math.random() * 900);
}

function getUniqueUsername(roomEntry, requestedUsername) {
  const base = normalizeUsername(requestedUsername);
  if (!roomEntry.usernames.has(base)) {
    return base;
  }

  for (let i = 0; i < 50; i += 1) {
    const candidate = `${base}_${randomSuffix()}`;
    if (!roomEntry.usernames.has(candidate)) {
      return candidate;
    }
  }

  let suffix = 2;
  while (roomEntry.usernames.has(`${base}_${suffix}`)) {
    suffix += 1;
  }
  return `${base}_${suffix}`;
}

function sendError(socket, code, message) {
  if (socket.readyState !== 1) {
    return;
  }

  socket.send(
    JSON.stringify({
      type: "error",
      code,
      message,
      timestamp: Date.now()
    })
  );
}

function broadcast(room, payload, exceptSocket) {
  const roomEntry = rooms.get(room);
  if (!roomEntry) {
    return;
  }

  const message = JSON.stringify(payload);
  for (const client of roomEntry.members) {
    if (client !== exceptSocket && client.readyState === 1) {
      client.send(message);
    }
  }
}

function broadcastMemberCount(room) {
  const roomEntry = rooms.get(room);
  if (!roomEntry) {
    return;
  }

  broadcast(room, {
    type: "system",
    event: "member-count",
    room,
    count: roomEntry.members.size,
    timestamp: Date.now()
  });
}

function cleanupSocket(socket) {
  const { room, username } = socket.meta || {};
  if (!room) {
    return;
  }

  const roomEntry = rooms.get(room);
  if (!roomEntry) {
    return;
  }

  if (!roomEntry.members.has(socket)) {
    return;
  }

  roomEntry.members.delete(socket);
  if (username) {
    roomEntry.usernames.delete(username);
  }

  broadcastMemberCount(room);

  broadcast(room, {
    type: "leave",
    room,
    username: username || "unknown",
    timestamp: Date.now()
  });

  if (roomEntry.members.size === 0) {
    rooms.delete(room);
  }
}

const BROADCAST_TYPES = new Set(["chat", "control", "sync-request", "sync-state", "join", "leave"]);

wss.on("connection", (socket) => {
  socket.isAlive = true;
  socket.on("pong", () => {
    socket.isAlive = true;
  });

  socket.meta = {
    room: null,
    username: null
  };

  socket.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    if (!data || !data.type || !data.room) {
      return;
    }

    const room = String(data.room).trim();
    if (!room) {
      return;
    }

    if (room.length > 80) {
      return;
    }

    if (typeof data.username === "string" && data.username.length > 40) {
      return;
    }

    if (data.type === "chat" && typeof data.text === "string" && data.text.length > 1000) {
      return;
    }

    if (!socket.meta.room) {
      if (data.type !== "join") {
        return;
      }

      const roomEntry = ensureRoom(room);

      const requestedUsername = normalizeUsername(data.username);
      const assignedUsername = getUniqueUsername(roomEntry, requestedUsername);

      roomEntry.members.add(socket);
      roomEntry.usernames.add(assignedUsername);
      socket.meta.room = room;
      socket.meta.username = assignedUsername;

      broadcastMemberCount(room);

      if (assignedUsername !== requestedUsername && socket.readyState === 1) {
        socket.send(
          JSON.stringify({
            type: "system",
            event: "username-updated",
            username: assignedUsername,
            requestedUsername,
            timestamp: Date.now()
          })
        );
      }
    }

    if (socket.meta.room !== room) {
      return;
    }

    if (data.type === "leave") {
      cleanupSocket(socket);
      return;
    }

    if (!BROADCAST_TYPES.has(data.type)) {
      return;
    }

    const outbound = {
      ...data,
      username: socket.meta.username
    };

    broadcast(room, outbound, socket);
  });

  socket.on("close", () => {
    cleanupSocket(socket);
  });

  socket.on("error", () => {
    cleanupSocket(socket);
  });
});

const pingInterval = setInterval(() => {
  for (const socket of wss.clients) {
    if (socket.isAlive === false) {
      socket.terminate();
      continue;
    }

    socket.isAlive = false;
    socket.ping();
  }
}, 30000);

wss.on("close", () => {
  clearInterval(pingInterval);
});

server.listen(PORT, () => {
  console.log(`WatchParty relay listening on ws://localhost:${PORT}`);
});

const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const { createRequire } = require("node:module");
const { once } = require("node:events");
const relayRequire = createRequire(path.resolve(__dirname, "../../relay-server/package.json"));
const { WebSocket } = relayRequire("ws");

async function startRelay() {
  const reservation = net.createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const process = spawn(global.process.execPath, [path.resolve(__dirname, "../../relay-server/server.js")], {
    env: { ...global.process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  process.stdout.on("data", (data) => { output += data; });
  process.stderr.on("data", (data) => { output += data; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Relay startup timeout: ${output}`)), 5000);
    process.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Relay exited ${code}: ${output}`)); });
    process.stdout.once("data", () => { clearTimeout(timer); resolve(); });
  });
  const clients = [];
  return {
    url: `ws://127.0.0.1:${port}`, health: `http://127.0.0.1:${port}/health`,
    async client(name = "Alice", room = "test", pageKey = "/watch/ep1") {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      clients.push(ws);
      const messages = [];
      const waiters = [];
      ws.on("message", (raw) => {
        const message = JSON.parse(raw);
        const index = waiters.findIndex((w) => w.predicate(message));
        if (index >= 0) {
          const [waiter] = waiters.splice(index, 1);
          clearTimeout(waiter.timer);
          waiter.resolve(message);
        } else messages.push(message);
      });
      await once(ws, "open");
      const client = {
        ws, messages,
        send(data) { ws.send(JSON.stringify({ room, pageKey, ...data })); },
        next(predicate, timeout = 1500) {
          const index = messages.findIndex(predicate);
          if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
          return new Promise((resolve, reject) => {
            const waiter = { predicate, resolve, timer: null };
            waiter.timer = setTimeout(() => {
              waiters.splice(waiters.indexOf(waiter), 1);
              reject(new Error(`Message timeout; received ${JSON.stringify(messages)}`));
            }, timeout);
            waiters.push(waiter);
          });
        }
      };
      client.send({ type: "join", protocol: 2, username: name });
      return client;
    },
    async stop() {
      for (const ws of clients) ws.terminate();
      process.kill();
      if (process.exitCode === null) await once(process, "exit");
    }
  };
}
module.exports = { startRelay };

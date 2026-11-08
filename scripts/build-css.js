const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const cliPackage = require.resolve("@tailwindcss/cli/package.json");
const cli = path.join(path.dirname(cliPackage), "dist/index.mjs");

// Tailwind's class prefix does not namespace its internal @property names.
// Keep our registrations/fallbacks from changing a host site's own Tailwind UI.
function namespaceCss(css) {
  return css.replaceAll("--tw-", "--wp-tw-");
}

function buildCss(target, watch = false) {
  if (!["popup", "content", "host"].includes(target)) throw new Error("Unknown CSS target");
  const directory = path.join(root, "build/css");
  const raw = path.join(directory, `${target}.css`);
  fs.mkdirSync(directory, { recursive: true });
  const args = [cli, "-i", `styles/${target}.css`, "-o", raw, "--minify"];
  const publish = () => {
    if (fs.existsSync(raw)) fs.writeFileSync(path.join(root, `${target}.css`), namespaceCss(fs.readFileSync(raw, "utf8")));
  };
  if (!watch) {
    const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Tailwind ${target} build failed (${result.status})`);
    publish();
    return;
  }
  let timer;
  const watcher = fs.watch(directory, (_event, filename) => {
    if (String(filename) !== `${target}.css`) return;
    clearTimeout(timer);
    timer = setTimeout(publish, 30);
  });
  const child = spawn(process.execPath, [...args, "--watch=always"], { cwd: root, stdio: "inherit" });
  const close = () => { clearTimeout(timer); watcher.close(); child.kill(); };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  child.once("error", (error) => { close(); console.error(error); process.exitCode = 1; });
  child.once("exit", (code) => { clearTimeout(timer); watcher.close(); process.exitCode = code || 0; });
}

if (require.main === module) {
  const target = process.argv[2];
  for (const name of target ? [target] : ["popup", "content", "host"]) buildCss(name, process.argv.includes("--watch"));
}
module.exports = { namespaceCss, buildCss };

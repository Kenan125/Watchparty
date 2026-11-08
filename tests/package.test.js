const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");

test("the installable extension contains runtime assets only, not development files or dependencies", () => {
  const result = spawnSync(process.execPath, ["scripts/package-extension.js"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const directory = path.join(root, "build/extension");
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
  for (const script of manifest.content_scripts.flatMap((item) => [...item.js, ...(item.css || [])])) {
    assert.ok(fs.existsSync(path.join(directory, script)), script);
  }
  for (const asset of ["background.js", "panel.html", "panel.js", "content.css", "host.css", "icons/icon128.png"]) assert.ok(fs.existsSync(path.join(directory, asset)), asset);
  const walk = (folder) => fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    assert.ok(!entry.name.startsWith("_"), `Chrome-reserved name: ${entry.name}`);
    assert.ok(!["node_modules", "styles", ".hermes", ".agents", "tests", ".git"].includes(entry.name));
    return entry.isDirectory() ? walk(path.join(folder, entry.name)) : [entry.name];
  });
  assert.equal(walk(directory).filter((name) => name.endsWith(".md")).length, 0);
});

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
let count = 0;
function check(directory) {
  for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") check(relative);
    else if (entry.isFile() && entry.name.endsWith(".js")) {
      new vm.Script(fs.readFileSync(path.join(root, relative), "utf8"), { filename: relative });
      count++;
    }
  }
}
for (const directory of ["content", "relay-server", "tests", "scripts"]) check(directory);
for (const file of ["popup.js", "panel.js", "background.js", "playwright.config.js"]) {
  new vm.Script(fs.readFileSync(path.join(root, file), "utf8"), { filename: file });
  count++;
}
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ["storage", "tabs", "sidePanel"]);
assert.equal(manifest.side_panel.default_path, "panel.html");
assert.equal(manifest.action.default_popup, undefined);
assert.deepEqual(manifest.content_scripts.flatMap((item) => item.css || []), [], "UI CSS must stay in the isolated panel document");
for (const asset of manifest.web_accessible_resources.flatMap((item) => item.resources)) assert.ok(fs.existsSync(path.join(root, asset)), asset);
for (const script of manifest.content_scripts.flatMap((item) => item.js)) assert.ok(fs.existsSync(path.join(root, script)), script);
const relay = (file) => fs.readFileSync(path.join(root, file), "utf8").match(/const RELAY_SERVER = "([^"]+)"/)[1];
assert.equal(relay("popup.js"), relay("content/shared.js"));
assert.equal(manifest.version, JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version);
console.log(`Syntax checked ${count} JavaScript files; manifest assets, permissions, version, and relay URLs verified.`);

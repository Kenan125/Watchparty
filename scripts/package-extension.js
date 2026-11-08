const fs = require("node:fs");
const path = require("node:path");

function packageExtension() {
  const root = path.resolve(__dirname, "..");
  const output = path.join(root, "build/extension");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const assets = new Set(["manifest.json", manifest.action.default_popup, "popup.css", "popup.js",
    ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon),
    ...manifest.content_scripts.flatMap((item) => [...item.js, ...(item.css || [])])]);
  // Whitelist assets: repository notes/caches can contain Chrome-reserved names.
  fs.rmSync(output, { recursive: true, force: true });
  for (const asset of assets) {
    const destination = path.join(output, asset);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, asset), destination);
  }
  return output;
}

if (require.main === module) console.log(`Load unpacked extension from: ${packageExtension()}`);
module.exports = { packageExtension };

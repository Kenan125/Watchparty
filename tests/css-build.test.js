const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { namespaceCss } = require("../scripts/build-css");

test("Tailwind's internal registrations and references are namespaced together", () => {
  const css = '@property --tw-leading{syntax:"*";inherits:false}.wp-example{--tw-leading:1.5;line-height:var(--tw-leading);color:var(--wp-color-paper)}';
  const isolated = namespaceCss(css);
  assert.ok(!isolated.includes("--tw-"));
  assert.ok(isolated.includes("@property --wp-tw-leading"));
  assert.ok(isolated.includes("var(--wp-tw-leading)"));
  assert.ok(isolated.includes("var(--wp-color-paper)"));
  assert.equal(namespaceCss(isolated), isolated);
});

test("shipped content CSS cannot register native Tailwind variables or target player controls", () => {
  const css = fs.readFileSync(path.resolve(__dirname, "../content.css"), "utf8");
  assert.ok(!css.includes("--tw-"));
  for (const selector of [".bitmovinplayer-container", "player-controls-root", "wp-reserve-chat", "wp-player-positioned"]) {
    assert.ok(!css.includes(selector), selector);
  }
});

test("the UI stylesheet belongs to the native Side Panel, never the streaming content script", () => {
  const root = path.resolve(__dirname, "..");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.content_scripts.flatMap((entry) => entry.css || []), []);
  assert.ok(fs.readFileSync(path.join(root, "panel.html"), "utf8").includes('href="content.css"'));
  assert.equal(manifest.side_panel.default_path, "panel.html");
  assert.ok(!manifest.web_accessible_resources.some((entry) => entry.resources.includes("panel.html")));
});

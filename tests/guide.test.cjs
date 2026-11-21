const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { buildGuideHtml, validateGuideTools, guideToolsFromPayload } = require("../scripts/build-guide.cjs");

const root = path.resolve(__dirname, "..");
const payload = JSON.parse(fs.readFileSync(path.join(root, "data", "tools.json"), "utf8"));
const tools = guideToolsFromPayload(payload);

test("guide HTML uses dynamic counts instead of hardcoded copy", () => {
  const html = buildGuideHtml(tools, "data:image/svg+xml;base64,fixture", { generatedAt: new Date("2026-11-20T12:00:00Z") });
  assert.ok(html.includes("48 free tools for video, text, and images"));
  assert.ok(html.includes("<span>48 tools</span>"));
  assert.ok(html.includes("<span>3 crafts</span>"));
  assert.ok(html.includes("Curated Nov 2026"));
  assert.ok(html.includes("original 48-tool starter snapshot"));
  assert.equal((html.match(/<li class="tool">/g) || []).length, 48);
});

test("guide validation enforces the 16/15/17 split", () => {
  assert.deepEqual(validateGuideTools(tools), { video: 16, text: 15, images: 17 });
  const broken = tools.map((tool) => (tool.category === "images" ? { ...tool, category: "video" } : tool));
  assert.throws(() => validateGuideTools(broken), /16\/15\/17/);
});

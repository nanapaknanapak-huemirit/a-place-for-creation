const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { renderSite, validateTools } = require("../scripts/render-site.cjs");

const root = path.resolve(__dirname, "..");
const payload = JSON.parse(fs.readFileSync(path.join(root, "data", "tools.json"), "utf8"));
const template = fs.readFileSync(path.join(root, "src", "index.template.html"), "utf8");
const config = JSON.parse(fs.readFileSync(path.join(root, "data", "config.json"), "utf8"));
const now = new Date("2026-11-20T12:00:00Z");

test("renderSite renders every tool and replaces all tokens", () => {
  const result = renderSite({ payload, template, config, now });
  const cards = (result.html.match(/<article class="card"/g) || []).length;
  assert.equal(cards, payload.tools.length);
  assert.equal(result.stats.counts.video, 16);
  assert.equal(result.stats.counts.text, 15);
  assert.equal(result.stats.counts.images, 17);
  assert.equal(result.stats.guide, 48);
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(result.html));
  assert.ok(result.html.includes(`Showing all ${payload.tools.length} tools`));
});

test("new auto tools get a badge and appear first in their category", () => {
  const auto = {
    id: "fixture-auto",
    name: "Fixture Auto",
    url: "https://fixture-auto.example/",
    category: "video",
    summary: "A fixture tool for render tests.",
    tags: ["Video"],
    tier: "Free tier",
    tierClass: "tier",
    access: "Browser",
    keywords: ["fixture"],
    monogram: "FA",
    source: "awesome-tools",
    sourceUrl: "https://example.test/readme",
    sourceSection: "Video editing",
    addedAt: "2026-11-20",
    lastChecked: "2026-11-20",
    status: "active",
    auto: true,
    guide: false,
    order: 999,
  };
  const withAuto = { ...payload, tools: [...payload.tools, auto] };
  const result = renderSite({ payload: withAuto, template, config, now });
  assert.equal(result.stats.newBadges, 1);
  assert.ok(result.html.includes('data-tool-id="fixture-auto"'));
  assert.ok(result.html.includes('data-new="true"'));
  assert.ok(result.html.includes("Found via <span>Awesome Tools</span>"));

  const autoIndex = result.html.indexOf('data-tool-id="fixture-auto"');
  const firstCuratedVideo = withAuto.tools.find((tool) => tool.category === "video" && tool.source === "curated");
  const curatedIndex = result.html.indexOf(`data-tool-id="${firstCuratedVideo.id}"`);
  assert.ok(autoIndex > -1 && autoIndex < curatedIndex);
});

test("renderSite rejects a template with missing tokens", () => {
  assert.throws(
    () => renderSite({ payload, template: template.replace("{{UPDATED_ISO}}", ""), config, now }),
    /Template is missing/,
  );
});

test("validateTools enforces the 48-tool guide snapshot", () => {
  assert.equal(validateTools(payload).length, 48);
  const broken = { ...payload, tools: payload.tools.map((tool, index) => (index === 0 ? { ...tool, guide: false } : tool)) };
  assert.throws(() => validateTools(broken), /48 tools/);
});

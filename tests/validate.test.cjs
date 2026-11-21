const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  validateToolsPayload,
  validatePendingPayload,
  validateBlocklistPayload,
  validateRenderedHtml,
  validateGuideHtml,
} = require("../scripts/validate-data.cjs");
const { renderSite } = require("../scripts/render-site.cjs");
const { buildGuideHtml } = require("../scripts/build-guide.cjs");

const root = path.resolve(__dirname, "..");
const payload = JSON.parse(fs.readFileSync(path.join(root, "data", "tools.json"), "utf8"));
const template = fs.readFileSync(path.join(root, "src", "index.template.html"), "utf8");
const config = JSON.parse(fs.readFileSync(path.join(root, "data", "config.json"), "utf8"));
const now = new Date("2026-11-20T12:00:00Z");

test("the real tools payload passes validation", () => {
  const result = validateToolsPayload(payload);
  assert.deepEqual(result.errors, []);
  assert.equal(result.guide, 48);
  const expectedCounts = payload.tools.reduce((counts, tool) => {
    counts[tool.category] += 1;
    return counts;
  }, { video: 0, text: 0, images: 0 });
  assert.deepEqual(result.counts, expectedCounts);
});

test("duplicate ids and URLs are rejected", () => {
  const duplicated = {
    ...payload,
    tools: [...payload.tools, { ...payload.tools[0], name: "Another name" }],
  };
  const result = validateToolsPayload(duplicated);
  assert.ok(result.errors.some((error) => error.includes("duplicate id")));
  assert.ok(result.errors.some((error) => error.includes("duplicate URL")));
});

test("auto tools cannot be part of the guide snapshot", () => {
  const broken = {
    ...payload,
    tools: payload.tools.map((tool, index) => (index === 0 ? { ...tool, auto: true } : tool)),
  };
  const result = validateToolsPayload(broken);
  assert.ok(result.errors.some((error) => error.includes("must not be part of the guide")));
});

test("pending validation catches duplicate pending URLs", () => {
  const item = {
    id: "pending-one",
    name: "Pending One",
    url: "https://pending.example/",
    category: "images",
    reason: "needs review",
  };
  const result = validatePendingPayload({ items: [item, { ...item }] }, payload);
  assert.ok(result.errors.some((error) => error.includes("duplicate pending URL")));
});

test("pending validation warns when an item is already listed", () => {
  const existing = payload.tools[0];
  const result = validatePendingPayload({
    items: [{ id: "existing-copy", name: existing.name, url: existing.url, category: existing.category, reason: "needs review" }],
  }, payload);
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some((warning) => warning.includes("already listed")));
});

test("blocklist validation requires three arrays", () => {
  assert.deepEqual(validateBlocklistPayload({ urls: [], domains: [], names: [] }).errors, []);
  assert.ok(validateBlocklistPayload({ urls: [] }).errors.length > 0);
});

test("rendered HTML validation catches stale counts", () => {
  const rendered = renderSite({ payload, template, config, now }).html;
  assert.deepEqual(validateRenderedHtml(rendered, payload).errors, []);

  const stale = rendered.replace(`Showing all ${payload.tools.length} tools`, "Showing all 1 tools");
  assert.ok(validateRenderedHtml(stale, payload).errors.some((error) => error.includes("filter status count is stale")));
});

test("guide HTML validation matches the 48-tool snapshot", () => {
  const guideTools = payload.tools.filter((tool) => tool.guide).map((tool) => ({
    category: tool.category,
    name: tool.name,
    href: tool.url,
    tags: tool.tags,
  }));
  const html = buildGuideHtml(guideTools, "data:image/svg+xml;base64,fixture", { generatedAt: now });
  assert.deepEqual(validateGuideHtml(html, payload).errors, []);
  assert.ok(html.includes("48 free tools"));
  assert.equal((html.match(/<li class="tool">/g) || []).length, 48);
});

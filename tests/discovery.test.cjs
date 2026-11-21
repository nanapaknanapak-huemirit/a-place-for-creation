const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  parseMarkdownEntries,
  parseHnSource,
  detectFree,
  classifyByKeywords,
  buildCandidate,
  canonicalizeUrl,
  runDiscovery,
} = require("../scripts/lib/discovery.cjs");

const fixture = (name) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
const awesomeFixture = fixture("awesome-tools.md");
const freeFixture = fixture("free-for-dev.md");
const hnFixture = JSON.parse(fixture("hn.json"));

const sourceConfig = {
  id: "awesome-tools",
  label: "Awesome Tools",
  kind: "markdown",
  url: "https://raw.test/awesome.md",
  sections: [
    { heading: "AI image generation", category: "images" },
    { heading: "Video editing", category: "video" },
    { heading: "Notes", category: "text" },
    { heading: "Hidden Gems", category: null, requireKeywords: true },
  ],
};

const freeConfig = {
  id: "free-for-dev",
  label: "free-for.dev",
  kind: "markdown",
  url: "https://raw.test/free.md",
  sections: [
    { heading: "Design and UI", category: "images" },
    { heading: "Generative AI", category: null, requireKeywords: true },
  ],
};

const hnConfig = {
  id: "show-hn",
  label: "Show HN",
  kind: "hn-algolia",
  url: "https://hn.test/api",
  tags: "show_hn",
  lookbackDays: 3,
  minPoints: 5,
};

const sources = [sourceConfig, freeConfig, hnConfig];

const toolsPayload = {
  version: 1,
  updatedAt: "2026-11-19T00:00:00.000Z",
  tools: [
    {
      id: "existing",
      name: "Existing Tool",
      url: "https://existing.example/",
      category: "images",
      summary: "An existing curated tool.",
      tags: ["Images"],
      tier: "Free",
      tierClass: "tier tier-free",
      access: "Browser",
      keywords: ["existing"],
      monogram: "ET",
      source: "curated",
      sourceUrl: null,
      addedAt: "2026-11-19",
      lastChecked: "2026-11-19",
      status: "active",
      auto: false,
      guide: true,
      order: 1,
    },
  ],
};

const emptyState = () => ({ version: 1, sources: {} });
const emptyPending = () => ({ version: 1, updatedAt: "2026-11-19T00:00:00.000Z", items: [] });
const emptyBlocklist = () => ({ version: 1, updatedAt: "2026-11-19T00:00:00.000Z", urls: [], domains: [], names: [] });

const makeFetch = ({ awesome = awesomeFixture, free = freeFixture, hn = hnFixture, fail = false } = {}) => async (url) => {
  if (fail) throw new Error("network down");
  if (url === sourceConfig.url) return new Response(awesome, { status: 200, headers: { "content-type": "text/plain" } });
  if (url === freeConfig.url) return new Response(free, { status: 200, headers: { "content-type": "text/plain" } });
  if (url.startsWith(hnConfig.url)) return new Response(JSON.stringify(hn), { status: 200, headers: { "content-type": "application/json" } });
  throw new Error(`Unexpected URL: ${url}`);
};

const config = { maxNewPerRun: 5, maxPendingPerRun: 25, requestTimeoutMs: 1000 };
const now = new Date("2026-11-20T12:00:00Z");

const updatedAwesome = awesomeFixture.replace(
  "### Video editing",
  [
    "- [NewPhoto](https://newphoto.example/) — Free tier photo editor with background removal. **Free tier.**",
    "- [NewTrial](https://newtrial.example/) — Free trial only for a week. **Free trial.**",
    "- [NewDuplicate](https://newphoto.example/again?utm_campaign=x) — Duplicate domain with tracking.",
    "- [NewBlocked](https://blocked.example/) — Free image design tool.",
    "",
    "### Video editing",
  ].join("\n"),
).replace(
  "### Hidden Gems",
  [
    "- [NewAmbiguous](https://newambiguous.example/) — A tool for things.",
    "",
    "### Hidden Gems",
  ].join("\n"),
);

const updatedFree = freeFixture.replace(
  "## Generative AI",
  [
    "## Generative AI",
    "",
    "  * [NewMysteryAI](https://newmysteryai.example/) - A tool for things.",
  ].join("\n"),
);

test("parseMarkdownEntries keeps selected sections and extracts labels", () => {
  const entries = parseMarkdownEntries(awesomeFixture, sourceConfig);
  assert.equal(entries.length, 9);
  const names = entries.map((entry) => entry.name);
  assert.ok(names.includes("PixelForge"));
  assert.ok(names.includes("ClipMaster"));
  assert.ok(!names.includes("IgnoreMe"));
  const pixel = entries.find((entry) => entry.name === "PixelForge");
  assert.equal(pixel.sectionCategory, "images");
  assert.ok(pixel.labels.some((label) => label.includes("Free tier")));
});

test("parseHnSource applies lookback and point filters", () => {
  const entries = parseHnSource(hnFixture, hnConfig, now);
  const names = entries.map((entry) => entry.name);
  assert.ok(names.includes("OpenFilm"));
  assert.ok(names.includes("Mystery HN"));
  assert.ok(!names.includes("LowPoints"));
});

test("detectFree distinguishes free tiers, open source, trials, and paid tools", () => {
  const source = { id: "awesome-tools", kind: "markdown" };
  assert.equal(detectFree({ name: "Open", description: "Open source editor" }, source).reason, "open-source");
  assert.equal(detectFree({ name: "Tier", description: "Free tier with daily credits" }, source).confidence, 0.95);
  assert.equal(detectFree({ name: "Trial", description: "Free trial only" }, source).reason, "trial-only");
  assert.equal(detectFree({ name: "Paid", description: "Subscription required" }, source).reason, "paid-only");
});

test("classifyByKeywords recognizes clear creative categories and rejects ambiguity", () => {
  assert.equal(classifyByKeywords("free video editor with captions and subtitles").category, "video");
  assert.equal(classifyByKeywords("free image generator with background removal").category, "images");
  assert.equal(classifyByKeywords("free writing and notes app for long drafts").category, "text");
  assert.equal(classifyByKeywords("a tool for things"), null);
});

test("canonicalizeUrl strips tracking, www, hash, and trailing slashes", () => {
  assert.equal(
    canonicalizeUrl("https://www.Example.com/path/?utm_source=x&fbclid=y&keep=1#frag"),
    "https://example.com/path?keep=1",
  );
});

test("buildCandidate marks auto tools outside the guide and assigns an order", () => {
  const entry = parseMarkdownEntries(awesomeFixture, sourceConfig).find((item) => item.name === "PixelForge");
  const candidate = buildCandidate(entry, { now, order: 9, source: sourceConfig });
  assert.equal(candidate.category, "images");
  assert.equal(candidate.auto, true);
  assert.equal(candidate.guide, false);
  assert.equal(candidate.order, 9);
  assert.equal(candidate.source, "awesome-tools");
});

test("first run establishes a baseline without importing anything", async () => {
  const result = await runDiscovery({
    sources,
    toolsPayload,
    state: emptyState(),
    pendingPayload: emptyPending(),
    blocklist: emptyBlocklist(),
    config,
    now,
    fetchImpl: makeFetch(),
  });

  assert.equal(result.report.totals.added, 0);
  assert.equal(result.report.totals.queued, 0);
  assert.ok(result.report.totals.baseline > 0);
  assert.equal(result.state.sources["awesome-tools"].initialized, true);
  assert.equal(result.tools.tools.length, 1);
});

test("second run is idempotent and a later run adds only high-confidence entries", async () => {
  const first = await runDiscovery({
    sources,
    toolsPayload,
    state: emptyState(),
    pendingPayload: emptyPending(),
    blocklist: emptyBlocklist(),
    config,
    now,
    fetchImpl: makeFetch(),
  });

  const second = await runDiscovery({
    sources,
    toolsPayload: first.tools,
    state: first.state,
    pendingPayload: first.pending,
    blocklist: emptyBlocklist(),
    config,
    now,
    fetchImpl: makeFetch(),
  });
  assert.equal(second.report.totals.added, 0);
  assert.equal(second.report.totals.queued, 0);

  const blocklist = emptyBlocklist();
  blocklist.domains.push("blocked.example");
  const third = await runDiscovery({
    sources,
    toolsPayload: second.tools,
    state: second.state,
    pendingPayload: second.pending,
    blocklist,
    config,
    now,
    fetchImpl: makeFetch({ awesome: updatedAwesome, free: updatedFree }),
  });

  assert.equal(third.report.totals.added, 1);
  const added = third.tools.tools.find((tool) => tool.name === "NewPhoto");
  assert.ok(added);
  assert.equal(added.auto, true);
  assert.equal(added.guide, false);
  assert.equal(added.category, "images");
  assert.ok(third.report.rejected.some((item) => item.name === "NewTrial"));
  assert.ok(third.report.queued.some((item) => item.name === "NewAmbiguous"));
  assert.ok(third.report.queued.some((item) => item.name === "NewMysteryAI"));
  assert.ok(third.report.skipped.some((item) => item.name === "NewBlocked" && item.reason === "blocklisted"));
  assert.ok(third.report.skipped.some((item) => item.name === "NewDuplicate" && item.reason === "duplicate-candidate"));

  const fourth = await runDiscovery({
    sources,
    toolsPayload: third.tools,
    state: third.state,
    pendingPayload: third.pending,
    blocklist,
    config,
    now,
    fetchImpl: makeFetch({ awesome: updatedAwesome, free: updatedFree }),
  });
  assert.equal(fourth.report.totals.added, 0);
  assert.equal(fourth.report.totals.queued, 0);
});

test("a run never adds more than maxNewPerRun tools", async () => {
  const extra = Array.from({ length: 7 }, (_, index) => `- [Bulk ${index}](https://bulk${index}.example/) — Free image generator with daily credits. **Free tier.**`).join("\n");
  const awesome = awesomeFixture.replace("### Video editing", `${extra}\n\n### Video editing`);
  const first = await runDiscovery({
    sources,
    toolsPayload,
    state: emptyState(),
    pendingPayload: emptyPending(),
    blocklist: emptyBlocklist(),
    config,
    now,
    fetchImpl: makeFetch(),
  });
  const second = await runDiscovery({
    sources,
    toolsPayload: first.tools,
    state: first.state,
    pendingPayload: first.pending,
    blocklist: emptyBlocklist(),
    config,
    now,
    fetchImpl: makeFetch({ awesome }),
  });
  assert.equal(second.report.totals.added, 5);
});

test("a failed source aborts the run", async () => {
  await assert.rejects(
    runDiscovery({
      sources,
      toolsPayload,
      state: emptyState(),
      pendingPayload: emptyPending(),
      blocklist: emptyBlocklist(),
      config,
      now,
      fetchImpl: makeFetch({ fail: true }),
    }),
    /Source awesome-tools failed/,
  );
});

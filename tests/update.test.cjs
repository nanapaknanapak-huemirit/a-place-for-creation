const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { runUpdate } = require("../scripts/update-site.cjs");

const root = path.resolve(__dirname, "..");
const awesomeFixture = fs.readFileSync(path.join(__dirname, "fixtures", "awesome-tools.md"), "utf8");

const sourceUrl = "https://raw.test/awesome.md";
const sourceConfig = {
  version: 1,
  userAgent: "a-place-for-creation-test/1.0",
  sources: [
    {
      id: "awesome-tools",
      label: "Awesome Tools",
      kind: "markdown",
      url: sourceUrl,
      enabled: true,
      sections: [
        { heading: "AI image generation", category: "images" },
        { heading: "Video editing", category: "video" },
        { heading: "Notes", category: "text" },
        { heading: "Hidden Gems", category: null, requireKeywords: true },
      ],
    },
  ],
};

const makeProject = () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "a-place-for-creation-"));
  fs.cpSync(path.join(root, "assets"), path.join(projectRoot, "assets"), { recursive: true });
  fs.cpSync(path.join(root, "src"), path.join(projectRoot, "src"), { recursive: true });
  fs.cpSync(path.join(root, "data"), path.join(projectRoot, "data"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "data", "sources.json"), `${JSON.stringify(sourceConfig, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(projectRoot, "data", "source-state.json"), `${JSON.stringify({ version: 1, sources: {} }, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(projectRoot, "data", "pending.json"), `${JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), items: [] }, null, 2)}\n`, "utf8");
  fs.mkdirSync(path.join(projectRoot, "reports"), { recursive: true });
  return projectRoot;
};

const makeFetch = (text, fail = false) => async (url) => {
  if (fail) throw new Error("network down");
  if (url === sourceUrl) return new Response(text, { status: 200, headers: { "content-type": "text/plain" } });
  throw new Error(`Unexpected URL: ${url}`);
};

const updatedFixture = awesomeFixture.replace(
  "### Video editing",
  [
    "- [NewPhoto](https://newphoto.example/) — Free tier photo editor with background removal. **Free tier.**",
    "",
    "### Video editing",
  ].join("\n"),
);

test("update-site establishes a baseline, then commits a validated new tool", async () => {
  const projectRoot = makeProject();
  const now = new Date("2026-11-20T12:00:00Z");
  const options = { projectRoot, now, skipGuide: true, skipBrowser: true, skipPreflight: true };

  const first = await runUpdate({ ...options, fetchImpl: makeFetch(awesomeFixture) });
  assert.equal(first.report.totals.added, 0);
  assert.equal(first.committed, false);

  const beforeTools = JSON.parse(fs.readFileSync(path.join(projectRoot, "data", "tools.json"), "utf8"));
  const second = await runUpdate({ ...options, fetchImpl: makeFetch(updatedFixture) });
  assert.equal(second.report.totals.added, 1);
  assert.equal(second.committed, true);

  const afterTools = JSON.parse(fs.readFileSync(path.join(projectRoot, "data", "tools.json"), "utf8"));
  assert.equal(afterTools.tools.length, beforeTools.tools.length + 1);
  assert.ok(afterTools.tools.some((tool) => tool.name === "NewPhoto" && tool.auto === true));

  const index = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
  assert.ok(index.includes("NewPhoto"));
  assert.ok(index.includes('data-new="true"'));
  assert.ok(fs.existsSync(path.join(projectRoot, "reports", "latest.md")));
});

test("a failed source leaves the live site untouched", async () => {
  const projectRoot = makeProject();
  const now = new Date("2026-11-20T12:00:00Z");
  const options = { projectRoot, now, skipGuide: true, skipBrowser: true, skipPreflight: true };

  await runUpdate({ ...options, fetchImpl: makeFetch(awesomeFixture) });
  await runUpdate({ ...options, fetchImpl: makeFetch(updatedFixture) });
  const indexBefore = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");
  const toolsBefore = fs.readFileSync(path.join(projectRoot, "data", "tools.json"), "utf8");

  await assert.rejects(runUpdate({ ...options, fetchImpl: makeFetch(awesomeFixture, true) }), /Source awesome-tools failed/);

  assert.equal(fs.readFileSync(path.join(projectRoot, "index.html"), "utf8"), indexBefore);
  assert.equal(fs.readFileSync(path.join(projectRoot, "data", "tools.json"), "utf8"), toolsBefore);
});

test("a fresh lock blocks overlapping runs", async () => {
  const projectRoot = makeProject();
  const now = new Date();
  fs.writeFileSync(path.join(projectRoot, "data", ".update.lock"), "test", "utf8");
  await assert.rejects(
    runUpdate({
      projectRoot,
      now,
      skipGuide: true,
      skipBrowser: true,
      skipPreflight: true,
      fetchImpl: makeFetch(awesomeFixture),
    }),
    /already running/,
  );
});

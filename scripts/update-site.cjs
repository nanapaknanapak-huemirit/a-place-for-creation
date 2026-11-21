const fs = require("fs");
const path = require("path");
const { readJson, writeJsonAtomic, writeTextAtomic, copyFileAtomic } = require("./lib/util.cjs");
const { runDiscovery } = require("./lib/discovery.cjs");
const { renderSite } = require("./render-site.cjs");
const { buildGuide } = require("./build-guide.cjs");
const { runPreflight, findPlaywright, findChrome } = require("./preflight.cjs");
const {
  validateToolsPayload,
  validatePendingPayload,
  validateBlocklistPayload,
  validateFiles,
} = require("./validate-data.cjs");

const root = path.resolve(__dirname, "..");
const lockPath = path.join(root, "data", ".update.lock");

const acquireLock = (filePath = lockPath, now = Date.now()) => {
  try {
    const handle = fs.openSync(filePath, "wx");
    fs.writeSync(handle, JSON.stringify({ pid: process.pid, startedAt: new Date(now).toISOString() }));
    fs.closeSync(handle);
    return filePath;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const stats = fs.statSync(filePath);
    const age = now - stats.mtimeMs;
    if (age > 3600000) {
      fs.unlinkSync(filePath);
      return acquireLock(filePath, now);
    }
    throw new Error(`Another update is already running (lock: ${filePath})`);
  }
};

const releaseLock = (filePath = lockPath) => {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
};

const bullet = (item) => `- [${item.name}](${item.url}) — ${item.category || "uncategorized"} (${item.source})`;

const buildReport = (report, { status = "success", errors = [] } = {}) => {
  const lines = [
    "# A Place for Creation — update report",
    "",
    `- Status: **${status}**`,
    `- Run: ${report.startedAt}`,
    `- Finished: ${report.finishedAt || new Date().toISOString()}`,
    `- Added: ${report.totals?.added ?? 0}`,
    `- Queued: ${report.totals?.queued ?? 0}`,
    `- Rejected: ${report.totals?.rejected ?? 0}`,
    `- Baseline: ${report.totals?.baseline ?? 0}`,
    "",
    "## Sources",
    "",
    ...report.sources.map((source) => `- ${source.label} (${source.id}): ${source.notModified ? "not modified" : `${source.entries} entries`}${source.baseline ? " · baseline established" : ""}${source.error ? ` · error: ${source.error}` : ""}`),
  ];

  if (report.added.length) {
    lines.push("", "## Added", "", ...report.added.map(bullet));
  }
  if (report.queued.length) {
    lines.push("", "## Queued for review", "", ...report.queued.map((item) => `- [${item.name}](${item.url}) — ${item.reason} (${item.source})`));
  }
  if (report.rejected.length) {
    lines.push("", "## Rejected", "", ...report.rejected.map((item) => `- [${item.name}](${item.url}) — ${item.reason} (${item.source})`));
  }
  if (errors.length) {
    lines.push("", "## Errors", "", ...errors.map((error) => `- ${error}`));
  }
  lines.push("");
  return lines.join("\n");
};

const validateBrowser = async ({ indexPath, payload, playwrightPath, chromePath }) => {
  if (!playwrightPath) throw new Error("Playwright is not available for browser validation");
  const playwright = require(playwrightPath);
  const browser = await playwright.chromium.launch({
    ...(chromePath ? { executablePath: chromePath } : {}),
    headless: true,
  });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));

  try {
    await page.goto(`file://${indexPath}`, { waitUntil: "load" });
    await page.waitForTimeout(150);

    const cards = await page.locator(".card").count();
    if (cards !== payload.tools.length) errors.push(`browser card count ${cards} does not match ${payload.tools.length}`);

    for (const category of ["video", "text", "images"]) {
      const expected = payload.tools.filter((tool) => tool.category === category).length;
      await page.click(`[data-filter="${category}"]`);
      const visible = await page.locator(".card:visible").count();
      if (visible !== expected) errors.push(`browser ${category} filter shows ${visible}, expected ${expected}`);
    }

    await page.click('[data-filter="all"]');
    const first = payload.tools[0];
    const term = first.name.split(/\s+/)[0];
    await page.fill("#tool-search", term);
    const matches = await page.locator(".card:visible").count();
    if (matches < 1) errors.push(`browser search for "${term}" returned no tools`);
    await page.fill("#tool-search", "");

    for (const width of [360, 1440]) {
      for (const colorScheme of ["light", "dark"]) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme });
        await page.waitForTimeout(60);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        if (overflow) errors.push(`horizontal overflow at ${width}px in ${colorScheme} mode`);
      }
    }
  } finally {
    await browser.close();
  }

  return errors;
};

const commitStaging = ({ staging, projectRoot, result, includeGuide }) => {
  copyFileAtomic(path.join(staging, "index.html"), path.join(projectRoot, "index.html"));
  if (includeGuide) {
    copyFileAtomic(path.join(staging, "creative-guide.html"), path.join(projectRoot, "creative-guide.html"));
    copyFileAtomic(path.join(staging, "assets", "creative-field-guide.pdf"), path.join(projectRoot, "assets", "creative-field-guide.pdf"));
    copyFileAtomic(path.join(staging, "assets", "creative-field-guide-preview.png"), path.join(projectRoot, "assets", "creative-field-guide-preview.png"));
  }
  writeJsonAtomic(path.join(projectRoot, "data", "tools.json"), result.tools);
  writeJsonAtomic(path.join(projectRoot, "data", "pending.json"), result.pending);
  writeJsonAtomic(path.join(projectRoot, "data", "source-state.json"), result.state);
};

const runUpdate = async ({
  projectRoot = root,
  now = new Date(),
  fetchImpl = fetch,
  dryRun = false,
  skipGuide = false,
  skipBrowser = false,
  skipPreflight = false,
  sourceFilter = null,
} = {}) => {
  const preflight = skipPreflight
    ? { ok: true, checks: [], playwrightPath: findPlaywright(), chromePath: findChrome() }
    : runPreflight({ requireBrowser: !skipGuide || !skipBrowser });
  if (!preflight.ok) {
    const failed = preflight.checks.filter((check) => !check.ok).map((check) => `${check.name}: ${check.detail}`);
    throw new Error(`Preflight failed: ${failed.join(", ")}`);
  }

  const lock = acquireLock(path.join(projectRoot, "data", ".update.lock"), now.getTime());
  let staging = null;

  try {
    const sourcesConfig = readJson(path.join(projectRoot, "data", "sources.json"));
    const toolsPayload = readJson(path.join(projectRoot, "data", "tools.json"));
    const state = readJson(path.join(projectRoot, "data", "source-state.json"), { version: 1, sources: {} });
    const pendingPayload = readJson(path.join(projectRoot, "data", "pending.json"), { version: 1, updatedAt: now.toISOString(), items: [] });
    const blocklist = readJson(path.join(projectRoot, "data", "blocklist.json"), { version: 1, updatedAt: now.toISOString(), urls: [], domains: [], names: [] });
    const config = readJson(path.join(projectRoot, "data", "config.json"), {});

    const sources = sourceFilter
      ? sourcesConfig.sources.filter((source) => source.id === sourceFilter)
      : sourcesConfig.sources;
    if (sources.length === 0) throw new Error(`No matching source: ${sourceFilter}`);

    const result = await runDiscovery({
      sources,
      toolsPayload,
      state,
      pendingPayload,
      blocklist,
      config,
      now,
      fetchImpl,
      userAgent: sourcesConfig.userAgent,
      dryRun,
    });

    if (dryRun) {
      return { dryRun: true, committed: false, report: result.report };
    }

    const toolsChanged = result.report.totals.added > 0;
    if (!toolsChanged) {
      writeJsonAtomic(path.join(projectRoot, "data", "source-state.json"), result.state);
      writeJsonAtomic(path.join(projectRoot, "data", "pending.json"), result.pending);
      const report = buildReport(result.report, { status: "no changes" });
      writeTextAtomic(path.join(projectRoot, "reports", "latest.md"), report);
      return { dryRun: false, committed: false, report: result.report };
    }

    staging = fs.mkdtempSync(path.join(projectRoot, ".staging-"));
    fs.cpSync(path.join(projectRoot, "assets"), path.join(staging, "assets"), { recursive: true });
    fs.mkdirSync(path.join(staging, "data"), { recursive: true });
    fs.writeFileSync(path.join(staging, "data", "tools.json"), `${JSON.stringify(result.tools, null, 2)}\n`, "utf8");
    fs.writeFileSync(path.join(staging, "data", "pending.json"), `${JSON.stringify(result.pending, null, 2)}\n`, "utf8");

    const template = fs.readFileSync(path.join(projectRoot, "src", "index.template.html"), "utf8");
    const rendered = renderSite({ payload: result.tools, template, config, now });
    fs.writeFileSync(path.join(staging, "index.html"), rendered.html, "utf8");

    if (!skipGuide) {
      await buildGuide({
        projectRoot,
        toolsPayload: result.tools,
        guidePath: path.join(staging, "creative-guide.html"),
        pdfPath: path.join(staging, "assets", "creative-field-guide.pdf"),
        previewPath: path.join(staging, "assets", "creative-field-guide-preview.png"),
        qrPath: path.join(projectRoot, "assets", "github-qr.svg"),
        qrPngPath: path.join(projectRoot, "assets", "github-qr.png"),
        now,
        playwrightPath: preflight.playwrightPath,
        chromePath: preflight.chromePath,
      });
    }

    const errors = [];
    const toolsCheck = validateToolsPayload(result.tools);
    const pendingCheck = validatePendingPayload(result.pending, result.tools);
    const blocklistCheck = validateBlocklistPayload(blocklist);
    errors.push(...toolsCheck.errors, ...pendingCheck.errors, ...blocklistCheck.errors);

    const filesCheck = validateFiles({
      projectRoot: staging,
      payload: result.tools,
      indexHtmlPath: path.join(staging, "index.html"),
      guideHtmlPath: path.join(staging, "creative-guide.html"),
      pdfPath: path.join(staging, "assets", "creative-field-guide.pdf"),
      previewPath: path.join(staging, "assets", "creative-field-guide-preview.png"),
      qrPngPath: path.join(projectRoot, "assets", "github-qr.png"),
      skipGuide,
    });
    errors.push(...filesCheck.errors);

    if (!skipBrowser) {
      const browserErrors = await validateBrowser({
        indexPath: path.join(staging, "index.html"),
        payload: result.tools,
        playwrightPath: preflight.playwrightPath,
        chromePath: preflight.chromePath,
      });
      errors.push(...browserErrors);
    }

    if (errors.length) {
      const message = buildReport(result.report, { status: "failed", errors });
      writeTextAtomic(path.join(projectRoot, "reports", `error-${now.toISOString().replace(/[:.]/g, "-")}.md`), message);
      const failure = new Error(`Validation failed:\n${errors.join("\n")}`);
      failure.reportWritten = true;
      throw failure;
    }

    commitStaging({ staging, projectRoot, result, includeGuide: !skipGuide });
    const report = buildReport(result.report, { status: "success" });
    writeTextAtomic(path.join(projectRoot, "reports", "latest.md"), report);
    return { dryRun: false, committed: true, report: result.report };
  } catch (error) {
    if (!dryRun && !error.reportWritten) {
      const fallback = {
        startedAt: now.toISOString(),
        finishedAt: new Date().toISOString(),
        sources: [],
        added: [],
        queued: [],
        rejected: [],
        skipped: [],
        baseline: [],
        totals: { added: 0, queued: 0, rejected: 0, skipped: 0, baseline: 0 },
      };
      const message = buildReport(fallback, { status: "failed", errors: [error.message] });
      writeTextAtomic(path.join(projectRoot, "reports", `error-${now.toISOString().replace(/[:.]/g, "-")}.md`), message);
    }
    throw error;
  } finally {
    if (staging) {
      try { fs.rmSync(staging, { recursive: true, force: true }); } catch (error) { /* ignore cleanup failure */ }
    }
    releaseLock(path.join(projectRoot, "data", ".update.lock"));
  }
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const sourceIndex = args.indexOf("--source");
  runUpdate({
    dryRun: args.includes("--dry-run"),
    skipGuide: args.includes("--no-guide"),
    skipBrowser: args.includes("--no-browser"),
    sourceFilter: sourceIndex >= 0 ? args[sourceIndex + 1] : null,
  }).then((result) => {
    console.log(JSON.stringify(result.report || result, null, 2));
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  runUpdate,
  acquireLock,
  releaseLock,
  validateBrowser,
  commitStaging,
  buildReport,
};

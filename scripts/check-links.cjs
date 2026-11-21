const path = require("path");
const { readJson, writeJsonAtomic } = require("./lib/util.cjs");

const root = path.resolve(__dirname, "..");
const userAgent = "a-place-for-creation/1.0 (+https://github.com/nanapaknanapak-huemirit)";

const checkUrl = async (url, { fetchImpl = fetch, timeoutMs = 12000 } = {}) => {
  const headers = { "user-agent": userAgent, accept: "text/html,application/xhtml+xml,*/*" };
  const attempt = async (method) => {
    const response = await fetchImpl(url, {
      method,
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.status;
  };

  try {
    let status = await attempt("HEAD");
    if ([403, 405, 501].includes(status)) status = await attempt("GET");
    const ok = status < 400 || [401, 403, 429].includes(status);
    return { ok, status };
  } catch (error) {
    return { ok: false, status: null, error: error.message };
  }
};

const runPool = async (items, worker, concurrency = 5) => {
  const results = new Array(items.length);
  let index = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current], current);
    }
  });
  await Promise.all(runners);
  return results;
};

const main = async () => {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const onlyAuto = args.includes("--only-auto");
  const limitIndex = args.indexOf("--limit");
  const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) : Infinity;

  const toolsPath = path.join(root, "data", "tools.json");
  const config = readJson(path.join(root, "data", "config.json"), {});
  const payload = readJson(toolsPath);
  const threshold = Number(config.linkCheckFailureThreshold || 3);
  const timeoutMs = Number(config.linkCheckTimeoutMs || 12000);
  const today = new Date().toISOString().slice(0, 10);

  let tools = payload.tools.filter((tool) => !onlyAuto || tool.auto).slice(0, limit);
  const results = await runPool(tools, async (tool) => {
    const result = await checkUrl(tool.url, { timeoutMs });
    tool.lastChecked = today;
    if (result.ok) {
      tool.failureCount = 0;
      tool.status = tool.status === "needs_review" ? "active" : tool.status;
      delete tool.lastFailureAt;
    } else {
      tool.failureCount = Number(tool.failureCount || 0) + 1;
      tool.lastFailureAt = new Date().toISOString();
      if (tool.failureCount >= threshold) tool.status = "needs_review";
    }
    return { name: tool.name, url: tool.url, ok: result.ok, status: result.status, error: result.error || null, failureCount: tool.failureCount, toolStatus: tool.status };
  }, 5);

  const checked = results.filter((result) => result.ok).length;
  const failed = results.filter((result) => !result.ok);
  const needsReview = payload.tools.filter((tool) => tool.status === "needs_review").length;

  if (!dryRun) {
    payload.updatedAt = new Date().toISOString();
    writeJsonAtomic(toolsPath, payload);
  }

  console.log(JSON.stringify({
    dryRun,
    checked: results.length,
    ok: checked,
    failed: failed.length,
    needsReview,
    failures: failed,
  }, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

const path = require("path");
const { readJson, writeJsonAtomic } = require("./lib/util.cjs");
const { runDiscovery } = require("./lib/discovery.cjs");

const root = path.resolve(__dirname, "..");

const main = async () => {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const sourceIndex = args.indexOf("--source");
  const sourceFilter = sourceIndex >= 0 ? args[sourceIndex + 1] : null;

  const sourcesConfig = readJson(path.join(root, "data", "sources.json"));
  const toolsPayload = readJson(path.join(root, "data", "tools.json"));
  const state = readJson(path.join(root, "data", "source-state.json"), { version: 1, sources: {} });
  const pendingPayload = readJson(path.join(root, "data", "pending.json"), { version: 1, updatedAt: new Date().toISOString(), items: [] });
  const blocklist = readJson(path.join(root, "data", "blocklist.json"), { version: 1, updatedAt: new Date().toISOString(), urls: [], domains: [], names: [] });
  const config = readJson(path.join(root, "data", "config.json"), {});

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
    now: new Date(),
    userAgent: sourcesConfig.userAgent,
    dryRun,
  });

  if (!dryRun) {
    writeJsonAtomic(path.join(root, "data", "source-state.json"), result.state);
    writeJsonAtomic(path.join(root, "data", "pending.json"), result.pending);
    if (result.report.totals.added > 0) {
      writeJsonAtomic(path.join(root, "data", "tools.json"), result.tools);
    }
  }

  console.log(JSON.stringify(result.report, null, 2));
  if (dryRun) console.error("Dry run: no files were written.");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

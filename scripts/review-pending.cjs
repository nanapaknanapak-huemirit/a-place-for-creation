const path = require("path");
const {
  categories,
  readJson,
  writeJsonAtomic,
  slugify,
  canonicalizeUrl,
  nameKey,
} = require("./lib/util.cjs");

const root = path.resolve(__dirname, "..");

const load = () => ({
  tools: readJson(path.join(root, "data", "tools.json")),
  pending: readJson(path.join(root, "data", "pending.json")),
  blocklist: readJson(path.join(root, "data", "blocklist.json")),
});

const save = ({ tools, pending, blocklist }) => {
  writeJsonAtomic(path.join(root, "data", "tools.json"), tools);
  writeJsonAtomic(path.join(root, "data", "pending.json"), pending);
  writeJsonAtomic(path.join(root, "data", "blocklist.json"), blocklist);
};

const findItem = (pending, needle) => {
  const normalized = String(needle).toLowerCase();
  return pending.items.find((item) => {
    if (item.id.toLowerCase() === normalized) return true;
    try {
      return canonicalizeUrl(item.url) === canonicalizeUrl(needle);
    } catch (error) {
      return item.url.toLowerCase() === normalized;
    }
  });
};

const uniqueId = (base, used) => {
  const root = base || "tool";
  let id = root;
  let suffix = 2;
  while (used.has(id)) {
    id = `${root}-${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
};

const monogramFor = (name) => {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  return String(words[0] || "?").slice(0, 2).replace(/^./, (letter) => letter.toUpperCase());
};

const approve = ({ tools, pending, blocklist }, needle, options) => {
  const item = findItem(pending, needle);
  if (!item) throw new Error(`Pending item not found: ${needle}`);
  const category = options.category || item.category;
  if (!categories.includes(category)) throw new Error(`A valid --category is required for ${item.name}`);

  const usedIds = new Set(tools.tools.map((tool) => tool.id));
  const today = new Date().toISOString().slice(0, 10);
  const nextOrder = tools.tools.reduce((max, tool) => Math.max(max, Number(tool.order || 0)), 0) + 1;
  const tool = {
    id: uniqueId(item.id || slugify(item.name), usedIds),
    name: item.name,
    url: canonicalizeUrl(item.url),
    category,
    summary: item.summary || `${item.name} — added from the review queue.`,
    tags: Array.isArray(item.tags) && item.tags.length ? item.tags : [category === "images" ? "Images" : category === "video" ? "Video" : "Text"],
    tier: "Free tier",
    tierClass: "tier",
    access: "Browser",
    keywords: [],
    monogram: monogramFor(item.name),
    source: item.source || "manual",
    sourceUrl: null,
    sourceSection: item.sourceSection || null,
    addedAt: today,
    lastChecked: today,
    status: "active",
    auto: true,
    guide: false,
    order: nextOrder,
    reviewedAt: new Date().toISOString(),
  };

  tools.tools.push(tool);
  tools.updatedAt = new Date().toISOString();
  pending.items = pending.items.filter((entry) => entry !== item);
  pending.updatedAt = new Date().toISOString();
  save({ tools, pending, blocklist });
  return tool;
};

const reject = ({ tools, pending, blocklist }, needle, options) => {
  const item = findItem(pending, needle);
  if (!item) throw new Error(`Pending item not found: ${needle}`);
  const url = canonicalizeUrl(item.url);
  blocklist.urls = Array.from(new Set([...(blocklist.urls || []), url]));
  blocklist.names = Array.from(new Set([...(blocklist.names || []), nameKey(item.name)]));
  if (options.domain) {
    const domain = new URL(url).hostname.replace(/^www\./, "");
    blocklist.domains = Array.from(new Set([...(blocklist.domains || []), domain]));
  }
  blocklist.updatedAt = new Date().toISOString();
  pending.items = pending.items.filter((entry) => entry !== item);
  pending.updatedAt = new Date().toISOString();
  save({ tools, pending, blocklist });
  return item;
};

const main = () => {
  const args = process.argv.slice(2);
  const command = args[0] || "list";
  const data = load();

  if (command === "list") {
    if (data.pending.items.length === 0) {
      console.log("The review queue is empty.");
      return;
    }
    for (const item of data.pending.items) {
      console.log(`${item.id}\t${item.name}\t${item.url}\t${item.reason}`);
    }
    return;
  }

  if (command === "approve" || command === "reject") {
    const needle = args[1];
    if (!needle) throw new Error(`Usage: node scripts/review-pending.cjs ${command} <id-or-url> [--category video|text|images] [--domain]`);
    const categoryIndex = args.indexOf("--category");
    const options = {
      category: categoryIndex >= 0 ? args[categoryIndex + 1] : null,
      domain: args.includes("--domain"),
    };
    const result = command === "approve"
      ? approve(data, needle, options)
      : reject(data, needle, options);
    console.log(JSON.stringify({ command, result }, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { approve, reject, findItem };

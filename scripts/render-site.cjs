const fs = require("fs");
const path = require("path");
const {
  categories,
  categoryMeta,
  escapeHtml,
  formatDate,
  isoDate,
} = require("./lib/util.cjs");

const root = path.resolve(__dirname, "..");
const defaultTemplatePath = path.join(root, "src", "index.template.html");
const defaultDataPath = path.join(root, "data", "tools.json");
const defaultConfigPath = path.join(root, "data", "config.json");
const defaultOutputPath = path.join(root, "index.html");

const sourceLabels = {
  curated: "the original shelf",
  "awesome-tools": "Awesome Tools",
  "free-for-dev": "free-for.dev",
  "show-hn": "Show HN",
  manual: "manual review",
};

const tierClassFor = (tool) => {
  if (typeof tool.tierClass === "string" && tool.tierClass.startsWith("tier")) {
    return tool.tierClass;
  }
  if (tool.tier === "Open source") return "tier tier-open";
  if (tool.tier === "Free") return "tier tier-free";
  return "tier";
};

const monogramFor = (tool) => {
  if (tool.monogram) return tool.monogram;
  const words = String(tool.name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  return String(words[0] || "?").slice(0, 2).replace(/^./, (letter) => letter.toUpperCase());
};

const normalizeUrl = (value) => {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`Unsupported tool URL: ${value}`);
  }
  return value;
};

const validateTools = (payload) => {
  if (!payload || !Array.isArray(payload.tools)) throw new Error("tools.json must contain a tools array");
  const ids = new Set();
  const urls = new Set();

  for (const tool of payload.tools) {
    for (const field of ["id", "name", "url", "category", "summary"]) {
      if (!tool[field] || typeof tool[field] !== "string") {
        throw new Error(`Tool is missing ${field}: ${JSON.stringify(tool)}`);
      }
    }
    if (!categories.includes(tool.category)) throw new Error(`Unknown category for ${tool.name}: ${tool.category}`);
    if (!Array.isArray(tool.tags)) throw new Error(`Tool tags must be an array: ${tool.name}`);
    normalizeUrl(tool.url);
    if (ids.has(tool.id)) throw new Error(`Duplicate tool id: ${tool.id}`);
    ids.add(tool.id);
    const canonical = tool.url.replace(/\/$/, "").toLowerCase();
    if (urls.has(canonical)) throw new Error(`Duplicate tool URL: ${tool.url}`);
    urls.add(canonical);
  }

  const guideTools = payload.tools.filter((tool) => tool.guide);
  if (guideTools.length !== 48) {
    throw new Error(`Guide snapshot must contain 48 tools, found ${guideTools.length}`);
  }
  return guideTools;
};

const renderCard = (tool, options) => {
  const meta = categoryMeta[tool.category];
  const keywords = (Array.isArray(tool.keywords) ? tool.keywords : []).join(" ");
  const tags = Array.isArray(tool.tags) ? tool.tags : [];
  const sourceLabel = sourceLabels[tool.source] || tool.source || "an external list";
  const showOrigin = tool.source && tool.source !== "curated";
  const newBadge = options.isNew
    ? '\n            <span class="new-badge">New</span>'
    : "";
  const origin = showOrigin
    ? `\n          <p class="card-origin">Found via <span>${escapeHtml(sourceLabel)}</span></p>`
    : "";

  return `      <article class="card" data-category="${escapeHtml(tool.category)}" data-keywords="${escapeHtml(keywords)}" data-tool-id="${escapeHtml(tool.id)}" data-source="${escapeHtml(tool.source || "curated")}"${options.isNew ? ' data-new="true"' : ""}>
        <div class="card-media" aria-hidden="true"><span class="monogram">${escapeHtml(monogramFor(tool))}</span><span class="media-cat">${meta.label}</span></div>
        <div class="card-body">
          <div class="card-meta">
            <span class="src ${meta.srcClass}">${meta.label}</span>
            <span class="${escapeHtml(tierClassFor(tool))}">${escapeHtml(tool.tier)}</span>
            <span class="access">${escapeHtml(tool.access)}</span>${newBadge}
          </div>
          <h3><a href="${escapeHtml(tool.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(tool.name)}</a></h3>
          <p class="summary">${escapeHtml(tool.summary)}</p>
          <ul class="tags">${tags.map((tag) => `<li>${escapeHtml(tag)}</li>`).join("")}</ul>${origin}
          <div class="card-actions">
            <a class="source-link" href="${escapeHtml(tool.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeHtml(tool.name)} in a new tab">Visit tool <span aria-hidden="true">↗</span></a>
          </div>
        </div>
      </article>`;
};

const renderSite = ({ payload, template, config, now = new Date() }) => {
  const guideTools = validateTools(payload);
  const newBadgeDays = Number(config.newBadgeDays || 30);

  const isNew = (tool) => {
    if (!tool.auto || !tool.addedAt) return false;
    const added = new Date(tool.addedAt);
    if (Number.isNaN(added.getTime())) return false;
    const ageDays = (now.getTime() - added.getTime()) / 86400000;
    return ageDays >= 0 && ageDays <= newBadgeDays;
  };

  const counts = Object.fromEntries(categories.map((category) => [
    category,
    payload.tools.filter((tool) => tool.category === category).length,
  ]));

  const blocks = Object.fromEntries(categories.map((category) => {
    const tools = payload.tools
      .filter((tool) => tool.category === category)
      .sort((a, b) => {
        const aNew = isNew(a);
        const bNew = isNew(b);
        if (aNew !== bNew) return aNew ? -1 : 1;
        if (aNew && bNew) return new Date(b.addedAt) - new Date(a.addedAt);
        return (a.order || 0) - (b.order || 0);
      });
    return [category, tools.map((tool) => renderCard(tool, { isNew: isNew(tool) })).join("\n\n")];
  }));

  const lastUpdated = formatDate(payload.updatedAt || now.toISOString());
  const replacements = {
    "{{TOOLS_VIDEO}}": blocks.video,
    "{{TOOLS_TEXT}}": blocks.text,
    "{{TOOLS_IMAGES}}": blocks.images,
    "{{COUNT_TOTAL}}": String(payload.tools.length),
    "{{COUNT_VIDEO}}": String(counts.video),
    "{{COUNT_TEXT}}": String(counts.text),
    "{{COUNT_IMAGES}}": String(counts.images),
    "{{GUIDE_COUNT}}": String(guideTools.length),
    "{{LAST_UPDATED}}": lastUpdated,
    "{{UPDATED_ISO}}": isoDate(payload.updatedAt || now.toISOString()),
  };

  let html = template;
  for (const [token, value] of Object.entries(replacements)) {
    if (!html.includes(token)) throw new Error(`Template is missing ${token}`);
    html = html.replaceAll(token, value);
  }

  const leftovers = html.match(/\{\{[A-Z_]+\}\}/g);
  if (leftovers) throw new Error(`Unresolved template tokens: ${[...new Set(leftovers)].join(", ")}`);

  return {
    html,
    stats: {
      total: payload.tools.length,
      counts,
      guide: guideTools.length,
      newBadges: payload.tools.filter(isNew).length,
      lastUpdated,
    },
  };
};

const runRender = ({ root: projectRoot = root, outputPath = defaultOutputPath, now = new Date() } = {}) => {
  const templatePath = path.join(projectRoot, "src", "index.template.html");
  const dataPath = path.join(projectRoot, "data", "tools.json");
  const configPath = path.join(projectRoot, "data", "config.json");
  const payload = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const template = fs.readFileSync(templatePath, "utf8");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const result = renderSite({ payload, template, config, now });

  const temporaryPath = `${outputPath}.tmp-${process.pid}-${Date.now()}`;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(temporaryPath, result.html, "utf8");
  fs.renameSync(temporaryPath, outputPath);

  return { outputPath, ...result.stats };
};

if (require.main === module) {
  console.log(JSON.stringify(runRender(), null, 2));
}

module.exports = {
  renderSite,
  runRender,
  validateTools,
  renderCard,
  defaultTemplatePath,
  defaultDataPath,
  defaultConfigPath,
  defaultOutputPath,
};

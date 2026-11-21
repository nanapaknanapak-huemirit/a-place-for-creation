const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { categories, canonicalizeUrl, nameKey } = require("./lib/util.cjs");
const { validateQr } = require("./lib/qr.cjs");
const { githubProfile } = require("./build-guide.cjs");

const root = path.resolve(__dirname, "..");

const asArray = (value) => (Array.isArray(value) ? value : []);

const validateToolsPayload = (payload, { requireGuide = true } = {}) => {
  const errors = [];
  const warnings = [];
  if (!payload || typeof payload !== "object") return { errors: ["tools payload is not an object"], warnings };
  if (!Array.isArray(payload.tools)) return { errors: ["tools payload must contain a tools array"], warnings };

  const ids = new Set();
  const urls = new Set();
  const names = new Set();
  const orderValues = new Set();
  const counts = Object.fromEntries(categories.map((category) => [category, 0]));

  for (const tool of payload.tools) {
    const label = tool?.name || tool?.id || "(unknown tool)";
    for (const field of ["id", "name", "url", "category", "summary", "tier", "access", "source", "addedAt", "status"]) {
      if (!tool || typeof tool[field] !== "string" || !tool[field].trim()) errors.push(`${label}: missing ${field}`);
    }
    if (!tool || !Array.isArray(tool.tags)) errors.push(`${label}: tags must be an array`);
    if (tool && typeof tool.auto !== "boolean") errors.push(`${label}: auto must be a boolean`);
    if (tool && typeof tool.guide !== "boolean") errors.push(`${label}: guide must be a boolean`);
    if (tool && !Number.isFinite(Number(tool.order))) errors.push(`${label}: order must be a number`);
    if (!tool || !categories.includes(tool.category)) {
      errors.push(`${label}: unknown category ${tool?.category}`);
      continue;
    }
    counts[tool.category] += 1;

    let canonical = tool.url;
    try {
      canonical = canonicalizeUrl(tool.url);
    } catch (error) {
      errors.push(`${label}: invalid URL ${tool.url}`);
    }
    if (ids.has(tool.id)) errors.push(`${label}: duplicate id ${tool.id}`);
    ids.add(tool.id);
    if (urls.has(canonical)) errors.push(`${label}: duplicate URL ${tool.url}`);
    urls.add(canonical);
    if (names.has(nameKey(tool.name))) warnings.push(`${label}: duplicate name ${tool.name}`);
    names.add(nameKey(tool.name));
    if (orderValues.has(Number(tool.order))) warnings.push(`${label}: duplicate order ${tool.order}`);
    orderValues.add(Number(tool.order));
    if (tool.auto && tool.guide) errors.push(`${label}: auto-added tools must not be part of the guide snapshot`);
  }

  const guideTools = payload.tools.filter((tool) => tool.guide);
  if (requireGuide && guideTools.length !== 48) errors.push(`guide snapshot must contain 48 tools, found ${guideTools.length}`);
  if (requireGuide) {
    const guideCounts = guideTools.reduce((result, tool) => {
      result[tool.category] = (result[tool.category] || 0) + 1;
      return result;
    }, {});
    if (guideCounts.video !== 16 || guideCounts.text !== 15 || guideCounts.images !== 17) {
      errors.push(`guide snapshot must keep the 16/15/17 split, found ${JSON.stringify(guideCounts)}`);
    }
  }

  return { errors, warnings, counts, guide: guideTools.length };
};

const validatePendingPayload = (pending, toolsPayload) => {
  const errors = [];
  const warnings = [];
  if (!pending || typeof pending !== "object" || !Array.isArray(pending.items)) {
    return { errors: ["pending payload must contain an items array"], warnings };
  }
  const toolUrls = new Set(asArray(toolsPayload?.tools).map((tool) => {
    try { return canonicalizeUrl(tool.url); } catch (error) { return tool.url; }
  }));
  const toolNames = new Set(asArray(toolsPayload?.tools).map((tool) => nameKey(tool.name)));
  const seen = new Set();

  for (const item of pending.items) {
    const label = item?.name || item?.url || "(unknown pending item)";
    if (!item || typeof item.name !== "string" || !item.name.trim()) errors.push(`${label}: missing name`);
    if (!item || typeof item.url !== "string" || !item.url.trim()) errors.push(`${label}: missing url`);
    if (!item || typeof item.reason !== "string" || !item.reason.trim()) errors.push(`${label}: missing reason`);
    if (item?.category && !categories.includes(item.category)) errors.push(`${label}: unknown category ${item.category}`);
    let canonical = item?.url;
    try {
      canonical = canonicalizeUrl(item.url);
    } catch (error) {
      errors.push(`${label}: invalid URL ${item.url}`);
    }
    if (seen.has(canonical)) errors.push(`${label}: duplicate pending URL ${item.url}`);
    seen.add(canonical);
    if (toolUrls.has(canonical)) warnings.push(`${label}: already listed on the site`);
    if (toolNames.has(nameKey(item.name))) warnings.push(`${label}: name already listed on the site`);
  }

  return { errors, warnings };
};

const validateBlocklistPayload = (blocklist) => {
  const errors = [];
  if (!blocklist || typeof blocklist !== "object") return { errors: ["blocklist is not an object"] };
  for (const field of ["urls", "domains", "names"]) {
    if (!Array.isArray(blocklist[field])) errors.push(`blocklist.${field} must be an array`);
  }
  return { errors };
};

const countCards = (html) => (String(html).match(/<article class="card"/g) || []).length;

const validateRenderedHtml = (html, payload) => {
  const errors = [];
  const source = String(html);
  const cards = countCards(source);
  if (cards !== payload.tools.length) errors.push(`rendered card count ${cards} does not match tools ${payload.tools.length}`);
  for (const category of categories) {
    const expected = payload.tools.filter((tool) => tool.category === category).length;
    const actual = (source.match(new RegExp(`<article class="card" data-category="${category}"`, "g")) || []).length;
    if (actual !== expected) errors.push(`rendered ${category} card count ${actual} does not match tools ${expected}`);
  }
  const leftovers = source.match(/\{\{[A-Z_]+\}\}/g);
  if (leftovers) errors.push(`unresolved template tokens: ${[...new Set(leftovers)].join(", ")}`);
  if (!source.includes(`All<span>${payload.tools.length}</span>`)) errors.push("filter count for all tools is stale");
  if (!source.includes(`Showing all ${payload.tools.length} tools`)) errors.push("filter status count is stale");
  return { errors, cards };
};

const validateGuideHtml = (html, payload) => {
  const errors = [];
  const source = String(html);
  const guideTools = payload.tools.filter((tool) => tool.guide);
  const items = (source.match(/<li class="tool">/g) || []).length;
  if (items !== guideTools.length) errors.push(`guide item count ${items} does not match ${guideTools.length}`);
  if (!source.includes(`${guideTools.length} free tools`)) errors.push("guide cover count is stale");
  if (!source.includes(`<span>${guideTools.length} tools</span>`)) errors.push("guide chip count is stale");
  return { errors, items };
};

const validatePdf = (pdfPath) => {
  if (!fs.existsSync(pdfPath)) return { errors: [`missing PDF: ${pdfPath}`], pages: null, tagged: false };
  const output = execFileSync("pdfinfo", [pdfPath], { encoding: "utf8" });
  const pagesMatch = output.match(/^Pages:\s+(\d+)/m);
  const taggedMatch = output.match(/^Tagged:\s+(\w+)/m);
  const pages = pagesMatch ? Number(pagesMatch[1]) : null;
  const tagged = Boolean(taggedMatch && taggedMatch[1].toLowerCase() === "yes");
  const errors = [];
  if (pages !== 1) errors.push(`PDF must be one page, found ${pages}`);
  if (!tagged) errors.push("PDF must be tagged");
  return { errors, pages, tagged };
};

const validateFiles = ({
  projectRoot = root,
  payload,
  indexHtmlPath = path.join(projectRoot, "index.html"),
  guideHtmlPath = path.join(projectRoot, "creative-guide.html"),
  pdfPath = path.join(projectRoot, "assets", "creative-field-guide.pdf"),
  previewPath = path.join(projectRoot, "assets", "creative-field-guide-preview.png"),
  qrPngPath = path.join(projectRoot, "assets", "github-qr.png"),
  checkBrowser = false,
  skipGuide = false,
} = {}) => {
  const errors = [];
  const warnings = [];
  if (!fs.existsSync(indexHtmlPath)) errors.push(`missing rendered site: ${indexHtmlPath}`);
  else {
    const rendered = validateRenderedHtml(fs.readFileSync(indexHtmlPath, "utf8"), payload);
    errors.push(...rendered.errors);
  }
  let pdf = { errors: [], pages: null, tagged: false };
  if (!skipGuide) {
    if (!fs.existsSync(guideHtmlPath)) errors.push(`missing guide HTML: ${guideHtmlPath}`);
    else {
      const guide = validateGuideHtml(fs.readFileSync(guideHtmlPath, "utf8"), payload);
      errors.push(...guide.errors);
    }
    pdf = validatePdf(pdfPath);
    errors.push(...pdf.errors);
    if (!fs.existsSync(previewPath)) errors.push(`missing PDF preview: ${previewPath}`);
  }
  const qr = validateQr(qrPngPath, githubProfile);
  if (!qr.ok) errors.push(`QR validation failed: expected ${githubProfile}, decoded ${qr.decoded || "nothing"}`);
  if (qr.warning) warnings.push(qr.warning);
  if (checkBrowser) warnings.push("browser validation is run separately by update-site.cjs");
  return { errors, warnings, pdf };
};

if (require.main === module) {
  const payload = JSON.parse(fs.readFileSync(path.join(root, "data", "tools.json"), "utf8"));
  const pending = JSON.parse(fs.readFileSync(path.join(root, "data", "pending.json"), "utf8"));
  const blocklist = JSON.parse(fs.readFileSync(path.join(root, "data", "blocklist.json"), "utf8"));
  const toolsResult = validateToolsPayload(payload);
  const pendingResult = validatePendingPayload(pending, payload);
  const blocklistResult = validateBlocklistPayload(blocklist);
  const filesResult = validateFiles({ payload });
  const result = {
    ok: [toolsResult, pendingResult, blocklistResult, filesResult].every((item) => item.errors.length === 0),
    tools: { errors: toolsResult.errors, warnings: toolsResult.warnings, counts: toolsResult.counts, guide: toolsResult.guide },
    pending: { errors: pendingResult.errors, warnings: pendingResult.warnings, items: pending.items.length },
    blocklist: blocklistResult,
    files: { errors: filesResult.errors, warnings: filesResult.warnings, pdf: filesResult.pdf },
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

module.exports = {
  validateToolsPayload,
  validatePendingPayload,
  validateBlocklistPayload,
  validateRenderedHtml,
  validateGuideHtml,
  validatePdf,
  validateFiles,
  countCards,
};

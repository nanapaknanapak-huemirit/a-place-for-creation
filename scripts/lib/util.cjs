const fs = require("fs");
const path = require("path");

const categories = ["video", "text", "images"];

const categoryMeta = {
  video: { label: "Video", srcClass: "src-video" },
  text: { label: "Text", srcClass: "src-text" },
  images: { label: "Images", srcClass: "src-image" },
};

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const formatDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return `${String(date.getUTCDate()).padStart(2, "0")} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
};

const isoDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
};

const readJson = (filePath, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" && fallback !== undefined) return fallback;
    throw error;
  }
};

const writeJsonAtomic = (filePath, value) => {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
};

const writeTextAtomic = (filePath, value) => {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(temporaryPath, value, "utf8");
  fs.renameSync(temporaryPath, filePath);
};

const copyFileAtomic = (from, to) => {
  const temporaryPath = `${to}.tmp-${process.pid}-${Date.now()}`;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, temporaryPath);
  fs.renameSync(temporaryPath, to);
};

const slugify = (value) => String(value ?? "")
  .toLowerCase()
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^\w\s-]/g, "")
  .trim()
  .replace(/[\s_]+/g, "-")
  .replace(/-+/g, "-")
  .replace(/^-|-$/g, "");

const nameKey = (value) => String(value ?? "")
  .toLowerCase()
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, " ")
  .trim()
  .replace(/\s+/g, " ");

const trackingParameters = /^(utm_.+|ref|ref_|referrer|source|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|yclid|_ga|_gl|vero_id|oly_enc_id|oly_anon_id)$/i;

const canonicalizeUrl = (value) => {
  const url = new URL(String(value).trim());
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`Unsupported URL protocol: ${value}`);
  }
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (trackingParameters.test(key)) url.searchParams.delete(key);
  }
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  const search = url.searchParams.toString();
  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}${pathname}${search ? `?${search}` : ""}`;
};

const domainOf = (value) => {
  const url = new URL(value);
  return url.hostname.toLowerCase().replace(/^www\./, "");
};

const stripMarkdown = (value) => String(value ?? "")
  .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .replace(/`([^`]+)`/g, "$1")
  .replace(/[*_~]+/g, "")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&nbsp;/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const truncate = (value, length = 240) => {
  const text = String(value ?? "").trim();
  if (text.length <= length) return text;
  const cut = text.slice(0, length);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 80 ? lastSpace : length).replace(/[.,;:!?-]+$/, "")}…`;
};

const nowIso = () => new Date().toISOString();

const uniqueBy = (items, keyFn) => {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
};

module.exports = {
  categories,
  categoryMeta,
  escapeHtml,
  formatDate,
  isoDate,
  readJson,
  writeJsonAtomic,
  writeTextAtomic,
  copyFileAtomic,
  slugify,
  nameKey,
  canonicalizeUrl,
  domainOf,
  stripMarkdown,
  truncate,
  nowIso,
  uniqueBy,
};

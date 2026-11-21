const {
  categories,
  canonicalizeUrl,
  domainOf,
  slugify,
  nameKey,
  stripMarkdown,
  truncate,
  uniqueBy,
} = require("./util.cjs");

const categoryKeywords = {
  video: [
    ["video", 3], ["film", 2], ["movie", 2], ["clip", 2], ["footage", 3],
    ["screen record", 3], ["recording", 2], ["animation", 2], ["animate", 2],
    ["caption", 2], ["subtitle", 2], ["transcode", 2], ["stream", 2],
    ["reel", 2], ["youtube", 2], ["tiktok", 2], ["ffmpeg", 3],
    ["vfx", 3], ["color grade", 3], ["video editor", 3], ["gif", 1],
  ],
  text: [
    ["write", 2], ["writing", 3], ["writer", 2], ["text", 2], ["word", 2],
    ["grammar", 3], ["paraphrase", 3], ["summarize", 3], ["summary", 2],
    ["translate", 3], ["translation", 3], ["transcribe", 3], ["transcription", 3],
    ["transcript", 2], ["notes", 2], ["document", 2], ["docs", 2],
    ["markdown", 2], ["blog", 2], ["novel", 2], ["story", 1], ["script", 1],
    ["proofread", 3], ["spell", 2], ["research", 2], ["chatbot", 2],
    ["llm", 2], ["prompt", 2], ["ocr", 2], ["pdf", 2], ["ebook", 2],
    ["newsletter", 2], ["copywriting", 3], ["dictionary", 2], ["thesaurus", 2],
  ],
  images: [
    ["image", 3], ["photo", 3], ["picture", 2], ["design", 2], ["draw", 2],
    ["drawing", 2], ["paint", 2], ["graphic", 2], ["logo", 3], ["icon", 2],
    ["svg", 2], ["png", 1], ["jpg", 1], ["jpeg", 1], ["webp", 1],
    ["background removal", 3], ["upscale", 3], ["restore", 2], ["art", 2],
    ["thumbnail", 2], ["poster", 2], ["mockup", 2], ["palette", 3],
    ["color", 2], ["figma", 2], ["canva", 2], ["photoshop", 3],
    ["vector", 2], ["illustration", 3], ["render", 1], ["avatar", 2],
  ],
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizedHeading = (value) => stripMarkdown(value).replace(/\s+/g, " ").trim().toLowerCase();

const scoreCategory = (text, category) => {
  let score = 0;
  for (const [keyword, weight] of categoryKeywords[category]) {
    const pattern = new RegExp(`\\b${escapeRegex(keyword)}\\b`, "i");
    if (pattern.test(text)) score += weight;
  }
  return score;
};

const classifyByKeywords = (text) => {
  const scored = categories.map((category) => ({ category, score: scoreCategory(text, category) }));
  scored.sort((a, b) => b.score - a.score);
  const [first, second] = scored;
  if (!first || first.score < 2) return null;
  if (second.score >= 2 && first.score < second.score * 1.25) return null;
  return {
    category: first.category,
    confidence: Math.min(0.95, 0.55 + first.score * 0.06),
    reason: "keywords",
  };
};

const classifyCategory = (entry) => {
  const text = `${entry.name} ${entry.description || ""}`;
  if (entry.sectionCategory && !entry.requireKeywords) {
    return { category: entry.sectionCategory, confidence: 0.95, reason: "source-section" };
  }
  const byKeywords = classifyByKeywords(text);
  if (!byKeywords) return null;
  if (entry.sectionCategory && entry.requireKeywords && byKeywords.category !== entry.sectionCategory) {
    return null;
  }
  return byKeywords;
};

const detectFree = (entry, source) => {
  const text = `${entry.name} ${entry.description || ""}`;
  const withoutTrial = text.replace(/\bfree trials?\b/gi, "trial");
  const hasFreePlan = /\bfree[- ]tier\b|\bfree plan\b|\bfreemium\b|\bfree forever\b|\bfree for\b|\bfree to use\b|\bfree api\b|\bfree access\b|\bcommunity edition\b|\bfree version\b/i.test(withoutTrial);
  const trialOnly = /\btrial\b/i.test(withoutTrial) && !hasFreePlan && !/\bopen[- ]source\b|\bopen[- ]weights\b/i.test(text);
  const oneTimeCredits = /\bone[- ]time\b[^.]{0,60}\bcredits?\b/i.test(text) && !/\bmonthly\b|\bdaily\b|\brecurring\b|\bfree tier\b|\bfree plan\b/i.test(text);
  const paidOnly = /\bpaid only\b|\bsubscription required\b|\brequires? (a )?paid\b|\bno free (plan|tier)\b/i.test(text) && !hasFreePlan;
  const openSource = /\bopen[- ]source\b|\bopen[- ]weights\b|\bself[- ]host(ed|able)?\b|\bMIT\b|\bApache[- ]2\.0\b|\bGPL\b/i.test(text);
  const freeWord = /\bfree\b/i.test(withoutTrial);
  const credits = /\bfree credits?\b|\bcredits?\b/i.test(text);

  if (trialOnly) return { confidence: 0.05, reason: "trial-only", tier: "Trial", tierClass: "tier" };
  if (paidOnly) return { confidence: 0.05, reason: "paid-only", tier: "Paid", tierClass: "tier" };
  if (oneTimeCredits) return { confidence: 0.35, reason: "one-time-credits", tier: "Free credits", tierClass: "tier" };
  if (openSource) return { confidence: 1, reason: "open-source", tier: "Open source", tierClass: "tier tier-open" };
  if (hasFreePlan) {
    const forever = /\bfree forever\b/i.test(text);
    return { confidence: 0.95, reason: "free-tier", tier: forever ? "Free" : "Free tier", tierClass: forever ? "tier tier-free" : "tier" };
  }
  if (freeWord) return { confidence: 0.85, reason: "free", tier: "Free", tierClass: "tier tier-free" };
  if (credits) return { confidence: 0.6, reason: "credits", tier: "Free credits", tierClass: "tier" };

  const baseline = source.kind === "hn-algolia" ? 0.45 : source.id === "free-for-dev" ? 0.8 : 0.65;
  return { confidence: baseline, reason: "source-baseline", tier: "Free tier", tierClass: "tier" };
};

const extractTags = (entry, category) => {
  const text = `${entry.name} ${entry.description || ""}`.toLowerCase();
  const candidates = [
    ["ai", "AI"], ["open source", "Open source"], ["open-source", "Open source"],
    ["video", "Video"], ["image", "Images"], ["photo", "Photos"], ["design", "Design"],
    ["writing", "Writing"], ["text", "Text"], ["audio", "Audio"], ["music", "Music"],
    ["pdf", "PDF"], ["translation", "Translation"], ["caption", "Captions"],
    ["subtitle", "Subtitles"], ["editor", "Editor"], ["recording", "Recording"],
    ["background removal", "Background removal"], ["upscale", "Upscaling"],
    ["logo", "Logos"], ["icon", "Icons"], ["palette", "Palettes"],
    ["font", "Fonts"], ["3d", "3D"], ["animation", "Animation"],
  ];
  const tags = [];
  for (const [needle, label] of candidates) {
    if (text.includes(needle) && !tags.includes(label)) tags.push(label);
    if (tags.length === 3) break;
  }
  if (tags.length === 0) tags.push(category === "images" ? "Images" : category === "video" ? "Video" : "Text");
  return tags;
};

const extractKeywords = (entry, category, tags) => {
  const words = `${entry.name} ${entry.description || ""}`
    .toLowerCase()
    .replace(/[^a-z0-9+#\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !["the", "and", "for", "with", "from", "your", "that", "this", "free", "online", "tool", "tools", "app", "apps", "platform", "service", "using", "without", "into", "more", "than"].includes(word));
  return uniqueBy([...tags.map((tag) => tag.toLowerCase()), ...words], (word) => word).slice(0, 12);
};

const monogramFor = (name) => {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  return String(words[0] || "?").slice(0, 2).replace(/^./, (letter) => letter.toUpperCase());
};

const entryDate = (now) => new Date(now).toISOString().slice(0, 10);

const buildCandidate = (entry, { now, order, source }) => {
  let url;
  try {
    url = canonicalizeUrl(entry.url);
  } catch (error) {
    return null;
  }

  const free = detectFree(entry, source);
  const category = classifyCategory(entry);
  const summary = truncate(
    stripMarkdown(entry.description) || `${entry.name} — discovered via ${entry.sourceLabel}.`,
    240,
  );
  const tags = category ? extractTags(entry, category.category) : [];
  const access = /\blocal\b|\boffline\b|\bdesktop\b|\binstallable\b/i.test(`${entry.name} ${entry.description || ""}`)
    ? "Browser · Desktop"
    : "Browser";

  return {
    id: slugify(entry.name) || slugify(domainOf(url)),
    name: stripMarkdown(entry.name),
    url,
    domain: domainOf(url),
    category: category ? category.category : null,
    categoryConfidence: category ? category.confidence : 0,
    categoryReason: category ? category.reason : "unclear",
    freeConfidence: free.confidence,
    freeReason: free.reason,
    tier: free.tier,
    tierClass: free.tierClass,
    summary,
    tags,
    access,
    keywords: category ? extractKeywords(entry, category.category, tags) : [],
    monogram: monogramFor(entry.name),
    source: source.id,
    sourceLabel: source.label,
    sourceUrl: source.url,
    sourceSection: entry.sourceSection || null,
    addedAt: entryDate(now),
    lastChecked: entryDate(now),
    status: "active",
    auto: true,
    guide: false,
    order,
  };
};

const parseMarkdownEntries = (markdown, source) => {
  const sectionMap = new Map();
  for (const section of source.sections || []) {
    sectionMap.set(normalizedHeading(section.heading), section);
  }

  const entries = [];
  let currentSection = null;
  const lines = String(markdown).replace(/\r\n/g, "\n").split("\n");

  for (const line of lines) {
    const headingMatch = line.match(/^(#{2,3})\s+(.+?)\s*#*\s*$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const heading = normalizedHeading(headingMatch[2]);
      const section = sectionMap.get(heading);
      if (level === 2) {
        currentSection = section || null;
      } else if (level === 3) {
        currentSection = section || null;
      }
      continue;
    }

    if (!currentSection) continue;

    const entryMatch = line.match(/^\s*[-*]\s+\[([^\]]+)\]\(([^)]+)\)\s*(?:[—–]\s*|-\s+)?(.*)$/);
    if (!entryMatch) continue;

    const [, rawName, rawUrl, rawDescription] = entryMatch;
    if (!/^https?:\/\//i.test(rawUrl.trim())) continue;

    const labels = Array.from(String(rawDescription).matchAll(/\*\*(.+?)\*\*/g), (match) => match[1].trim());
    entries.push({
      name: stripMarkdown(rawName),
      url: rawUrl.trim(),
      description: stripMarkdown(rawDescription),
      rawDescription: rawDescription.trim(),
      labels,
      sourceSection: currentSection.heading,
      sectionCategory: currentSection.category || null,
      requireKeywords: Boolean(currentSection.requireKeywords),
      sourceId: source.id,
      sourceLabel: source.label,
    });
  }

  return entries;
};

const parseHnSource = (payload, source, now) => {
  const hits = Array.isArray(payload?.hits) ? payload.hits : [];
  const lookbackMs = Number(source.lookbackDays || 3) * 86400000;
  const minimum = new Date(now).getTime() - lookbackMs;
  const minPoints = Number(source.minPoints || 0);

  return hits
    .filter((hit) => Number(hit.points || 0) >= minPoints)
    .filter((hit) => Number(hit.created_at_i || 0) * 1000 >= minimum)
    .map((hit) => {
      const title = String(hit.title || "").replace(/^show hn:\s*/i, "").trim();
      const url = hit.url || hit.story_url || `https://news.ycombinator.com/item?id=${hit.objectID}`;
      const description = `${title}. ${hit.story_text || ""}`.trim();
      return {
        name: title,
        url,
        description: stripMarkdown(description),
        rawDescription: description,
        labels: [],
        sourceSection: "Show HN",
        sectionCategory: null,
        requireKeywords: true,
        sourceId: source.id,
        sourceLabel: source.label,
        points: Number(hit.points || 0),
        createdAt: hit.created_at_i ? new Date(hit.created_at_i * 1000).toISOString() : null,
        cursor: Number(hit.created_at_i || 0),
      };
    })
    .filter((entry) => entry.name && entry.url);
};

const fetchWithRetry = async (url, { headers, fetchImpl, timeoutMs, attempts = 3 }) => {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status === 304) return { notModified: true, response };
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return { notModified: false, response };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw lastError;
};

const buildSourceUrl = (source, stateEntry, now) => {
  if (source.kind !== "hn-algolia") return source.url;
  const cursor = Number(stateEntry.cursor || 0);
  const fallback = Math.floor(new Date(now).getTime() / 1000) - Number(source.lookbackDays || 3) * 86400;
  const since = cursor > 0 ? cursor : fallback;
  const filters = [`created_at_i>${since}`];
  if (Number(source.minPoints || 0) > 0) filters.push(`points>=${Number(source.minPoints)}`);
  const url = new URL(source.url);
  url.searchParams.set("tags", source.tags || "show_hn");
  url.searchParams.set("hitsPerPage", "100");
  url.searchParams.set("numericFilters", filters.join(","));
  return url.toString();
};

const fetchSource = async (source, stateEntry, { fetchImpl = fetch, userAgent, timeoutMs = 15000, now = new Date() } = {}) => {
  const headers = {
    "user-agent": userAgent,
    accept: source.kind === "hn-algolia" ? "application/json" : "text/plain, text/markdown, */*",
  };
  if (stateEntry.etag) headers["if-none-match"] = stateEntry.etag;
  if (stateEntry.lastModified) headers["if-modified-since"] = stateEntry.lastModified;

  const url = buildSourceUrl(source, stateEntry, now);
  const { notModified, response } = await fetchWithRetry(url, { headers, fetchImpl, timeoutMs });
  const nextHeaders = {
    etag: response.headers.get("etag") || null,
    lastModified: response.headers.get("last-modified") || null,
  };
  if (notModified) return { notModified: true, ...nextHeaders, url };

  const text = await response.text();
  const json = source.kind === "hn-algolia" ? JSON.parse(text) : null;
  return { notModified: false, text, json, ...nextHeaders, url };
};

const dedupeCandidates = (candidates, existingTools, blocklist) => {
  const blockedUrls = new Set((blocklist.urls || []).map((url) => {
    try { return canonicalizeUrl(url); } catch (error) { return url; }
  }));
  const blockedDomains = new Set((blocklist.domains || []).map((domain) => String(domain).toLowerCase().replace(/^www\./, "")));
  const blockedNames = new Set((blocklist.names || []).map(nameKey));

  const existingUrls = new Set(existingTools.map((tool) => {
    try { return canonicalizeUrl(tool.url); } catch (error) { return tool.url; }
  }));
  const existingDomains = new Set(existingTools.map((tool) => {
    try { return domainOf(tool.url); } catch (error) { return ""; }
  }).filter(Boolean));
  const existingNames = new Set(existingTools.map((tool) => nameKey(tool.name)));

  const seenUrls = new Set();
  const seenDomains = new Set();
  const seenNames = new Set();
  const accepted = [];
  const skipped = [];

  for (const candidate of candidates) {
    const key = nameKey(candidate.name);
    let reason = null;
    if (blockedUrls.has(candidate.url) || blockedDomains.has(candidate.domain) || blockedNames.has(key)) reason = "blocklisted";
    else if (existingUrls.has(candidate.url) || existingDomains.has(candidate.domain) || existingNames.has(key)) reason = "already-listed";
    else if (seenUrls.has(candidate.url) || seenDomains.has(candidate.domain) || seenNames.has(key)) reason = "duplicate-candidate";

    if (reason) {
      skipped.push({ url: candidate.url, name: candidate.name, reason });
      continue;
    }

    seenUrls.add(candidate.url);
    seenDomains.add(candidate.domain);
    seenNames.add(key);
    accepted.push(candidate);
  }

  return { accepted, skipped };
};

const pendingReason = (candidate) => {
  if (!candidate.category) return "category unclear";
  if (candidate.freeReason === "trial-only") return "free trial only";
  if (candidate.freeReason === "one-time-credits") return "one-time credits only";
  if (candidate.freeConfidence < 0.75) return "free access unclear";
  if (candidate.categoryConfidence < 0.7) return "category confidence too low";
  return "needs review";
};

const toPendingItem = (candidate) => ({
  id: candidate.id,
  name: candidate.name,
  url: candidate.url,
  category: candidate.category,
  categoryConfidence: candidate.categoryConfidence,
  freeConfidence: candidate.freeConfidence,
  freeReason: candidate.freeReason,
  summary: candidate.summary,
  tags: candidate.tags,
  source: candidate.source,
  sourceLabel: candidate.sourceLabel,
  sourceSection: candidate.sourceSection,
  reason: pendingReason(candidate),
  firstSeenAt: candidate.addedAt,
});

const toTool = (candidate) => ({
  id: candidate.id,
  name: candidate.name,
  url: candidate.url,
  category: candidate.category,
  summary: candidate.summary,
  tags: candidate.tags,
  tier: candidate.tier,
  tierClass: candidate.tierClass,
  access: candidate.access,
  keywords: candidate.keywords,
  monogram: candidate.monogram,
  source: candidate.source,
  sourceUrl: candidate.sourceUrl,
  sourceSection: candidate.sourceSection,
  addedAt: candidate.addedAt,
  lastChecked: candidate.lastChecked,
  status: candidate.status,
  auto: true,
  guide: false,
  order: candidate.order,
});

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

const runDiscovery = async ({
  sources,
  toolsPayload,
  state,
  pendingPayload,
  blocklist,
  config,
  now = new Date(),
  fetchImpl = fetch,
  userAgent = "a-place-for-creation/1.0",
  dryRun = false,
}) => {
  const tools = JSON.parse(JSON.stringify(toolsPayload));
  const nextState = JSON.parse(JSON.stringify(state || { version: 1, sources: {} }));
  const nextPending = JSON.parse(JSON.stringify(pendingPayload || { version: 1, updatedAt: now.toISOString(), items: [] }));
  nextState.sources = nextState.sources || {};
  nextPending.items = Array.isArray(nextPending.items) ? nextPending.items : [];

  const report = {
    startedAt: new Date(now).toISOString(),
    dryRun,
    sources: [],
    added: [],
    queued: [],
    rejected: [],
    skipped: [],
    baseline: [],
  };

  const maxNew = Number(config.maxNewPerRun || 5);
  const maxPending = Number(config.maxPendingPerRun || 25);
  const usedIds = new Set(tools.tools.map((tool) => tool.id));
  let nextOrder = tools.tools.reduce((max, tool) => Math.max(max, Number(tool.order || 0)), 0) + 1;

  for (const source of sources.filter((item) => item.enabled !== false)) {
    const stateEntry = nextState.sources[source.id] || {
      initialized: false,
      seen: [],
      etag: null,
      lastModified: null,
      cursor: 0,
      lastFetchedAt: null,
      lastRunAt: null,
    };
    stateEntry.seen = Array.isArray(stateEntry.seen) ? stateEntry.seen : [];
    const seen = new Set(stateEntry.seen.map((url) => {
      try { return canonicalizeUrl(url); } catch (error) { return url; }
    }));

    const sourceReport = { id: source.id, label: source.label, fetched: false, notModified: false, entries: 0, baseline: false };
    let fetched;
    try {
      fetched = await fetchSource(source, stateEntry, {
        fetchImpl,
        userAgent: userAgent || config.userAgent,
        timeoutMs: Number(config.requestTimeoutMs || 15000),
        now,
      });
    } catch (error) {
      sourceReport.error = error.message;
      report.sources.push(sourceReport);
      throw new Error(`Source ${source.id} failed: ${error.message}`);
    }

    stateEntry.lastFetchedAt = new Date(now).toISOString();
    stateEntry.lastRunAt = new Date(now).toISOString();
    if (fetched.etag) stateEntry.etag = fetched.etag;
    if (fetched.lastModified) stateEntry.lastModified = fetched.lastModified;

    if (fetched.notModified) {
      sourceReport.notModified = true;
      nextState.sources[source.id] = stateEntry;
      report.sources.push(sourceReport);
      continue;
    }

    sourceReport.fetched = true;
    const entries = source.kind === "hn-algolia"
      ? parseHnSource(fetched.json, source, now)
      : parseMarkdownEntries(fetched.text, source);
    sourceReport.entries = entries.length;

    if (source.kind === "hn-algolia") {
      const cursor = entries.reduce((max, entry) => Math.max(max, Number(entry.cursor || 0)), Number(stateEntry.cursor || 0));
      stateEntry.cursor = cursor;
    }

    const entryUrls = entries.map((entry) => {
      try { return canonicalizeUrl(entry.url); } catch (error) { return null; }
    }).filter(Boolean);

    if (!stateEntry.initialized) {
      sourceReport.baseline = true;
      for (const url of entryUrls) seen.add(url);
      stateEntry.initialized = true;
      stateEntry.seen = [...seen];
      report.baseline.push({ source: source.id, entries: entries.length });
      nextState.sources[source.id] = stateEntry;
      report.sources.push(sourceReport);
      continue;
    }

    const candidates = entries
      .map((entry) => buildCandidate(entry, { now, order: nextOrder, source }))
      .filter(Boolean)
      .filter((candidate) => !seen.has(candidate.url));

    const { accepted, skipped } = dedupeCandidates(candidates, tools.tools, blocklist || {});
    report.skipped.push(...skipped.map((item) => ({ ...item, source: source.id })));

    const pendingUrls = new Set(nextPending.items.map((item) => {
      try { return canonicalizeUrl(item.url); } catch (error) { return item.url; }
    }));

    const autoCandidates = accepted
      .filter((candidate) => candidate.category && candidate.freeConfidence >= 0.75 && candidate.categoryConfidence >= 0.7)
      .sort((a, b) => (b.freeConfidence - a.freeConfidence) || (b.categoryConfidence - a.categoryConfidence) || a.name.localeCompare(b.name));
    const remaining = Math.max(0, maxNew - report.added.length);
    const selected = autoCandidates.slice(0, remaining);

    for (const candidate of selected) {
      candidate.id = uniqueId(candidate.id, usedIds);
      candidate.order = nextOrder;
      nextOrder += 1;
      tools.tools.push(toTool(candidate));
      report.added.push({ id: candidate.id, name: candidate.name, url: candidate.url, category: candidate.category, source: source.id });
    }

    const selectedUrls = new Set(selected.map((candidate) => candidate.url));
    const rejected = accepted.filter((candidate) => candidate.freeReason === "trial-only" || candidate.freeReason === "paid-only");
    report.rejected.push(...rejected.map((candidate) => ({ name: candidate.name, url: candidate.url, reason: candidate.freeReason, source: source.id })));

    let pendingAdded = 0;
    for (const candidate of accepted) {
      if (selectedUrls.has(candidate.url) || rejected.some((item) => item.url === candidate.url)) continue;
      if (pendingUrls.has(candidate.url)) continue;
      if (pendingAdded >= maxPending) break;
      nextPending.items.push(toPendingItem(candidate));
      pendingUrls.add(candidate.url);
      pendingAdded += 1;
      report.queued.push({ id: candidate.id, name: candidate.name, url: candidate.url, reason: pendingReason(candidate), source: source.id });
    }

    for (const url of entryUrls) seen.add(url);
    stateEntry.seen = [...seen];
    nextState.sources[source.id] = stateEntry;
    report.sources.push(sourceReport);
  }

  if (report.added.length > 0) {
    tools.updatedAt = new Date(now).toISOString();
    tools.version = Number(tools.version || 1);
  }
  nextPending.updatedAt = new Date(now).toISOString();

  report.finishedAt = new Date(now).toISOString();
  report.totals = {
    added: report.added.length,
    queued: report.queued.length,
    rejected: report.rejected.length,
    skipped: report.skipped.length,
    baseline: report.baseline.reduce((total, item) => total + item.entries, 0),
  };

  return { tools, pending: nextPending, state: nextState, report };
};

module.exports = {
  categoryKeywords,
  classifyByKeywords,
  classifyCategory,
  detectFree,
  parseMarkdownEntries,
  parseHnSource,
  canonicalizeUrl,
  buildCandidate,
  dedupeCandidates,
  fetchSource,
  runDiscovery,
  toTool,
  toPendingItem,
  pendingReason,
};

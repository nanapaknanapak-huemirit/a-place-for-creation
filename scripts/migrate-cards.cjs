const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const indexPath = path.join(root, "index.html");
const outputPath = path.join(root, "data", "tools.json");

const playwrightCandidates = [
  process.env.PLAYWRIGHT_PATH,
  "playwright",
  "/var/home/mirit/.npm/_npx/bbb8a2c4738e2b0c/node_modules/playwright",
].filter(Boolean);

let playwright;
for (const candidate of playwrightCandidates) {
  try {
    playwright = require(candidate);
    break;
  } catch (error) {
    if (candidate === playwrightCandidates[playwrightCandidates.length - 1]) throw error;
  }
}

const chromeCandidates = [
  process.env.CHROME_PATH,
  "/var/home/mirit/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].filter(Boolean);

const chromePath = chromeCandidates.find((candidate) => fs.existsSync(candidate));
const launchOptions = chromePath ? { executablePath: chromePath } : {};

const slugify = (value) => String(value)
  .toLowerCase()
  .normalize("NFKD")
  .replace(/[^\w\s-]/g, "")
  .trim()
  .replace(/[\s_]+/g, "-")
  .replace(/-+/g, "-");

(async () => {
  const browser = await playwright.chromium.launch({ ...launchOptions, headless: true });
  const page = await browser.newPage();
  await page.goto(`file://${indexPath}`, { waitUntil: "load" });

  const cards = await page.evaluate(() => Array.from(document.querySelectorAll(".card")).map((card, index) => {
    const link = card.querySelector("h3 a");
    const tier = card.querySelector(".tier");
    const access = card.querySelector(".access");
    return {
      index,
      category: card.dataset.category,
      name: link.textContent.trim(),
      url: link.getAttribute("href"),
      summary: card.querySelector(".summary").textContent.trim(),
      tags: Array.from(card.querySelectorAll(".tags li")).map((tag) => tag.textContent.trim()),
      tier: tier ? tier.textContent.trim() : "Free",
      tierClass: tier ? tier.className : "tier tier-free",
      access: access ? access.textContent.trim() : "Browser",
      keywords: (card.dataset.keywords || "").split(/\s+/).filter(Boolean),
      monogram: card.querySelector(".monogram").textContent.trim(),
    };
  }));

  await browser.close();

  const usedIds = new Set();
  const tools = cards.map((card) => {
    let id = slugify(card.name) || slugify(new URL(card.url).hostname);
    if (!id) id = `tool-${card.index + 1}`;
    let unique = id;
    let suffix = 2;
    while (usedIds.has(unique)) {
      unique = `${id}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(unique);

    return {
      id: unique,
      name: card.name,
      url: card.url,
      category: card.category,
      summary: card.summary,
      tags: card.tags,
      tier: card.tier,
      tierClass: card.tierClass,
      access: card.access,
      keywords: card.keywords,
      monogram: card.monogram,
      source: "curated",
      sourceUrl: null,
      addedAt: "2026-11-19",
      lastChecked: "2026-11-19",
      status: "active",
      auto: false,
      guide: true,
      order: card.index + 1,
    };
  });

  const counts = tools.reduce((result, tool) => {
    result[tool.category] = (result[tool.category] || 0) + 1;
    return result;
  }, {});

  if (tools.length !== 48 || counts.video !== 16 || counts.text !== 15 || counts.images !== 17) {
    throw new Error(`Unexpected tool counts: ${JSON.stringify(counts)}`);
  }

  const payload = {
    version: 1,
    updatedAt: "2026-11-19T00:00:00.000Z",
    tools,
  };

  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputPath, tools: tools.length, counts }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

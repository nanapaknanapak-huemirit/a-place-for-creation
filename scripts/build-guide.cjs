const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { escapeHtml } = require("./lib/util.cjs");
const { validateQr } = require("./lib/qr.cjs");
const { findPlaywright, findChrome } = require("./preflight.cjs");

const root = path.resolve(__dirname, "..");
const defaultToolsPath = path.join(root, "data", "tools.json");
const defaultGuidePath = path.join(root, "creative-guide.html");
const defaultPdfPath = path.join(root, "assets", "creative-field-guide.pdf");
const defaultPreviewPath = path.join(root, "assets", "creative-field-guide-preview.png");
const defaultQrPath = path.join(root, "assets", "github-qr.svg");
const defaultQrPngPath = path.join(root, "assets", "github-qr.png");
const githubProfile = "https://github.com/nanapaknanapak-huemirit?tab=repositories";

const categoryMeta = {
  video: {
    label: "Video",
    className: "video",
    kicker: "Moving pictures",
    note: "Export early. Free tiers often cap resolution or add a watermark.",
  },
  text: {
    label: "Text",
    className: "text",
    kicker: "Words and research",
    note: "Check important facts. Fluent AI writing can still be confidently wrong.",
  },
  images: {
    label: "Images",
    className: "image",
    kicker: "Visual worlds",
    note: "Keep a local copy of anything you could not easily recreate.",
  },
};

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Nov 2026";
  return `${monthNames[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
};

const validateGuideTools = (tools) => {
  if (!Array.isArray(tools)) throw new Error("Guide tools must be an array");
  if (tools.length !== 48) throw new Error(`Guide snapshot must contain 48 tools, found ${tools.length}`);
  const counts = tools.reduce((result, tool) => {
    result[tool.category] = (result[tool.category] || 0) + 1;
    return result;
  }, {});
  if (counts.video !== 16 || counts.text !== 15 || counts.images !== 17) {
    throw new Error(`Guide snapshot must keep the 16/15/17 split, found ${JSON.stringify(counts)}`);
  }
  return counts;
};

const buildGuideHtml = (tools, qrData, { generatedAt = new Date() } = {}) => {
  const counts = validateGuideTools(tools);
  const order = ["video", "text", "images"];
  const total = tools.length;
  let number = 0;

  const columns = order.map((category) => {
    const meta = categoryMeta[category];
    const items = tools.filter((tool) => tool.category === category).map((tool) => {
      number += 1;
      const tags = tool.tags.slice(0, 2).map(escapeHtml).join(" · ");
      return `<li class="tool">
        <span class="num">${String(number).padStart(2, "0")}</span>
        <span class="tool-copy">
          <a href="${escapeHtml(tool.href)}">${escapeHtml(tool.name)}</a>
          <span class="tags">${tags}</span>
        </span>
      </li>`;
    }).join("");

    return `<section class="column ${meta.className}">
      <header class="column-head">
        <span class="column-index">${order.indexOf(category) + 1}</span>
        <span class="column-copy">
          <strong>${meta.label}</strong>
          <span>${meta.kicker}</span>
        </span>
        <span class="column-count">${counts[category]}</span>
      </header>
      <ol class="tools">${items}</ol>
      <div class="craft-note"><strong>Craft note</strong><span>${meta.note}</span></div>
    </section>`;
  }).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>A Place for Creation — Creative Field Guide</title>
<style>
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    color: #241033;
    font-family: "Inter", "Noto Sans", "Segoe UI", system-ui, -apple-system, sans-serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page {
    width: 210mm;
    height: 297mm;
    padding: 8mm 9mm 7mm;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: #fff;
  }
  .cover {
    position: relative;
    overflow: hidden;
    padding: 8mm 9mm 7mm;
    border-radius: 4mm;
    background: linear-gradient(120deg, #7c3aed 0%, #e11d48 56%, #f59e0b 100%);
    color: #fff;
  }
  .cover::before {
    content: "";
    position: absolute;
    width: 46mm;
    height: 46mm;
    right: -8mm;
    top: -22mm;
    border: 7mm solid rgba(255, 255, 255, 0.16);
    border-radius: 50%;
  }
  .cover::after {
    content: "";
    position: absolute;
    width: 26mm;
    height: 26mm;
    right: 26mm;
    bottom: -16mm;
    border-radius: 50%;
    background: rgba(190, 242, 100, 0.4);
  }
  .kicker {
    position: relative;
    z-index: 1;
    font-size: 7pt;
    font-weight: 800;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    opacity: 0.86;
  }
  h1 {
    position: relative;
    z-index: 1;
    max-width: 150mm;
    margin: 2mm 0 0;
    font-size: 30pt;
    line-height: 0.96;
    letter-spacing: -0.04em;
  }
  h1 span { color: #fef3c7; }
  .cover p {
    position: relative;
    z-index: 1;
    max-width: 132mm;
    margin: 3mm 0 0;
    font-size: 8pt;
    line-height: 1.35;
    opacity: 0.92;
  }
  .chips {
    position: relative;
    z-index: 1;
    display: flex;
    gap: 2mm;
    margin-top: 4mm;
  }
  .chips span {
    padding: 1mm 2.6mm;
    border: 0.3mm solid rgba(255, 255, 255, 0.38);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.14);
    font-size: 6.4pt;
    font-weight: 800;
  }
  .columns {
    flex: 1;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 4mm;
    margin-top: 5mm;
    min-height: 0;
  }
  .column {
    display: flex;
    flex-direction: column;
    min-width: 0;
    border: 0.35mm solid #f2cfe2;
    border-radius: 3mm;
    background: #fff;
    overflow: hidden;
    break-inside: avoid;
  }
  .column.video { --cat: #e11d48; --soft: #ffe4e9; }
  .column.text { --cat: #0369a1; --soft: #dff6ff; }
  .column.image { --cat: #a21caf; --soft: #fbe8ff; }
  .column-head {
    display: flex;
    align-items: center;
    gap: 2mm;
    padding: 2.4mm 2.8mm;
    background: var(--soft);
    border-bottom: 0.35mm solid var(--cat);
  }
  .column-index {
    display: grid;
    place-items: center;
    width: 5.8mm;
    height: 5.8mm;
    border-radius: 50%;
    background: var(--cat);
    color: #fff;
    font-size: 7pt;
    font-weight: 900;
  }
  .column-copy {
    display: flex;
    flex-direction: column;
    line-height: 1.05;
  }
  .column-copy strong {
    color: var(--cat);
    font-size: 11pt;
    letter-spacing: -0.02em;
  }
  .column-copy span {
    color: #6b4e7a;
    font-size: 5.8pt;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .column-count {
    margin-left: auto;
    padding: 0.9mm 2mm;
    border-radius: 999px;
    background: #fff;
    color: var(--cat);
    font-size: 6pt;
    font-weight: 900;
  }
  .tools {
    display: flex;
    flex-direction: column;
    gap: 0;
    margin: 0;
    padding: 1mm 0;
    list-style: none;
  }
  .tool {
    display: flex;
    align-items: flex-start;
    gap: 1.8mm;
    padding: 1.85mm 2.4mm;
    border-bottom: 0.22mm solid #f6e3ee;
    break-inside: avoid;
  }
  .tool:last-child { border-bottom: 0; }
  .num {
    flex: 0 0 5mm;
    color: var(--cat);
    font-size: 5.7pt;
    font-weight: 900;
    font-variant-numeric: tabular-nums;
    padding-top: 0.5mm;
  }
  .tool-copy {
    display: flex;
    flex-direction: column;
    min-width: 0;
    line-height: 1.12;
  }
  .tool-copy a {
    color: #241033;
    font-size: 8.1pt;
    font-weight: 800;
    text-decoration: none;
    overflow-wrap: anywhere;
  }
  .tool-copy .tags {
    margin-top: 0.8mm;
    color: #6b4e7a;
    font-size: 6pt;
    font-weight: 600;
    line-height: 1.2;
  }
  .craft-note {
    margin-top: auto;
    padding: 2.6mm 2.8mm;
    border-top: 0.35mm solid var(--cat);
    background: var(--soft);
    color: #6b4e7a;
    font-size: 5.9pt;
    line-height: 1.3;
  }
  .craft-note strong {
    display: block;
    margin-bottom: 0.6mm;
    color: var(--cat);
    font-size: 5.9pt;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .foot {
    display: grid;
    grid-template-columns: 22mm 1fr auto;
    align-items: center;
    gap: 4mm;
    margin-top: 4mm;
    padding: 3mm 4mm;
    border-radius: 3mm;
    background: #fff7fb;
    border: 0.35mm solid #f2cfe2;
  }
  .foot img {
    display: block;
    width: 20mm;
    height: 20mm;
    padding: 1.2mm;
    border-radius: 1.5mm;
    background: #fff;
  }
  .foot strong { display: block; font-size: 8.2pt; }
  .foot p { margin: 0.8mm 0 0; color: #6b4e7a; font-size: 6.2pt; line-height: 1.3; }
  .foot a { color: #5b21b6; font-weight: 800; text-decoration: none; }
  .foot-right { text-align: right; }
  .foot-right p { max-width: 46mm; margin-left: auto; }
  .foot-right strong { color: #4d7c0f; }
  .screen-bar { display: none; }
  @media screen {
    body { background: #f4e9ff; padding: 18px; }
    .screen-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      max-width: 210mm;
      margin: 0 auto 12px;
    }
    .screen-bar a {
      display: inline-flex;
      align-items: center;
      min-height: 40px;
      padding: 8px 14px;
      border: 1px solid #d8b4fe;
      border-radius: 999px;
      background: #fff;
      color: #5b21b6;
      font-size: 0.8rem;
      font-weight: 800;
      text-decoration: none;
    }
    .screen-bar a:first-child {
      background: linear-gradient(110deg, #6d28d9, #be123c);
      color: #fff;
      border-color: transparent;
    }
    .page {
      height: auto;
      min-height: 0;
      margin: 0 auto;
      border-radius: 10px;
      box-shadow: 0 24px 60px rgba(36, 16, 51, 0.24);
    }
  }
  @media screen and (max-width: 900px) {
    body { padding: 8px; }
    .screen-bar { width: 100%; max-width: none; }
    .page { width: 100%; padding: 0; background: transparent; box-shadow: none; }
    .cover { padding: 24px 20px; border-radius: 12px; }
    h1 { font-size: 2.4rem; }
    .columns { grid-template-columns: 1fr; gap: 12px; }
    .column { border-radius: 12px; }
    .craft-note { margin-top: 10px; }
    .foot { grid-template-columns: 22mm 1fr; padding: 14px; }
    .foot-right { grid-column: 1 / -1; text-align: left; }
    .foot-right p { max-width: none; margin-left: 0; }
  }
</style>
</head>
<body>
<div class="screen-bar">
  <a href="assets/creative-field-guide.pdf" download="a-place-for-creation-field-guide.pdf" type="application/pdf">Download PDF</a>
  <a href="index.html">Back to the directory</a>
</div>
<div class="page">
  <header class="cover">
    <div class="kicker">Makom Liytzira · Creative Field Guide</div>
    <h1>A Place for <span>Creation</span></h1>
    <p>${total} free tools for video, text, and images — one page, three crafts, zero paid placement.</p>
    <div class="chips"><span>${total} tools</span><span>3 crafts</span><span>Curated ${monthLabel(generatedAt)}</span></div>
  </header>
  <main class="columns">${columns}</main>
  <footer class="foot">
    <img src="${qrData}" alt="QR code linking to nanapaknanapak-huemirit's repositories on GitHub">
    <div>
      <strong>Keep making.</strong>
      <p>Scan to open my repositories on GitHub, or tap any tool name to open it. Free tiers change often — check each service before relying on it.</p>
      <p><a href="${githubProfile}">github.com/nanapaknanapak-huemirit (repositories)</a></p>
    </div>
    <div class="foot-right">
      <strong>Free to start</strong>
      <p>An independent directory. No tool paid for placement. This is the original ${total}-tool starter snapshot; newer finds live on the website.</p>
    </div>
  </footer>
</div>
</body>
</html>`;
};

const pdfPageCount = (pdfPath) => {
  const output = execFileSync("pdfinfo", [pdfPath], { encoding: "utf8" });
  const match = output.match(/^Pages:\s+(\d+)/m);
  return match ? Number(match[1]) : null;
};

const guideToolsFromPayload = (payload) => {
  if (!payload || !Array.isArray(payload.tools)) throw new Error("tools.json must contain a tools array");
  const tools = payload.tools
    .filter((tool) => tool.guide)
    .map((tool) => ({
      category: tool.category,
      name: tool.name,
      href: tool.url,
      tags: Array.isArray(tool.tags) ? tool.tags : [],
    }));
  validateGuideTools(tools);
  return tools;
};

const buildGuide = async ({
  projectRoot = root,
  toolsPayload,
  guidePath = defaultGuidePath,
  pdfPath = defaultPdfPath,
  previewPath = defaultPreviewPath,
  qrPath = defaultQrPath,
  qrPngPath = defaultQrPngPath,
  now = new Date(),
  playwrightPath = findPlaywright(),
  chromePath = findChrome(),
  skipPdf = false,
  skipQr = false,
} = {}) => {
  const payload = toolsPayload || JSON.parse(fs.readFileSync(path.join(projectRoot, "data", "tools.json"), "utf8"));
  const tools = guideToolsFromPayload(payload);

  if (!skipQr) {
    const qr = validateQr(qrPngPath, githubProfile);
    if (!qr.ok) {
      throw new Error(`QR validation failed: expected ${githubProfile}, decoded ${qr.decoded || "nothing"}`);
    }
  }

  const qrData = `data:image/svg+xml;base64,${fs.readFileSync(qrPath).toString("base64")}`;
  const html = buildGuideHtml(tools, qrData, { generatedAt: now });
  fs.mkdirSync(path.dirname(guidePath), { recursive: true });
  fs.writeFileSync(guidePath, html, "utf8");

  if (skipPdf) {
    return { tools: tools.length, guideBytes: Buffer.byteLength(html), pdfBytes: null, previewBytes: null, pages: null };
  }

  if (!playwrightPath) throw new Error("Playwright is required to build the guide PDF");
  const playwright = require(playwrightPath);
  const launchOptions = chromePath ? { executablePath: chromePath } : {};
  const browser = await playwright.chromium.launch({ ...launchOptions, headless: true });

  try {
    const guidePage = await browser.newPage();
    await guidePage.setContent(html, { waitUntil: "load" });
    await guidePage.evaluate(() => document.fonts.ready);
    await guidePage.emulateMedia({ media: "print" });
    fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
    await guidePage.pdf({
      path: pdfPath,
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      tagged: true,
      outline: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
  } finally {
    await browser.close();
  }

  execFileSync("pdftoppm", ["-png", "-r", "120", "-singlefile", pdfPath, previewPath.replace(/\.png$/, "")], {
    stdio: "ignore",
  });

  const pages = pdfPageCount(pdfPath);
  if (pages !== 1) throw new Error(`Guide PDF must be one page, found ${pages}`);

  return {
    tools: tools.length,
    guideBytes: Buffer.byteLength(html),
    pdfBytes: fs.statSync(pdfPath).size,
    previewBytes: fs.statSync(previewPath).size,
    pages,
  };
};

if (require.main === module) {
  const payload = JSON.parse(fs.readFileSync(defaultToolsPath, "utf8"));
  buildGuide({
    toolsPayload: payload,
    skipPdf: process.argv.includes("--no-pdf"),
    skipQr: process.argv.includes("--no-qr"),
  }).then((result) => {
    console.log(JSON.stringify(result, null, 2));
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  buildGuide,
  buildGuideHtml,
  guideToolsFromPayload,
  validateGuideTools,
  pdfPageCount,
  githubProfile,
  defaultGuidePath,
  defaultPdfPath,
  defaultPreviewPath,
  defaultQrPath,
  defaultQrPngPath,
};

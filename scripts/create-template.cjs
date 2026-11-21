const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "index.html");
const outputPath = path.join(root, "src", "index.template.html");

const countReplacements = (html, from, to, expected = 1) => {
  const occurrences = html.split(from).length - 1;
  if (occurrences !== expected) {
    throw new Error(`Expected ${expected} occurrence(s) of ${JSON.stringify(from)}, found ${occurrences}`);
  }
  return html.split(from).join(to);
};

const replaceGrid = (html, category, placeholder) => {
  const sectionStart = html.indexOf(`<section class="category-section" id="${category}"`);
  if (sectionStart === -1) throw new Error(`Missing ${category} section`);

  const gridStart = html.indexOf('<div class="grid">', sectionStart);
  if (gridStart === -1) throw new Error(`Missing ${category} grid`);

  const contentStart = gridStart + '<div class="grid">'.length;
  const tagPattern = /<\/?div\b[^>]*>/g;
  tagPattern.lastIndex = contentStart;
  let depth = 1;
  let match;

  while ((match = tagPattern.exec(html))) {
    if (match[0].startsWith("</")) depth -= 1;
    else depth += 1;
    if (depth === 0) {
      const contentEnd = match.index;
      return `${html.slice(0, contentStart)}\n      ${placeholder}\n    ${html.slice(contentEnd)}`;
    }
  }

  throw new Error(`Could not find closing grid tag for ${category}`);
};

let html = fs.readFileSync(sourcePath, "utf8");

html = replaceGrid(html, "video", "{{TOOLS_VIDEO}}");
html = replaceGrid(html, "text", "{{TOOLS_TEXT}}");
html = replaceGrid(html, "images", "{{TOOLS_IMAGES}}");

html = countReplacements(
  html,
  '<meta property="og:description" content="A curated shelf of 48 free tools for video, writing, and imagery.">',
  '<meta property="og:description" content="A curated shelf of {{COUNT_TOTAL}} free tools for video, writing, and imagery.">',
);
html = countReplacements(html, "<strong>48</strong> tools", "<strong>{{COUNT_TOTAL}}</strong> tools");
html = countReplacements(html, "48 tools across 3 categories", "{{COUNT_TOTAL}} tools across 3 categories");
html = countReplacements(html, "<strong>48</strong> free tools", "<strong>{{COUNT_TOTAL}}</strong> free tools");
html = countReplacements(html, '<span class="cat-count">16 tools</span>', '<span class="cat-count">{{COUNT_VIDEO}} tools</span>');
html = countReplacements(html, '<span class="cat-count">15 tools</span>', '<span class="cat-count">{{COUNT_TEXT}} tools</span>');
html = countReplacements(html, '<span class="cat-count">17 tools</span>', '<span class="cat-count">{{COUNT_IMAGES}} tools</span>');
html = countReplacements(html, '<button class="filter active" type="button" data-filter="all" aria-pressed="true">All<span>48</span></button>', '<button class="filter active" type="button" data-filter="all" aria-pressed="true">All<span>{{COUNT_TOTAL}}</span></button>');
html = countReplacements(html, '<button class="filter" type="button" data-filter="video" aria-pressed="false">Video<span>16</span></button>', '<button class="filter" type="button" data-filter="video" aria-pressed="false">Video<span>{{COUNT_VIDEO}}</span></button>');
html = countReplacements(html, '<button class="filter" type="button" data-filter="text" aria-pressed="false">Text<span>15</span></button>', '<button class="filter" type="button" data-filter="text" aria-pressed="false">Text<span>{{COUNT_TEXT}}</span></button>');
html = countReplacements(html, '<button class="filter" type="button" data-filter="images" aria-pressed="false">Images<span>17</span></button>', '<button class="filter" type="button" data-filter="images" aria-pressed="false">Images<span>{{COUNT_IMAGES}}</span></button>');
html = countReplacements(html, "Showing all 48 tools", "Showing all {{COUNT_TOTAL}} tools");
html = countReplacements(html, "All 48 tools are listed below.", "All {{COUNT_TOTAL}} tools are listed below.");
html = countReplacements(html, '<span class="section-count">16 tools</span>', '<span class="section-count">{{COUNT_VIDEO}} tools</span>');
html = countReplacements(html, '<span class="section-count">15 tools</span>', '<span class="section-count">{{COUNT_TEXT}} tools</span>');
html = countReplacements(html, '<span class="section-count">17 tools</span>', '<span class="section-count">{{COUNT_IMAGES}} tools</span>');
html = countReplacements(html, "48 tools in three color-coded sections", "{{GUIDE_COUNT}} tools in three color-coded sections");
html = countReplacements(html, "showing 48 tools in three color-coded columns", "showing {{GUIDE_COUNT}} tools in three color-coded columns");
html = countReplacements(html, "Links checked 19 Nov 2026", "Links checked {{LAST_UPDATED}}");

html = html.replace(
  '<meta name="theme-color" content="#140b1e" media="(prefers-color-scheme: dark)">',
  '<meta name="theme-color" content="#140b1e" media="(prefers-color-scheme: dark)">\n<meta name="tools-updated" content="{{UPDATED_ISO}}">',
);

fs.writeFileSync(outputPath, html, "utf8");
console.log(JSON.stringify({
  outputPath,
  bytes: Buffer.byteLength(html),
  placeholders: Array.from(new Set(html.match(/\{\{[A-Z_]+\}\}/g) || [])),
}, null, 2));

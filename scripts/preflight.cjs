const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");

const playwrightCandidates = [
  process.env.PLAYWRIGHT_PATH,
  "playwright",
  "/var/home/mirit/.npm/_npx/bbb8a2c4738e2b0c/node_modules/playwright",
].filter(Boolean);

const chromeCandidates = [
  process.env.CHROME_PATH,
  "/var/home/mirit/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
  "/var/home/mirit/.cache/ms-playwright/chromium-1148/chrome-linux/chrome",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].filter(Boolean);

const findPlaywright = () => {
  for (const candidate of playwrightCandidates) {
    try {
      return require.resolve(candidate);
    } catch (error) {
      continue;
    }
  }
  return null;
};

const findChrome = () => chromeCandidates.find((candidate) => fs.existsSync(candidate)) || null;

const commandExists = (command) => {
  try {
    execFileSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" });
    return true;
  } catch (error) {
    return false;
  }
};

const pythonModuleExists = (moduleName) => {
  try {
    execFileSync("python3", ["-c", `import ${moduleName}`], { stdio: "ignore" });
    return true;
  } catch (error) {
    return false;
  }
};

const runPreflight = ({ requireBrowser = true } = {}) => {
  const checks = [];
  const major = Number(process.versions.node.split(".")[0]);

  checks.push({ name: "node", ok: major >= 18, detail: process.versions.node });
  checks.push({ name: "root", ok: fs.existsSync(root), detail: root });
  checks.push({ name: "tools-data", ok: fs.existsSync(path.join(root, "data", "tools.json")), detail: "data/tools.json" });
  checks.push({ name: "template", ok: fs.existsSync(path.join(root, "src", "index.template.html")), detail: "src/index.template.html" });
  checks.push({ name: "pdftoppm", ok: commandExists("pdftoppm"), detail: "pdftoppm" });
  checks.push({ name: "pdfinfo", ok: commandExists("pdfinfo"), detail: "pdfinfo" });
  const qrDecoder = commandExists("zbarimg")
    ? "zbarimg"
    : pythonModuleExists("pyzbar")
      ? "pyzbar"
      : pythonModuleExists("cv2")
        ? "opencv"
        : null;
  checks.push({ name: "qr-decoder", ok: true, detail: qrDecoder || "optional: none found, structural check only" });

  if (requireBrowser) {
    const playwrightPath = findPlaywright();
    const chromePath = findChrome();
    checks.push({ name: "playwright", ok: Boolean(playwrightPath), detail: playwrightPath || "not found" });
    checks.push({ name: "chromium", ok: Boolean(chromePath), detail: chromePath || "not found" });
  }

  return {
    ok: checks.every((check) => check.ok),
    checks,
    playwrightPath: findPlaywright(),
    chromePath: findChrome(),
  };
};

if (require.main === module) {
  const result = runPreflight({ requireBrowser: !process.argv.includes("--no-browser") });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

module.exports = { runPreflight, findPlaywright, findChrome };

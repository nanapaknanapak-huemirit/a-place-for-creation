const fs = require("fs");
const { execFileSync } = require("child_process");

const run = (command, args) => {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    return null;
  }
};

const commandExists = (command) => {
  try {
    execFileSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" });
    return true;
  } catch (error) {
    return false;
  }
};

const decodeQrPng = (pngPath) => {
  if (!fs.existsSync(pngPath)) return { decoded: null, decoder: null };

  if (commandExists("zbarimg")) {
    const output = run("zbarimg", ["--quiet", "--raw", pngPath]);
    return { decoded: output || null, decoder: "zbarimg" };
  }

  const pyzbarScript = [
    "import sys",
    "from PIL import Image",
    "from pyzbar.pyzbar import decode",
    "results = decode(Image.open(sys.argv[1]))",
    "print(results[0].data.decode('utf-8') if results else '')",
  ].join("\n");
  const pyzbar = run("python3", ["-c", pyzbarScript, pngPath]);
  if (pyzbar !== null) return { decoded: pyzbar || null, decoder: "pyzbar" };

  const cv2Script = [
    "import sys",
    "import cv2",
    "image = cv2.imread(sys.argv[1])",
    "data, _, _ = cv2.QRCodeDetector().detectAndDecode(image)",
    "print(data or '')",
  ].join("\n");
  const cv2 = run("python3", ["-c", cv2Script, pngPath]);
  if (cv2 !== null) return { decoded: cv2 || null, decoder: "opencv" };

  return { decoded: null, decoder: null };
};

const validateQr = (pngPath, expectedUrl) => {
  const { decoded, decoder } = decodeQrPng(pngPath);
  const exists = fs.existsSync(pngPath) && fs.statSync(pngPath).size > 0;
  if (!decoder) {
    return {
      ok: exists,
      decoded: null,
      expectedUrl,
      available: false,
      skipped: true,
      warning: exists
        ? "No QR decoder found (zbarimg, pyzbar, or OpenCV); validated file presence only."
        : `Missing QR image: ${pngPath}`,
    };
  }
  return {
    ok: Boolean(decoded) && decoded.replace(/\/$/, "") === expectedUrl.replace(/\/$/, ""),
    decoded,
    expectedUrl,
    available: true,
    skipped: false,
    decoder,
  };
};

module.exports = { decodeQrPng, validateQr };

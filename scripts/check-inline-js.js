const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const htmlPath = path.join(__dirname, "..", "public", "index.html");
const html = fs.readFileSync(htmlPath, "utf8");
const scripts = [];
const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
let match;

while ((match = pattern.exec(html)) !== null) {
  if (/\bsrc\s*=/.test(match[1])) continue;
  if (match[2].trim()) scripts.push(match[2]);
}

if (scripts.length === 0) {
  console.error("No inline JavaScript found in public/index.html");
  process.exit(1);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "style-story-js-"));
const tempFile = path.join(tempDir, "inline.js");
try {
  fs.writeFileSync(tempFile, scripts.join("\n;\n"), "utf8");
  const result = spawnSync(process.execPath, ["--check", tempFile], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

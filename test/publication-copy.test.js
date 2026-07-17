const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC_EXTENSIONS = new Set([".html", ".md", ".txt", ".xml"]);
const SKIP_DIRECTORIES = new Set([".git", "node_modules"]);

function publicFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) return [];
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return publicFiles(fullPath);
    return PUBLIC_EXTENSIONS.has(path.extname(entry.name)) ? [fullPath] : [];
  });
}

test("published copy follows the canonical link and punctuation rules", () => {
  const violations = [];

  for (const file of publicFiles(ROOT)) {
    const copy = fs.readFileSync(file, "utf8");
    if (copy.includes("\u2014")) violations.push(`${path.relative(ROOT, file)} contains an em dash`);
    if (copy.includes("ebeirne/Lians2")) violations.push(`${path.relative(ROOT, file)} links to the retired fork`);
  }

  assert.deepEqual(violations, []);
});

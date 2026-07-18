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

test("high-intent marketing pages expose canonical and social metadata", () => {
  assert.ok(fs.statSync(path.join(ROOT, "og-card.png")).size > 0, "Open Graph image must exist");
  const pages = [
    "index.html",
    "product.html",
    "compare.html",
    "research.html",
    "pricing.html",
    "design-partners.html",
    "docs.html",
    "solutions-financial-services.html",
    "about.html",
  ];

  for (const page of pages) {
    const copy = fs.readFileSync(path.join(ROOT, page), "utf8");
    assert.match(copy, /rel="canonical" href="https:\/\/www\.lians\.ai\//, `${page} needs a canonical URL`);
    assert.match(copy, /property="og:title"/, `${page} needs an Open Graph title`);
    assert.match(copy, /property="og:description"/, `${page} needs an Open Graph description`);
    assert.match(copy, /property="og:image"/, `${page} needs an Open Graph image`);
  }
});

test("competitive comparison pages expose structured metadata and a public right of reply", () => {
  const pages = ["compare-mem0.html", "compare-zep.html"];
  for (const page of pages) {
    const copy = fs.readFileSync(path.join(ROOT, page), "utf8");
    assert.match(copy, /application\/ld\+json/, `${page} needs structured metadata`);
    assert.match(copy, /public right of reply/i, `${page} needs a public right of reply`);
    assert.match(copy, /public fact-check request/i, `${page} needs a public correction channel`);
  }
});

test("LOCOMO benchmark article exposes article and dataset metadata", () => {
  const copy = fs.readFileSync(path.join(ROOT, "blog-locomo-benchmark.html"), "utf8");
  assert.match(copy, /application\/ld\+json/);
  assert.match(copy, /"@type": "BlogPosting"/);
  assert.match(copy, /"@type": "Dataset"/);
  assert.match(copy, /"measurementTechnique"/);
});

test("published pages do not link to disabled repository discussions", () => {
  const pages = fs.readdirSync(ROOT).filter((file) => file.endsWith(".html"));
  for (const page of pages) {
    const copy = fs.readFileSync(path.join(ROOT, page), "utf8");
    assert.doesNotMatch(copy, /github\.com\/Lians-ai\/Lians\/discussions/, `${page} links to disabled Discussions`);
  }
});

test("cohort capacity is labeled as openings, not implied traction", () => {
  const copy = ["index.html", "design-partners.html", "about.html"]
    .map((file) => fs.readFileSync(path.join(ROOT, file), "utf8"))
    .join("\n");

  assert.doesNotMatch(copy, /Seven companies|Three implementation partners|Four evaluation partners|Most popular/);
});

test("every sitemap page has a canonical URL and social image", () => {
  const sitemap = fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8");
  const urls = [...sitemap.matchAll(/<loc>https:\/\/www\.lians\.ai([^<]*)<\/loc>/g)].map((match) => match[1] || "/");

  for (const route of urls) {
    const file = route === "/" ? "index.html" : `${route.slice(1).replaceAll("/", "-")}.html`;
    const copy = fs.readFileSync(path.join(ROOT, file), "utf8");
    const canonical = route === "/" ? "https://www.lians.ai/" : `https://www.lians.ai${route}`;
    assert.ok(copy.includes(`rel="canonical" href="${canonical}"`), `${file} needs its canonical URL`);
    assert.match(copy, /property="og:image" content="https:\/\/www\.lians\.ai\/og-card\.png"/, `${file} needs the social card`);
  }
});

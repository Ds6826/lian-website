const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

const ACTIVE_PUBLIC_COPY = [
  "marketing.html",
  "marketing.js",
  "privacy.html",
  "terms.html",
  "llms.txt",
  "sitemap.xml",
  "EXPERIENCE-LEARNING.md",
];

test("active published copy follows canonical link and punctuation rules", () => {
  const violations = [];

  for (const file of ACTIVE_PUBLIC_COPY) {
    const copy = read(file);
    if (copy.includes("\u2014")) violations.push(`${file} contains an em dash`);
    if (copy.includes("ebeirne/Lians2")) violations.push(`${file} links to the retired fork`);
    if (copy.includes("github.com/Lians-ai/Lians/discussions")) {
      violations.push(`${file} links to disabled Discussions`);
    }
  }

  assert.deepEqual(violations, []);
});

test("the marketing shell exposes social metadata and one mutable canonical link", () => {
  const shell = read("marketing.html");
  const client = read("marketing.js");

  assert.match(shell, /rel="canonical" href="https:\/\/www\.lians\.ai\/"/);
  assert.match(shell, /property="og:title"/);
  assert.match(shell, /property="og:description"/);
  assert.match(shell, /property="og:url" content="https:\/\/www\.lians\.ai\/"/);
  assert.match(shell, /property="og:image" content="https:\/\/www\.lians\.ai\/og-card\.png"/);

  assert.match(client, /meta\[property="og:title"\]/);
  assert.match(client, /meta\[property="og:description"\]/);
  assert.match(client, /meta\[property="og:url"\]/);
  assert.match(client, /link\[rel="canonical"\]/);
  assert.match(client, /canonical\.href=`https:\/\/www\.lians\.ai\$\{path\}`/);
});

test("every sitemap route has a client-rendered page or a dedicated legal document", () => {
  const sitemap = read("sitemap.xml");
  const client = read("marketing.js");
  const routes = [...sitemap.matchAll(/<loc>https:\/\/www\.lians\.ai([^<]*)<\/loc>/g)]
    .map((match) => match[1] || "/");

  assert.ok(routes.length >= 10, "expected the public sitemap to contain the core site");
  for (const route of routes) {
    if (route === "/privacy" || route === "/terms") {
      assert.ok(
        read(`${route.slice(1)}.html`).includes(`rel="canonical" href="https://www.lians.ai${route}"`),
        `${route} needs its dedicated canonical URL`,
      );
      continue;
    }
    assert.ok(
      client.includes(`"${route}":{`) || client.includes(`"${route}":"/`),
      `${route} needs a page or canonical alias in marketing.js`,
    );
  }
});

test("benchmark copy distinguishes evidence retrieval from answer accuracy", () => {
  const client = read("marketing.js");

  assert.match(client, /97\.53%/);
  assert.match(client, /This is not 97\.53% answer accuracy\./);
  assert.match(client, /Gold evidence IDs and reference answers enter after retrieval solely to calculate the score\./);
  assert.match(client, /Inspect benchmark source/);
});

test("Free-tier copy makes token reduction explicit", () => {
  const marketing = read("marketing.js");
  const consoleApp = read("app.js");

  assert.match(marketing, /Remember more\. Send fewer tokens\./);
  assert.match(marketing, /Token-reduced context for your model/);
  assert.match(marketing, /Token reduction is included in Free\./);
  assert.match(consoleApp, /Token-reduced context for your model/);
});

test("public copy does not imply vendor endorsement or a closed cohort", () => {
  const copy = `${read("marketing.html")}\n${read("marketing.js")}`;

  assert.match(copy, /Grafana Labs has not reviewed or signed off/);
  assert.doesNotMatch(copy, /Seven companies|Three implementation partners|Four evaluation partners|Most popular/);
});

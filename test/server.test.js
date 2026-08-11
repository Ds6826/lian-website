const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

// Boot the real server on an ephemeral port. No Clerk session is provided, so
// every authed API must reject; static/marketing routes must serve.
process.env.DATA_DIR = require('node:path').join(require('node:os').tmpdir(), `lians-web-test-${process.pid}`);
const app = require('../server');

let server; let origin;
before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));

const get = (path, headers = {}) => fetch(`${origin}${path}`, { headers, redirect: 'manual' });
const post = (path, body, headers = {}) => fetch(`${origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body || {}), redirect: 'manual' });
const postRaw = (path, body, headers = {}) => fetch(`${origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body, redirect: 'manual', signal: AbortSignal.timeout(2_000) });

test('GET /api/health reports ok', async () => {
  const res = await get('/api/health');
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
});

test('GET /api/health renders a human status page for browser navigation', async () => {
  const page = await get('/api/health', { accept: 'text/html' });
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type') || '', /text\/html/);
  assert.match(await page.text(), /The evidence layer is online/);

  const raw = await get('/api/health?format=json', { accept: 'text/html' });
  assert.equal(raw.status, 200);
  assert.match(raw.headers.get('content-type') || '', /application\/json/);
  assert.equal((await raw.json()).ok, true);
});

test('console data routes require authentication', async () => {
  for (const [path, method] of [
    ['/api/console/governance', 'GET'],
    ['/api/console/supersessions/some-id', 'POST'],
    ['/api/console/admissions/some-id', 'POST'],
    ['/api/console/playground/write', 'POST'],
    ['/api/console/playground/recall', 'POST'],
    ['/api/console/experiences', 'GET'],
    ['/api/console/experiences', 'POST'],
    ['/api/console/experiences/some-id/outcome', 'PATCH'],
    ['/api/console/adaptive-recall', 'POST'],
    ['/api/console/context', 'POST'],
    ['/api/console/reflections', 'GET'],
    ['/api/console/reflections/generate', 'POST'],
    ['/api/console/reflections/some-id', 'PATCH'],
    ['/api/onboarding', 'GET'],
    ['/api/onboarding/skip', 'POST'],
    ['/api/onboarding/complete', 'POST'],
    ['/api/billing/select', 'POST'],
    ['/api/billing/sync', 'POST'],
    ['/api/keys', 'GET'],
    ['/api/projects', 'GET'],
  ]) {
    const res = method === 'GET' ? await get(path) : await post(path, {});
    assert.equal(res.status, 401, `${method} ${path} must 401 without a session`);
  }
});

test('legacy demo recall requires authentication too', async () => {
  const res = await post('/api/demo/recall');
  assert.equal(res.status, 401);
});

test('partner applications validate before checking production integrations', async () => {
  const invalid = await post('/api/partner-applications', { company: 'Incomplete' });
  assert.equal(invalid.status, 400);
  const data = await invalid.json();
  assert.match(data.error, /required field/i);
});

test('oversized request bodies fail deterministically without hanging the worker', async () => {
  const res = await postRaw('/api/partner-applications', JSON.stringify({ padding: 'x'.repeat(321 * 1024) }));
  assert.equal(res.status, 413);
  assert.match((await res.json()).error, /too large/i);
});

test('partner application honeypot does not store data or send mail', async () => {
  const res = await post('/api/partner-applications', { website: 'https://bot.example' });
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { ok: true });
});

test('cross-origin API requests are blocked', async () => {
  const res = await get('/api/health', { origin: 'https://evil.example' });
  assert.equal(res.status, 403);
});

test('canonical marketing pages serve', async () => {
  for (const path of [
    '/',
    '/product',
    '/docs',
    '/pricing',
    '/design-partners',
    '/security',
    '/status',
    '/blog',
    '/blog/locomo-benchmark',
  ]) {
    const res = await get(path);
    assert.equal(res.status, 200, `${path} should serve`);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    const html = await res.text();
    assert.match(html, /Lians/);
  }
});

test('legal contact buttons keep their intended email destinations', async () => {
  for (const [path, email] of [
    ['/privacy', 'privacy@lians.ai'],
    ['/terms', 'legal@lians.ai'],
  ]) {
    const res = await get(path);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, new RegExp(`href="mailto:${email.replace('.', '\\.')}"`));
    assert.match(html, /lians\.js\?v=20260728-button-routes/);
  }

  const script = await (await get('/lians.js')).text();
  assert.doesNotMatch(script, /\.band \.btn/, 'generic band buttons must not be rewritten');
  assert.match(script, /a\.btn\[href="\/design-partners"\]/);
});

test('public pricing actions lead to the authenticated checkout flow', async () => {
  const script = await (await get('/marketing.js')).text();
  for (const label of ['Get started', 'Choose Starter', 'Choose Growth', 'Choose Pro']) {
    assert.match(script, new RegExp(`href="/upgrade">${label}`));
  }
  assert.doesNotMatch(script, /href="\/login">Choose (Starter|Growth|Pro)/);
});

test('every internal marketing link resolves to an intended page', async () => {
  const script = await (await get('/marketing.js')).text();
  const paths = new Set(
    [...script.matchAll(/href="(\/[^"#?]*)[^"]*"/g)].map((match) => match[1]),
  );
  assert.ok(paths.size >= 10, 'expected a meaningful set of internal destinations');
  for (const path of paths) {
    const res = await get(path);
    assert.ok(
      res.status >= 200 && res.status < 400,
      `${path} returned ${res.status}`,
    );
  }
});

test('public positioning leads with historical reconstruction without unsupported partner claims', async () => {
  const [html, script] = await Promise.all([
    get('/').then((res) => res.text()),
    get('/marketing.js').then((res) => res.text()),
  ]);
  assert.match(html, /Historical reconstruction for consequential AI/);
  assert.match(script, /Prove what your AI knew when it acted/);
  assert.match(script, /Observability shows what ran\. Lians reconstructs what was knowable/);
  assert.match(script, /Grafana Labs has not reviewed or signed off/);
  assert.doesNotMatch(script, /—/);
});

test('retired marketing routes redirect to a current canonical page', async () => {
  const redirects = new Map([
    ['/memory-governor', '/product'],
    ['/sdks', '/docs'],
    ['/trust', '/security'],
    ['/compare/mem0', '/blog/locomo-benchmark'],
    ['/blog/eu-ai-act-article-12', '/blog'],
  ]);
  for (const [path, destination] of redirects) {
    const res = await get(path);
    assert.equal(res.status, 308, `${path} should redirect`);
    assert.equal(res.headers.get('location'), destination);
  }
});

test('.html routes redirect to their pretty URL', async () => {
  const res = await get('/memory-governor.html');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/memory-governor');
});

test('console shell serves for /console routes', async () => {
  const res = await get('/console/governance');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Lians Console/);
});

test('console shell includes section navigation without a stale governance badge', async () => {
  const res = await get('/console');
  const html = await res.text();
  assert.match(html, /id="view-previous"/);
  assert.match(html, /id="view-next"/);
  assert.match(html, /data-auth-provider="google"/);
  assert.match(html, /data-auth-provider="github"/);
  assert.doesNotMatch(html, /nav-pill">NEW/);
});

test('Clerk loader starts from the server-pinned script URL', () => {
  const loader = fs.readFileSync(path.join(__dirname, '..', 'clerk-loader.js'), 'utf8');
  assert.match(loader, /script\.src = config\.clerkJsUrl/);
  assert.doesNotMatch(loader, /clerkScriptUrls|clerkJsUrls|\[index\]/);
});

test('console profile avatar uses the authenticated Clerk image with an initials fallback', () => {
  const client = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(client, /clerkUser\?\.imageUrl \|\| user\.avatarUrl/);
  assert.match(client, /renderAuthenticatedProfile\(sessionData\.user\)/);
  assert.match(client, /button\.classList\.add\('has-image'\)/);
});

test('console controls use CSP-safe navigation and expose working detail actions', () => {
  const client = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '..', 'app.css'), 'utf8');
  assert.doesNotMatch(client, /onclick=/, 'inline event handlers are blocked by the production CSP');
  assert.match(client, /<a class="console-button" href="\/billing">/);
  assert.match(client, /<a class="console-button" href="\/upgrade"/);
  assert.match(client, /data-agent-detail=/);
  assert.match(client, /data-space-detail=/);
  assert.match(client, /copyTextToClipboard/);
  assert.match(client, /document\.execCommand\('copy'\)/);
  assert.doesNotMatch(styles, /\.nav-item\.locked[^}]*pointer-events\s*:\s*none/);
});

test('completed users can open the billing route instead of being redirected to the console', () => {
  const client = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(client, /if \(route === '\/billing'\) \{\s*if \(!complete\) \{ window\.location\.assign\(destination\); return; \}\s*setBillingPage\(\);/);
  assert.doesNotMatch(client, /if \(route === '\/billing'\) \{\s*if \(destination !== '\/billing'\)/);
});

test('config.js exposes only publishable configuration', async () => {
  const res = await get('/config.js');
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /window\.__lian_config=/);
  assert.doesNotMatch(body, /sk_(live|test)/, 'must never leak a secret key');
  assert.doesNotMatch(body, /@latest/, 'authentication dependencies must be pinned');
  assert.match(body, /clerkJsIntegrity/);
  assert.match(body, /clerkUiIntegrity/);
});

test('security headers are set on every response', async () => {
  const res = await get('/');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const csp = res.headers.get('content-security-policy') || '';
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /img-src 'self' data: https:\/\/img\.clerk\.com/);
  assert.doesNotMatch(csp, /style-src 'self' 'unsafe-inline'/);
});

test('external browser scripts are version-pinned and integrity-checked', () => {
  const shell = fs.readFileSync(path.join(__dirname, '..', 'app.html'), 'utf8');
  const sentry = shell.match(/<script[^>]+browser\.sentry-cdn\.com[^>]+>/)?.[0] || '';
  assert.match(sentry, /\/8\.55\.2\/bundle\.min\.js/);
  assert.match(sentry, /integrity="sha384-[A-Za-z0-9+/=]+"/);
  assert.match(sentry, /crossorigin="anonymous"/);
});

test('only explicitly public files can be served from the repository root', async () => {
  for (const path of ['/server.js', '/package.json', '/api/server.js', '/data/lian-console.json', '/.env', '/test/server.test.js']) {
    const res = await get(path);
    assert.equal(res.status, 404, `${path} must not be public`);
  }
  for (const path of ['/marketing.css', '/logo-blue.png', '/.well-known/security.txt']) {
    const res = await get(path);
    assert.equal(res.status, 200, `${path} should remain public`);
  }
});

test('static assets reject state-changing methods', async () => {
  const res = await post('/marketing.css', {});
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'GET, HEAD');
});

test('distributed rate limiting accepts Vercel KV environment aliases', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(serverSource, /process\.env\.KV_REST_API_URL \|\| process\.env\.UPSTASH_REDIS_REST_URL/);
  assert.match(serverSource, /process\.env\.KV_REST_API_TOKEN \|\| process\.env\.UPSTASH_REDIS_REST_TOKEN/);
});

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

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

test('config.js exposes only publishable configuration', async () => {
  const res = await get('/config.js');
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /window\.__lian_config=/);
  assert.doesNotMatch(body, /sk_(live|test)/, 'must never leak a secret key');
});

test('security headers are set on every response', async () => {
  const res = await get('/');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('content-security-policy') || '', /default-src 'self'/);
});

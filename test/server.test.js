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

test('console data routes require authentication', async () => {
  for (const [path, method] of [
    ['/api/console/governance', 'GET'],
    ['/api/console/supersessions/some-id', 'POST'],
    ['/api/console/admissions/some-id', 'POST'],
    ['/api/console/playground/write', 'POST'],
    ['/api/console/playground/recall', 'POST'],
  ]) {
    const res = method === 'GET' ? await get(path) : await post(path, {});
    assert.equal(res.status, 401, `${method} ${path} must 401 without a session`);
  }
});

test('legacy demo recall requires authentication too', async () => {
  const res = await post('/api/demo/recall');
  assert.equal(res.status, 401);
});

test('cross-origin API requests are blocked', async () => {
  const res = await get('/api/health', { origin: 'https://evil.example' });
  assert.equal(res.status, 403);
});

test('marketing pages serve, including the Memory Governor page', async () => {
  for (const path of ['/', '/memory-governor', '/product', '/docs', '/pricing']) {
    const res = await get(path);
    assert.equal(res.status, 200, `${path} should serve`);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    const html = await res.text();
    assert.match(html, /Lians/);
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

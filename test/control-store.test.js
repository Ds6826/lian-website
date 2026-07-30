const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createControlStore } = require('../control-store');

test('local control store persists and restores normalized state', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lians-control-store-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const first = createControlStore({ dataDir: directory });
  first.write({
    users: [{ id: 'user-1' }],
    onboarding: { 'user-1': { company: 'Lians' } },
  });
  await first.flush();

  const second = createControlStore({ dataDir: directory });
  await second.hydrate();
  const restored = second.read();

  assert.equal(restored.users[0].id, 'user-1');
  assert.equal(restored.onboarding['user-1'].company, 'Lians');
  assert.deepEqual(restored.projects, {});
  assert.deepEqual(restored.apiKeys, []);
  assert.deepEqual(second.status(), { mode: 'local-file', durable: true });
});

test('Vercel fallback identifies itself as non-durable without Redis', () => {
  const directory = path.join(os.tmpdir(), 'lians-control-store-vercel-test');
  const store = createControlStore({
    dataDir: directory,
    vercel: true,
    redisUrl: '',
    redisToken: '',
  });
  assert.deepEqual(store.status(), {
    mode: 'ephemeral-fallback',
    durable: false,
  });
});

test('Vercel KV environment aliases enable the durable Upstash control store', (t) => {
  const previousUrl = process.env.KV_REST_API_URL;
  const previousToken = process.env.KV_REST_API_TOKEN;
  const previousUpstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const previousUpstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  t.after(() => {
    if (previousUrl === undefined) delete process.env.KV_REST_API_URL;
    else process.env.KV_REST_API_URL = previousUrl;
    if (previousToken === undefined) delete process.env.KV_REST_API_TOKEN;
    else process.env.KV_REST_API_TOKEN = previousToken;
    if (previousUpstashUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = previousUpstashUrl;
    if (previousUpstashToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = previousUpstashToken;
  });
  process.env.KV_REST_API_URL = 'https://example-kv.upstash.io';
  process.env.KV_REST_API_TOKEN = 'test-token';
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;

  const store = createControlStore({
    dataDir: path.join(os.tmpdir(), 'lians-control-store-kv-alias-test'),
    vercel: true,
  });

  assert.deepEqual(store.status(), {
    mode: 'upstash',
    durable: true,
  });
});

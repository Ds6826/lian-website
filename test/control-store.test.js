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

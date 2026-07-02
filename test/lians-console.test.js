const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLiansConsole, CONSOLE_KEY_LABEL, CONSOLE_KEY_SCOPES, PLAYGROUND_AGENT } = require('../lians-console');

const USER = { id: 'u-1', clerkUserId: 'clerk-u-1' };

// Fake Clerk users API with in-memory private metadata.
const fakeClerk = (initialMetadata = {}) => {
  const state = { metadata: { ...initialMetadata }, updates: 0 };
  return {
    state,
    users: {
      getUser: async () => ({ privateMetadata: { ...state.metadata } }),
      updateUserMetadata: async (_id, { privateMetadata }) => { state.metadata = { ...privateMetadata }; state.updates++; },
    },
  };
};

// Scriptable fetch: routes[method + ' ' + path] = (body) => ({ status, body }).
const fakeFetch = (routes) => {
  const calls = [];
  const impl = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const path = url.replace('https://backend.test', '');
    const key = `${method} ${path}`;
    calls.push({ key, headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null });
    const route = routes[key];
    if (!route) return { ok: false, status: 404, text: async () => JSON.stringify({ detail: `no route ${key}` }) };
    const { status = 200, body = {} } = typeof route === 'function' ? route(opts) : route;
    return { ok: status < 400, status, text: async () => JSON.stringify(body) };
  };
  impl.calls = calls;
  return impl;
};

const build = ({ routes = {}, metadata = {}, apiUrl = 'https://backend.test', adminSecret = 'admin-secret' } = {}) => {
  const clerk = fakeClerk(metadata);
  const fetchImpl = fakeFetch(routes);
  const client = createLiansConsole({ apiUrl, adminSecret, clerk, fetchImpl });
  return { client, clerk, fetchImpl };
};

const MINT_ROUTE = { 'POST /v1/admin/api-keys': { body: { id: 'key-id-1', key: 'agentmem_secret_1' } } };

test('configured() is false until both url and secret are set', () => {
  assert.equal(build({ apiUrl: '', adminSecret: '' }).client.configured(), false);
  assert.equal(build({ apiUrl: 'https://backend.test', adminSecret: '' }).client.configured(), false);
  assert.equal(build().client.configured(), true);
});

test('consoleKeyFor mints once with the internal label/scopes and stores the secret in Clerk', async () => {
  const { client, clerk, fetchImpl } = build({ routes: MINT_ROUTE });
  const key = await client.consoleKeyFor(USER);
  assert.equal(key, 'agentmem_secret_1');
  const mint = fetchImpl.calls.find((c) => c.key === 'POST /v1/admin/api-keys');
  assert.equal(mint.headers['X-Admin-Secret'], 'admin-secret');
  assert.deepEqual(mint.body, { namespace: 'ns_u-1', scopes: CONSOLE_KEY_SCOPES, label: CONSOLE_KEY_LABEL });
  assert.equal(clerk.state.metadata.liansConsoleKey, 'agentmem_secret_1');
  // Second call is served from the in-process cache — no new admin calls.
  const before = fetchImpl.calls.length;
  assert.equal(await client.consoleKeyFor(USER), 'agentmem_secret_1');
  assert.equal(fetchImpl.calls.length, before);
});

test('consoleKeyFor reuses a key already stored in Clerk metadata', async () => {
  const { client, fetchImpl } = build({ metadata: { liansConsoleKey: 'agentmem_existing' } });
  assert.equal(await client.consoleKeyFor(USER), 'agentmem_existing');
  assert.equal(fetchImpl.calls.length, 0);
});

test('dataRequest sends X-API-Key and re-mints once on a 401', async () => {
  let recallCalls = 0;
  const { client, fetchImpl } = build({
    metadata: { liansConsoleKey: 'agentmem_stale' },
    routes: {
      ...MINT_ROUTE,
      'POST /v1/recall': (opts) => {
        recallCalls++;
        const headers = JSON.parse(JSON.stringify(opts.headers));
        if (headers['X-API-Key'] === 'agentmem_stale') return { status: 401, body: { detail: 'revoked' } };
        return { body: { memories: [], as_of: null, total_candidates: 0 } };
      },
    },
  });
  const result = await client.playgroundRecall(USER, 'NVDA guidance');
  assert.equal(recallCalls, 2);
  assert.deepEqual(result.memories, []);
  assert.ok(fetchImpl.calls.some((c) => c.key === 'POST /v1/admin/api-keys'), 'expected a re-mint after 401');
});

test('governance aggregates both review queues', async () => {
  const { client } = build({
    metadata: { liansConsoleKey: 'agentmem_ok' },
    routes: {
      'GET /v1/supersessions/review?limit=50': { body: { items: [{ memory_id: 'm1', relation: 'REFINES', confidence: 0.6 }], total: 1, confidence_threshold: 0.75 } },
      'GET /v1/admissions?status=pending&limit=50': { body: { pending: [{ id: 'p1', reasons: ['pii'] }], total: 1 } },
    },
  });
  const result = await client.governance(USER);
  assert.equal(result.configured, true);
  assert.equal(result.supersessions.total, 1);
  assert.equal(result.supersessions.items[0].relation, 'REFINES');
  assert.equal(result.supersessions.threshold, 0.75);
  assert.equal(result.admissions.total, 1);
  assert.equal(result.admissions.available, true);
});

test('governance survives a 403 on admissions (key without admin scope)', async () => {
  const { client } = build({
    metadata: { liansConsoleKey: 'agentmem_ok' },
    routes: {
      'GET /v1/supersessions/review?limit=50': { body: { items: [], total: 0, confidence_threshold: 0.75 } },
      'GET /v1/admissions?status=pending&limit=50': { status: 403, body: { detail: 'missing scope: admin' } },
    },
  });
  const result = await client.governance(USER);
  assert.equal(result.admissions.available, false);
  assert.deepEqual(result.admissions.pending, []);
});

test('resolveSupersession PATCHes the review action with the reviewer note', async () => {
  const { client, fetchImpl } = build({
    metadata: { liansConsoleKey: 'agentmem_ok' },
    routes: { 'PATCH /v1/supersessions/mem-1': { body: { memory_id: 'mem-1', action: 'reject', applied_at: '2026-07-01T00:00:00Z' } } },
  });
  const result = await client.resolveSupersession(USER, 'mem-1', 'reject', 'wrong supersession');
  assert.equal(result.action, 'reject');
  const call = fetchImpl.calls.find((c) => c.key === 'PATCH /v1/supersessions/mem-1');
  assert.deepEqual(call.body, { action: 'reject', reviewer_note: 'wrong supersession' });
});

test('resolveAdmission POSTs to the resolve endpoint', async () => {
  const { client, fetchImpl } = build({
    metadata: { liansConsoleKey: 'agentmem_ok' },
    routes: { 'POST /v1/admissions/pend-1/resolve': { body: { id: 'pend-1', status: 'approved' } } },
  });
  await client.resolveAdmission(USER, 'pend-1', 'approve');
  const call = fetchImpl.calls.find((c) => c.key === 'POST /v1/admissions/pend-1/resolve');
  assert.deepEqual(call.body, { action: 'approve', note: null });
});

test('playgroundWrite writes to the playground agent with an event time', async () => {
  const { client, fetchImpl } = build({
    metadata: { liansConsoleKey: 'agentmem_ok' },
    routes: { 'POST /v1/memories': { body: { id: 'mem-9', content: 'NVDA guidance is $40B' } } },
  });
  const memory = await client.playgroundWrite(USER, 'NVDA guidance is $40B');
  assert.equal(memory.id, 'mem-9');
  const call = fetchImpl.calls.find((c) => c.key === 'POST /v1/memories');
  assert.equal(call.body.agent_id, PLAYGROUND_AGENT);
  assert.equal(call.body.content, 'NVDA guidance is $40B');
  assert.ok(call.body.event_time);
});

test('playgroundRecall passes query, k and optional as_of', async () => {
  const { client, fetchImpl } = build({
    metadata: { liansConsoleKey: 'agentmem_ok' },
    routes: { 'POST /v1/recall': { body: { memories: [{ id: 'm1', score: 0.91 }], as_of: '2025-03-01T00:00:00Z', total_candidates: 3 } } },
  });
  const result = await client.playgroundRecall(USER, 'NVDA guidance', '2025-03-01');
  assert.equal(result.memories[0].score, 0.91);
  const call = fetchImpl.calls.find((c) => c.key === 'POST /v1/recall');
  assert.deepEqual(call.body, { agent_id: PLAYGROUND_AGENT, query: 'NVDA guidance', k: 5, as_of: '2025-03-01' });
});

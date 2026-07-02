// ── Lians console data-plane client ──────────────────────────────────────────
// The console's Memory Governor views (supersession review, admission queue)
// and the live playground read a user's own namespace on the Lians backend.
// Those are data-plane endpoints (X-API-Key), not admin endpoints — so we mint
// ONE server-held key per user (label "console-internal", scopes read/write/admin,
// namespace ns_<user.id>) via the admin API and keep the secret in Clerk private
// metadata. It is never shown to the user and never leaves the server.
//
// Everything takes an injectable fetch so tests can run without a live backend.

const CONSOLE_KEY_LABEL = 'console-internal';
const CONSOLE_KEY_SCOPES = ['read', 'write', 'admin'];
const PLAYGROUND_AGENT = 'console-playground';

const createLiansConsole = ({ apiUrl = '', adminSecret = '', clerk, log = () => {}, fetchImpl = fetch } = {}) => {
  const base = String(apiUrl || '').replace(/\/+$/, '');
  const configured = () => Boolean(base && adminSecret);
  const namespaceFor = (user) => `ns_${user.id}`;
  // In-process cache so we don't hit Clerk metadata on every console request.
  const keyCache = new Map(); // user.id -> secret

  const request = async (path, { method = 'GET', body, headers = {} } = {}) => {
    const resp = await fetchImpl(`${base}${path}`, {
      method,
      headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await resp.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    if (!resp.ok) { const e = new Error((data && (data.detail || data.error)) || `Lians API ${resp.status}`); e.status = resp.status; throw e; }
    return data;
  };
  const adminRequest = (path, opts = {}) => request(`/v1/admin${path}`, { ...opts, headers: { 'X-Admin-Secret': adminSecret } });

  const mintConsoleKey = async (user, priorMetadata = {}) => {
    const created = await adminRequest('/api-keys', {
      method: 'POST',
      body: { namespace: namespaceFor(user), scopes: CONSOLE_KEY_SCOPES, label: CONSOLE_KEY_LABEL },
    });
    try {
      await clerk.users.updateUserMetadata(user.clerkUserId, {
        privateMetadata: { ...priorMetadata, liansConsoleKey: created.key, liansConsoleKeyId: created.id },
      });
    } catch (err) {
      // Non-fatal: the key still works this process lifetime via the cache;
      // a lost secret just means a re-mint on the next cold start.
      log('console_key_metadata_save_failed', { error: err.message, userId: user.id });
    }
    keyCache.set(user.id, created.key);
    return created.key;
  };

  const consoleKeyFor = async (user) => {
    if (keyCache.has(user.id)) return keyCache.get(user.id);
    let metadata = {};
    try {
      const clerkUser = await clerk.users.getUser(user.clerkUserId);
      metadata = clerkUser.privateMetadata || {};
      if (metadata.liansConsoleKey) { keyCache.set(user.id, metadata.liansConsoleKey); return metadata.liansConsoleKey; }
    } catch (err) { log('console_key_metadata_read_failed', { error: err.message, userId: user.id }); }
    return mintConsoleKey(user, metadata);
  };

  // Data-plane call as the user's console key. A 401 means the stored key was
  // revoked/rotated out from under us — re-mint once and retry.
  const dataRequest = async (user, path, opts = {}) => {
    const call = async (key) => request(path, { ...opts, headers: { 'X-API-Key': key } });
    const key = await consoleKeyFor(user);
    try { return await call(key); }
    catch (err) {
      if (err.status !== 401) throw err;
      keyCache.delete(user.id);
      return call(await mintConsoleKey(user));
    }
  };

  // ── High-level console surface ──────────────────────────────────────────────

  // Both Memory Governor review queues in one round trip for the console view.
  // Admissions need the admin scope; keys minted before that scope existed get
  // `available: false` instead of failing the whole view.
  const governance = async (user) => {
    const supersessions = await dataRequest(user, '/v1/supersessions/review?limit=50');
    let admissions = { pending: [], total: 0, available: true };
    try {
      const result = await dataRequest(user, '/v1/admissions?status=pending&limit=50');
      admissions = { pending: result.pending || [], total: result.total || 0, available: true };
    } catch (err) {
      if (err.status !== 403) throw err;
      admissions = { pending: [], total: 0, available: false };
    }
    return {
      configured: true,
      supersessions: { items: supersessions.items || [], total: supersessions.total || 0, threshold: supersessions.confidence_threshold },
      admissions,
    };
  };

  const resolveSupersession = (user, memoryId, action, note) =>
    dataRequest(user, `/v1/supersessions/${encodeURIComponent(memoryId)}`, {
      method: 'PATCH',
      body: { action, reviewer_note: note || null },
    });

  const resolveAdmission = (user, pendingId, action, note) =>
    dataRequest(user, `/v1/admissions/${encodeURIComponent(pendingId)}/resolve`, {
      method: 'POST',
      body: { action, note: note || null },
    });

  const playgroundWrite = (user, content) =>
    dataRequest(user, '/v1/memories', {
      method: 'POST',
      body: { agent_id: PLAYGROUND_AGENT, content, event_time: new Date().toISOString() },
    });

  const playgroundRecall = (user, query, asOf) =>
    dataRequest(user, '/v1/recall', {
      method: 'POST',
      body: { agent_id: PLAYGROUND_AGENT, query, k: 5, ...(asOf ? { as_of: asOf } : {}) },
    });

  return { configured, namespaceFor, consoleKeyFor, dataRequest, governance, resolveSupersession, resolveAdmission, playgroundWrite, playgroundRecall };
};

module.exports = { createLiansConsole, CONSOLE_KEY_LABEL, CONSOLE_KEY_SCOPES, PLAYGROUND_AGENT };

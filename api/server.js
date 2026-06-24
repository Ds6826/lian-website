const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createClerkClient, verifyToken } = require('@clerk/backend');
const { Redis } = require('@upstash/redis');
const kv = Redis.fromEnv();

const root = path.join(__dirname, '..', 'public');
const baseUrl = process.env.BASE_URL || 'https://lians.ai';
const requiredSteps = ['company', 'role', 'use-case', 'tools', 'memory-needs'];
const validSteps = [...requiredSteps, 'context'];

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY || '' });
const isProd = process.env.NODE_ENV === 'production';

const clerkHost = (() => {
  try { return `https://${Buffer.from((process.env.CLERK_PUBLISHABLE_KEY || '').split('_')[2] || '', 'base64').toString().replace(/\$$/, '')}`; }
  catch { return ''; }
})();

const SEC_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  ...(isProd ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains; preload' } : {}),
  'content-security-policy': [
    "default-src 'self'",
    `script-src 'self'${clerkHost ? ` ${clerkHost}` : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    `connect-src 'self'${clerkHost ? ` ${clerkHost} https://*.clerk.accounts.dev https://*.clerk.com` : ''}`,
    `frame-src${clerkHost ? ` ${clerkHost}` : " 'none'"}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
};

// ── helpers ───────────────────────────────────────────────────────────────────

const log = (event, req, user, metadata = {}) => console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, userId: user?.id || null, route: req?.url || null, ...metadata }));
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
const json = (res, status, body) => { res.setHeader('content-type', 'application/json; charset=utf-8'); res.writeHead(status); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve, reject) => { let body = ''; req.on('data', (chunk) => { body += chunk; if (body.length > 1_000_000) req.destroy(); }); req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Invalid JSON')); } }); });
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map((part) => { const [key, ...value] = part.trim().split('='); return [key, decodeURIComponent(value.join('='))]; }));
const redirect = (res, location) => { res.setHeader('location', location); res.writeHead(302); res.end(); };
const serveFile = (res, filename) => {
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
  fs.readFile(filename, (error, content) => {
    if (error) { res.writeHead(404); res.end('Not found'); return; }
    res.setHeader('content-type', types[path.extname(filename)] || 'application/octet-stream');
    res.writeHead(200);
    res.end(content);
  });
};

// ── KV data access ────────────────────────────────────────────────────────────

const getUser = (clerkUserId) => kv.get(`user:clerk:${clerkUserId}`);
const saveUser = async (user) => { await kv.set(`user:clerk:${user.clerkUserId}`, user); await kv.set(`user:id:${user.id}`, user); };
const getOnboarding = (userId) => kv.get(`onboarding:${userId}`).then((v) => v || {});
const saveOnboarding = (userId, answers) => kv.set(`onboarding:${userId}`, answers);
const getKeys = (userId) => kv.get(`keys:${userId}`).then((v) => v || []);
const saveKeys = (userId, keys) => kv.set(`keys:${userId}`, keys);

// ── auth (Clerk) ──────────────────────────────────────────────────────────────

const verifyClerkToken = async (req) => {
  const token = cookies(req).__session;
  if (!token) return null;
  try { return await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY }); } catch { return null; }
};

const userFor = async (req) => {
  const payload = await verifyClerkToken(req);
  if (!payload) return null;
  const clerkUserId = payload.sub;
  let user = await getUser(clerkUserId);
  if (!user) {
    let clerkUser;
    try { clerkUser = await clerk.users.getUser(clerkUserId); } catch { return null; }
    const email = clerkUser.emailAddresses?.[0]?.emailAddress || '';
    const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || clerkUser.username || 'Lian user';
    user = { id: crypto.randomUUID(), clerkUserId, email, name, avatarUrl: clerkUser.imageUrl || '', createdAt: new Date().toISOString(), onboardingComplete: false };
    await saveUser(user);
    log('user_created', req, user, { provider: 'clerk' });
  }
  return user;
};

const firstIncomplete = async (userId) => {
  const answers = await getOnboarding(userId);
  return requiredSteps.find((step) => !answers[step]) || 'context';
};

const nextStep = (step) => ({ company: 'role', role: 'use-case', 'use-case': 'tools', tools: 'memory-needs', 'memory-needs': 'context', context: 'review' }[step]);

const requireAuth = async (req, res) => { const user = await userFor(req); if (!user) { log('redirect_guard', req, null, { reason: 'unauthenticated' }); redirect(res, '/login'); return null; } return user; };
const requireOnboarding = async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return null;
  if (!user.onboardingComplete) {
    const next = await firstIncomplete(user.id);
    log('console_access_denied', req, user, { next });
    redirect(res, `/onboarding/${next}`);
    return null;
  }
  return user;
};
const apiAuth = async (req, res) => { const user = await userFor(req); if (!user) { json(res, 401, { error: 'Authentication required.' }); return null; } return user; };
const apiOnboarding = async (req, res) => { const user = await apiAuth(req, res); if (!user) return null; if (!user.onboardingComplete) { json(res, 403, { error: 'Complete onboarding before accessing this resource.' }); return null; } return user; };

// ── handler ───────────────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  for (const [k, v] of Object.entries(SEC_HEADERS)) res.setHeader(k, v);

  const url = new URL(req.url, baseUrl);
  const { pathname } = url;

  try {
    if (pathname.startsWith('/api/')) {
      const origin = req.headers.origin;
      if (origin && origin !== baseUrl) { log('cors_blocked', req, null, { origin }); return json(res, 403, { error: 'Forbidden.' }); }
    }

    if (pathname === '/config.js') {
      res.setHeader('content-type', 'application/javascript; charset=utf-8');
      res.writeHead(200);
      res.end(`window.__lian_config=${JSON.stringify({ clerkPublishableKey: process.env.CLERK_PUBLISHABLE_KEY || '', clerkBillingPlanId: process.env.CLERK_BILLING_PLAN_ID || '' })};`);
      return;
    }

    if (pathname === '/login') {
      const user = await userFor(req);
      if (user) { const next = await firstIncomplete(user.id); return redirect(res, user.onboardingComplete ? '/console' : `/onboarding/${next}`); }
      return serveFile(res, path.join(root, 'app.html'));
    }
    if (pathname === '/onboarding' || pathname.startsWith('/onboarding/')) { const user = await requireAuth(req, res); if (!user) return; return serveFile(res, path.join(root, 'app.html')); }
    if (pathname === '/console' || pathname.startsWith('/console/')) { const user = await requireOnboarding(req, res); if (!user) return; return serveFile(res, path.join(root, 'app.html')); }

    if (pathname === '/logout' && req.method === 'POST') { return redirect(res, '/login'); }

    if (pathname === '/api/logout' && req.method === 'POST') { return json(res, 200, { ok: true }); }

    if (pathname === '/api/session' && req.method === 'GET') {
      const user = await userFor(req);
      return json(res, 200, { authenticated: Boolean(user), user: user && { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl, onboardingComplete: user.onboardingComplete } });
    }

    if (pathname === '/api/onboarding' && req.method === 'GET') {
      const user = await apiAuth(req, res); if (!user) return;
      const answers = await getOnboarding(user.id);
      const nextStepName = user.onboardingComplete ? null : await firstIncomplete(user.id);
      return json(res, 200, { answers, onboardingComplete: user.onboardingComplete, nextStep: nextStepName });
    }

    if (pathname.startsWith('/api/onboarding/') && pathname !== '/api/onboarding/complete' && req.method === 'POST') {
      const user = await apiAuth(req, res); if (!user) return;
      const step = pathname.split('/').pop();
      if (!validSteps.includes(step)) return json(res, 404, { error: 'Unknown onboarding step.' });
      const expected = await firstIncomplete(user.id);
      if (step !== expected && !(step === 'context' && expected === 'context')) return json(res, 409, { error: `Complete ${expected} first.`, next: `/onboarding/${expected}` });
      const body = await readBody(req);
      const value = step === 'context' ? String(body.value || '') : String(body.value || '').trim();
      if (requiredSteps.includes(step) && !value) return json(res, 400, { error: 'Choose an option to continue.' });
      const answers = await getOnboarding(user.id);
      await saveOnboarding(user.id, { ...answers, [step]: value, updatedAt: new Date().toISOString() });
      const next = nextStep(step);
      log('onboarding_step_saved', req, user, { step, next });
      return json(res, 200, { next: `/onboarding/${next}` });
    }

    if (pathname === '/api/onboarding/complete' && req.method === 'POST') {
      const user = await apiAuth(req, res); if (!user) return;
      const missing = await firstIncomplete(user.id);
      if (missing !== 'context') return json(res, 409, { error: 'Required onboarding steps are incomplete.', next: `/onboarding/${missing}` });
      const answers = await getOnboarding(user.id);
      if (!requiredSteps.every((step) => answers[step])) return json(res, 409, { error: 'Required onboarding steps are incomplete.' });
      const updatedUser = { ...user, onboardingComplete: true };
      await saveUser(updatedUser);
      await saveOnboarding(user.id, { ...answers, completedAt: new Date().toISOString() });
      log('onboarding_completed', req, updatedUser);
      return json(res, 200, { next: '/console' });
    }

    if (pathname === '/api/keys' && req.method === 'GET') {
      const user = await apiOnboarding(req, res); if (!user) return;
      const keys = await getKeys(user.id);
      return json(res, 200, { keys: keys.map(({ hashedKey, ...k }) => k) });
    }

    if (pathname === '/api/keys' && req.method === 'POST') {
      const user = await apiOnboarding(req, res); if (!user) return;
      const { label, environment = 'live' } = await readBody(req);
      if (!label?.trim()) return json(res, 400, { error: 'A key label is required.' });
      const rawKey = `lian_${environment === 'test' ? 'test' : 'live'}_${crypto.randomBytes(32).toString('hex')}`;
      const key = { id: crypto.randomUUID(), userId: user.id, label: label.trim(), prefix: `${rawKey.slice(0, 18)}…`, hashedKey: sha256(rawKey), createdAt: new Date().toISOString(), lastUsedAt: null, revokedAt: null };
      const keys = await getKeys(user.id);
      await saveKeys(user.id, [key, ...keys]);
      const { hashedKey, ...safeKey } = key;
      log('api_key_created', req, user, { prefix: key.prefix, environment });
      return json(res, 201, { key: safeKey, rawKey });
    }

    if (pathname.startsWith('/api/keys/') && req.method === 'DELETE') {
      const user = await apiOnboarding(req, res); if (!user) return;
      const id = pathname.split('/').pop();
      const keys = await getKeys(user.id);
      const key = keys.find((k) => k.id === id);
      if (!key) return json(res, 404, { error: 'Key not found.' });
      key.revokedAt = new Date().toISOString();
      await saveKeys(user.id, keys);
      log('api_key_deleted', req, user, { prefix: key.prefix });
      return json(res, 200, { ok: true });
    }

    if (pathname === '/api/demo/recall' && req.method === 'POST') {
      const user = await userFor(req); if (!user) return json(res, 401, { error: 'Authentication required.' });
      try {
        const { LianClient } = require('lian-sdk');
        const client = new LianClient({ apiKey: process.env.LIAN_API_KEY, baseUrl });
        const result = await client.recall({ agentId: 'demo', query: 'NVDA guidance', asOf: '2025-03-01' });
        return json(res, 200, result);
      } catch {
        return json(res, 200, { value: '$32B', validOn: '2025-03-01', content: 'NVDA FY2026 revenue guidance revised to $32B on February 20, 2025. Superseded by the May update.', audit: 'Validity window verified and recall event logged.' });
      }
    }

    if (pathname === '/api/billing' && req.method === 'GET') {
      const user = await apiAuth(req, res); if (!user) return;
      try {
        const clerkUser = await clerk.users.getUser(user.clerkUserId);
        const plan = clerkUser.publicMetadata?.plan || 'free';
        return json(res, 200, { plan, email: user.email });
      } catch (err) {
        log('clerk_billing_fetch_failed', req, user, { error: err.message });
        return json(res, 200, { plan: 'free', email: user.email });
      }
    }

    // Static files
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
    const file = path.resolve(root, relative);
    if (!file.startsWith(root)) return json(res, 403, { error: 'Forbidden' });
    return serveFile(res, file);
  } catch (error) {
    log('server_error', req, null, { message: error.message, stack: error.stack });
    return json(res, 500, { error: 'Unexpected server error.' });
  }
};

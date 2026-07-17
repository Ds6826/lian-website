const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createClerkClient, verifyToken } = require('@clerk/backend');

const root = __dirname;
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach((line) => { const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ''); });

const port = Number(process.env.PORT || 8000);
const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const dataFile = path.join(dataDir, 'lian-console.json');
const requiredSteps = ['company', 'role', 'use-case', 'tools', 'memory-needs'];
const validSteps = [...requiredSteps, 'context'];

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY || '' });
const isProd = process.env.NODE_ENV === 'production';

// ── security headers ──────────────────────────────────────────────────────────

// Derive Clerk's frontend API hostname from the publishable key for a tight CSP
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
    // sha256 hash whitelists the inline no-flash theme script in every page <head>
    // (same hash as server.js - keep both in sync if the theme snippet changes).
    `script-src 'self' 'sha256-oM3fK1wB/KZpRi+zI+8vJ+5IU+jYT4jY9m7pTRZLHCc='${clerkHost ? ` ${clerkHost}` : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    `connect-src 'self' https://api.github.com${clerkHost ? ` ${clerkHost} https://*.clerk.accounts.dev https://*.clerk.com` : ''}`,
    `frame-src${clerkHost ? ` ${clerkHost}` : " 'none'"}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
};

// ── rate limiting ─────────────────────────────────────────────────────────────

const rateLimits = new Map();
const rateLimit = (req, res, { max = 60, windowMs = 60_000 } = {}) => {
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let e = rateLimits.get(ip);
  if (!e || now > e.resetAt) { e = { count: 0, resetAt: now + windowMs }; rateLimits.set(ip, e); }
  e.count++;
  if (e.count > max) { res.setHeader('retry-after', Math.ceil((e.resetAt - now) / 1000)); json(res, 429, { error: 'Too many requests.' }); return false; }
  return true;
};
setInterval(() => { const now = Date.now(); for (const [ip, e] of rateLimits) if (now > e.resetAt) rateLimits.delete(ip); }, 5 * 60_000).unref();

// ── helpers ──────────────────────────────────────────────────────────────────

const log = (event, req, user, metadata = {}) => console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, userId: user?.id || null, route: req?.url || null, ...metadata }));
const defaultStore = () => ({ users: [], onboarding: {}, apiKeys: [] });
const readStore = () => { try { return { ...defaultStore(), ...JSON.parse(fs.readFileSync(dataFile, 'utf8')) }; } catch { return defaultStore(); } };
const writeStore = (store) => { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(dataFile, JSON.stringify(store, null, 2)); };
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
// Helpers use res.setHeader so security headers set at request start are preserved
const json = (res, status, body) => { res.setHeader('content-type', 'application/json; charset=utf-8'); res.writeHead(status); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve, reject) => { let body = ''; req.on('data', (chunk) => { body += chunk; if (body.length > 1_000_000) req.destroy(); }); req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Invalid JSON')); } }); });
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map((part) => { const [key, ...value] = part.trim().split('='); return [key, decodeURIComponent(value.join('='))]; }));
const redirect = (res, location) => { res.setHeader('location', location); res.writeHead(302); res.end(); };
const serveFile = (res, filename) => { const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' }; fs.readFile(filename, (error, content) => { if (error) { res.writeHead(404); res.end('Not found'); return; } res.setHeader('content-type', types[path.extname(filename)] || 'application/octet-stream'); res.writeHead(200); res.end(content); }); };

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
  const store = readStore();
  let user = store.users.find((u) => u.clerkUserId === clerkUserId);
  if (!user) {
    let clerkUser;
    try { clerkUser = await clerk.users.getUser(clerkUserId); } catch { return null; }
    const email = clerkUser.emailAddresses?.[0]?.emailAddress || '';
    const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || clerkUser.username || 'Lians user';
    user = { id: crypto.randomUUID(), clerkUserId, email, name, avatarUrl: clerkUser.imageUrl || '', createdAt: new Date().toISOString(), onboardingComplete: false };
    store.users.push(user);
    writeStore(store);
    log('user_created', req, user, { provider: 'clerk' });
  }
  return user;
};

const firstIncomplete = (user) => { const answers = readStore().onboarding[user.id] || {}; return requiredSteps.find((step) => !answers[step]) || 'context'; };
const nextStep = (step) => ({ company: 'role', role: 'use-case', 'use-case': 'tools', tools: 'memory-needs', 'memory-needs': 'context', context: 'review' }[step]);

const requireAuth = async (req, res) => { const user = await userFor(req); if (!user) { log('redirect_guard', req, null, { reason: 'unauthenticated' }); redirect(res, '/login'); return null; } return user; };
const requireOnboarding = async (req, res) => { const user = await requireAuth(req, res); if (!user) return null; if (!user.onboardingComplete) { log('console_access_denied', req, user, { next: firstIncomplete(user) }); redirect(res, `/onboarding/${firstIncomplete(user)}`); return null; } return user; };
const apiAuth = async (req, res) => { const user = await userFor(req); if (!user) { json(res, 401, { error: 'Authentication required.' }); return null; } return user; };
const apiOnboarding = async (req, res) => { const user = await apiAuth(req, res); if (!user) return null; if (!user.onboardingComplete) { json(res, 403, { error: 'Complete onboarding before accessing this resource.' }); return null; } return user; };

// ── server ────────────────────────────────────────────────────────────────────

http.createServer(async (req, res) => {
  // Apply security headers to every response before any writeHead call
  for (const [k, v] of Object.entries(SEC_HEADERS)) res.setHeader(k, v);

  const url = new URL(req.url, baseUrl); const { pathname } = url;
  try {
    // Block cross-origin requests to the API
    if (pathname.startsWith('/api/')) {
      const origin = req.headers.origin;
      if (origin && origin !== baseUrl) { log('cors_blocked', req, null, { origin }); return json(res, 403, { error: 'Forbidden.' }); }
      if (!rateLimit(req, res, { max: 60, windowMs: 60_000 })) return;
    }

    // Public config for client-side SDK initialisation (publishable keys only)
    if (pathname === '/config.js') {
      res.setHeader('content-type', 'application/javascript; charset=utf-8');
      res.writeHead(200);
      res.end(`window.__lian_config=${JSON.stringify({ clerkPublishableKey: process.env.CLERK_PUBLISHABLE_KEY || '', clerkBillingPlanId: process.env.CLERK_BILLING_PLAN_ID || '' })};`);
      return;
    }

    // Page routes - serve the SPA shell for every app route
    if (pathname === '/login') { const user = await userFor(req); if (user) return redirect(res, user.onboardingComplete ? '/console' : `/onboarding/${firstIncomplete(user)}`); return serveFile(res, path.join(root, 'app.html')); }
    if (pathname === '/onboarding' || pathname.startsWith('/onboarding/')) { const user = await requireAuth(req, res); if (!user) return; return serveFile(res, path.join(root, 'app.html')); }
    if (pathname === '/console' || pathname.startsWith('/console/')) { const user = await requireOnboarding(req, res); if (!user) return; return serveFile(res, path.join(root, 'app.html')); }

    // Logout (Clerk handles the actual session; this just redirects)
    if (pathname === '/logout' && req.method === 'POST') { return redirect(res, '/login'); }

    // ── JSON API ──────────────────────────────────────────────────────────────

    if (pathname === '/api/logout' && req.method === 'POST') { return json(res, 200, { ok: true }); }

    if (pathname === '/api/session' && req.method === 'GET') {
      const user = await userFor(req);
      return json(res, 200, { authenticated: Boolean(user), user: user && { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl, onboardingComplete: user.onboardingComplete } });
    }

    // Onboarding
    if (pathname === '/api/onboarding' && req.method === 'GET') { const user = await apiAuth(req, res); if (!user) return; return json(res, 200, { answers: readStore().onboarding[user.id] || {}, onboardingComplete: user.onboardingComplete, nextStep: user.onboardingComplete ? null : firstIncomplete(user) }); }
    if (pathname.startsWith('/api/onboarding/') && pathname !== '/api/onboarding/complete' && req.method === 'POST') { const user = await apiAuth(req, res); if (!user) return; const step = pathname.split('/').pop(); if (!validSteps.includes(step)) return json(res, 404, { error: 'Unknown onboarding step.' }); const expected = firstIncomplete(user); if (step !== expected && !(step === 'context' && expected === 'context')) return json(res, 409, { error: `Complete ${expected} first.`, next: `/onboarding/${expected}` }); const body = await readBody(req); const value = step === 'context' ? String(body.value || '') : String(body.value || '').trim(); if (requiredSteps.includes(step) && !value) return json(res, 400, { error: 'Choose an option to continue.' }); const store = readStore(); store.onboarding[user.id] = { ...(store.onboarding[user.id] || {}), [step]: value, updatedAt: new Date().toISOString() }; writeStore(store); const next = nextStep(step); log('onboarding_step_saved', req, user, { step, next }); return json(res, 200, { next: `/onboarding/${next}` }); }
    if (pathname === '/api/onboarding/complete' && req.method === 'POST') { const user = await apiAuth(req, res); if (!user) return; const missing = firstIncomplete(user); if (missing !== 'context') return json(res, 409, { error: 'Required onboarding steps are incomplete.', next: `/onboarding/${missing}` }); const store = readStore(); const answers = store.onboarding[user.id] || {}; if (!requiredSteps.every((step) => answers[step])) return json(res, 409, { error: 'Required onboarding steps are incomplete.' }); const target = store.users.find((item) => item.id === user.id); target.onboardingComplete = true; store.onboarding[user.id] = { ...answers, completedAt: new Date().toISOString() }; writeStore(store); log('onboarding_completed', req, target); return json(res, 200, { next: '/console' }); }

    // API keys
    if (pathname === '/api/keys' && req.method === 'GET') { const user = await apiOnboarding(req, res); if (!user) return; return json(res, 200, { keys: readStore().apiKeys.filter((key) => key.userId === user.id).map(({ hashedKey, ...key }) => key) }); }
    if (pathname === '/api/keys' && req.method === 'POST') { const user = await apiOnboarding(req, res); if (!user) return; const { label, environment = 'live' } = await readBody(req); if (!label?.trim()) return json(res, 400, { error: 'A key label is required.' }); const rawKey = `lian_${environment === 'test' ? 'test' : 'live'}_${crypto.randomBytes(32).toString('hex')}`; const key = { id: crypto.randomUUID(), userId: user.id, label: label.trim(), prefix: `${rawKey.slice(0, 18)}…`, hashedKey: sha256(rawKey), createdAt: new Date().toISOString(), lastUsedAt: null, revokedAt: null }; const store = readStore(); store.apiKeys.unshift(key); writeStore(store); const { hashedKey, ...safeKey } = key; log('api_key_created', req, user, { prefix: key.prefix, environment }); return json(res, 201, { key: safeKey, rawKey }); }
    if (pathname.startsWith('/api/keys/') && req.method === 'DELETE') { const user = await apiOnboarding(req, res); if (!user) return; const id = pathname.split('/').pop(); const store = readStore(); const key = store.apiKeys.find((item) => item.id === id && item.userId === user.id); if (!key) return json(res, 404, { error: 'Key not found.' }); key.revokedAt = new Date().toISOString(); writeStore(store); log('api_key_deleted', req, user, { prefix: key.prefix }); return json(res, 200, { ok: true }); }

    // Playground demo: canned fixture. The signed-in console's live playground
    // talks to the real backend via lians-console.js instead.
    if (pathname === '/api/demo/recall' && req.method === 'POST') {
      const user = await userFor(req); if (!user) return json(res, 401, { error: 'Authentication required.' });
      return json(res, 200, { value: '$32B', validOn: '2025-03-01', content: 'NVDA FY2026 revenue guidance revised to $32B on February 20, 2025. Superseded by the May update.', audit: 'Validity window verified and recall event logged.' });
    }

    // ── Billing (Clerk) ───────────────────────────────────────────────────────
    // Plan state lives in Clerk's publicMetadata. Checkout and portal are
    // handled entirely on the client via the Clerk JS SDK.

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
  } catch (error) { log('server_error', req, null, { message: error.message, stack: error.stack }); return json(res, 500, { error: 'Unexpected server error.' }); }
}).listen(port, () => console.log(`Lians server running at ${baseUrl}`));

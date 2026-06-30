const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createClerkClient, verifyToken } = require('@clerk/backend');

const root = __dirname;
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach((line) => { const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ''); });
// Strip BOM (U+FEFF) from Clerk keys — can appear when copy-pasting into Vercel env settings from certain editors
['CLERK_SECRET_KEY', 'CLERK_PUBLISHABLE_KEY'].forEach((key) => { if (process.env[key]?.charCodeAt(0) === 0xFEFF) process.env[key] = process.env[key].slice(1); });

const port = Number(process.env.PORT || 8000);
const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
const dataDir = process.env.DATA_DIR || (process.env.VERCEL ? path.join('/tmp', 'lian-data') : path.join(root, 'data'));
const dataFile = path.join(dataDir, 'lian-console.json');
const requiredSteps = ['company', 'role', 'use-case', 'tools', 'memory-needs'];

const TIER_SCOPES = {
  free:       ['read', 'write'],
  starter:    ['read', 'write', 'adapters', 'audit'],
  growth:     ['read', 'write', 'adapters', 'audit', 'conflicts', 'webhooks', 'compliance'],
  pro:        ['read', 'write', 'adapters', 'audit', 'conflicts', 'webhooks', 'compliance', 'barriers', 'hipaa', 'erasure', 'backtest', 'metrics'],
  enterprise: ['read', 'write', 'adapters', 'audit', 'conflicts', 'webhooks', 'compliance', 'barriers', 'hipaa', 'erasure', 'backtest', 'metrics', 'airgap', 'kms'],
};
const validSteps = [...requiredSteps, 'context'];
const APP_BUILD = process.env.VERCEL_GIT_COMMIT_SHA || 'local-workflow-postauth-20260625-v3';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY || '', publishableKey: process.env.CLERK_PUBLISHABLE_KEY || '' });
const isProd = process.env.NODE_ENV === 'production';

// ── security headers ──────────────────────────────────────────────────────────

// Derive Clerk's frontend API origin from the publishable key for a tight CSP
// and for loading Clerk.js. Keep this publishable-only; never expose the secret.
const clerkFrontendApi = (() => {
  try {
    return Buffer.from((process.env.CLERK_PUBLISHABLE_KEY || '').split('_')[2] || '', 'base64').toString().replace(/\$$/, '');
  } catch {
    return '';
  }
})();
const clerkOrigin = clerkFrontendApi ? `https://${clerkFrontendApi}` : '';
// Clerk's own CDN serves v4 for this account; v4 has no billing API (window.Clerk.billing).
// Load v5 from jsDelivr (already in CSP) as primary — fall back to Clerk's CDN v4 if jsDelivr fails.
const clerkJsUrl = 'https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/dist/clerk.browser.js';
const clerkJsFallbackUrl = clerkOrigin ? `${clerkOrigin}/npm/@clerk/clerk-js@latest/dist/clerk.browser.js` : '';

const SEC_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  ...(isProd ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains; preload' } : {}),
  'content-security-policy': [
    "default-src 'self'",
    // js.stripe.com: Clerk Billing checkout loads Stripe.js to render the payment form.
    // sha256 hash whitelists the inline no-flash theme script in every page <head>
    // (reads localStorage('lians-theme') before paint to avoid a light/dark flash).
    `script-src 'self' 'sha256-oM3fK1wB/KZpRi+zI+8vJ+5IU+jYT4jY9m7pTRZLHCc=' https://cdn.jsdelivr.net https://challenges.cloudflare.com https://js.stripe.com${clerkOrigin ? ` ${clerkOrigin}` : ''}`,
    // Clerk JS spawns a blob: Web Worker internally for secure session/billing processing.
    // Without an explicit worker-src, script-src is used as fallback and blocks blob: workers.
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    `connect-src 'self' https://challenges.cloudflare.com https://api.stripe.com${clerkOrigin ? ` ${clerkOrigin} https://*.clerk.accounts.dev https://*.clerk.com` : ''}`,
    // hooks.stripe.com + m.stripe.network: Stripe 3-D Secure challenge and fraud-signal frames.
    `frame-src https://challenges.cloudflare.com https://js.stripe.com https://hooks.stripe.com https://m.stripe.network${clerkOrigin ? ` ${clerkOrigin}` : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
};

// ── rate limiting ─────────────────────────────────────────────────────────────

const rateLimits = new Map();
const rateLimit = (req, res, { max = 60, windowMs = 60_000, bucket = 'api' } = {}) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  let e = rateLimits.get(key);
  if (!e || now > e.resetAt) { e = { count: 0, resetAt: now + windowMs }; rateLimits.set(key, e); }
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
const readRawBody = (req) => new Promise((resolve, reject) => { let body = ''; req.on('data', (chunk) => { body += chunk; if (body.length > 1_000_000) req.destroy(); }); req.on('end', () => resolve(body)); req.on('error', reject); });
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map((part) => { const [key, ...value] = part.trim().split('='); return [key, decodeURIComponent(value.join('='))]; }));
const redirect = (res, location) => { res.setHeader('location', location); res.writeHead(302); res.end(); };
const serveFile = (res, filename) => { const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' }; fs.readFile(filename, (error, content) => { if (error) { res.writeHead(404); res.end('Not found'); return; } res.setHeader('content-type', types[path.extname(filename)] || 'application/octet-stream'); res.writeHead(200); res.end(content); }); };
const allowedApiOrigins = (req) => {
  const proto = (req.headers['x-forwarded-proto'] || (req.headers.host?.startsWith('localhost') ? 'http' : 'https')).split(',')[0].trim();
  const host = req.headers.host || '';
  const origins = new Set([baseUrl, `${proto}://${host}`]);
  try {
    const configured = new URL(baseUrl);
    if (configured.hostname === 'lians.ai') origins.add(`${configured.protocol}//www.lians.ai`);
    if (configured.hostname === 'www.lians.ai') origins.add(`${configured.protocol}//lians.ai`);
  } catch {}
  return origins;
};

const completionTimestamp = (user, store = readStore()) => store.onboarding[user.id]?.completedAt || user.completedAt || user.onboardingCompletedAt || null;
const hasCompletedOnboarding = (user, store = readStore()) => Boolean(user?.onboardingComplete && completionTimestamp(user, store));

// ── auth (Clerk) ──────────────────────────────────────────────────────────────

const verifyClerkToken = async (req) => {
  const bearer = (req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) {
    // Path 1: JWKS-based verification via api.clerk.com (fast when JWKS is cached).
    try {
      const { data, errors } = await verifyToken(bearer, {
        secretKey: process.env.CLERK_SECRET_KEY,
        publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
      });
      if (!errors && data?.sub) return { userId: data.sub, sessionId: data.sid || null, source: 'bearer' };
      log('clerk_bearer_verify_failed', req, null, { reason: errors?.[0]?.reason || errors?.[0]?.message || 'unknown' });
    } catch (err) {
      log('clerk_bearer_verify_error', req, null, { message: err.message });
    }
    // Path 2: API-based verification via clerk.sessions.verifySession.
    // Calls api.clerk.com/v1/sessions/{id}/verify using the secret key — bypasses JWKS
    // kid-matching entirely. Only fails if the token is genuinely invalid/expired.
    try {
      const [, payloadB64] = bearer.split('.');
      const claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
      if (claims.sid && claims.sub) {
        await clerk.sessions.verifySession(claims.sid, bearer);
        return { userId: claims.sub, sessionId: claims.sid, source: 'api-verify' };
      }
    } catch (err) {
      log('clerk_session_verify_failed', req, null, { message: err.message });
    }
  }
  // Path 3: Cookie-based auth. Authorization header is stripped so the SDK
  // uses __session/__client_uat cookies without re-attempting Bearer.
  try {
    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    const host = req.headers.host || 'localhost';
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (k.toLowerCase() === 'authorization') continue;
      if (typeof v === 'string') headers.set(k, v);
      else if (Array.isArray(v)) v.forEach(item => headers.append(k, item));
    }
    const state = await clerk.authenticateRequest(
      new Request(`${proto}://${host}${req.url}`, { headers })
    );
    if (!state.isSignedIn) return null;
    const auth = state.toAuth();
    return { ...auth, source: 'request' };
  } catch (err) {
    log('clerk_request_auth_error', req, null, { method: req.method, message: err.message });
    return null;
  }
};

const userFor = async (req) => {
  const payload = await verifyClerkToken(req);
  if (!payload) return null;
  const clerkUserId = payload.userId;
  const store = readStore();
  let user = store.users.find((u) => u.clerkUserId === clerkUserId);
  if (!user) {
    let clerkUser;
    try { clerkUser = await clerk.users.getUser(clerkUserId); } catch { return null; }
    const email = clerkUser.emailAddresses?.[0]?.emailAddress || '';
    const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || clerkUser.username || 'Lians user';
    // Restore completion only when both the flag and completion timestamp exist.
    // Older bad metadata may have the flag alone; treat that as incomplete.
    const restoredCompletedAt = clerkUser.privateMetadata?.onboardingCompletedAt || clerkUser.privateMetadata?.onboardingAnswers?.completedAt || null;
    const restoredComplete = Boolean(clerkUser.privateMetadata?.onboardingComplete && restoredCompletedAt);
    const restoredBillingPlan = clerkUser.privateMetadata?.billingPlan || null;
    user = { id: crypto.randomUUID(), clerkUserId, email, name, avatarUrl: clerkUser.imageUrl || '', createdAt: new Date().toISOString(), onboardingComplete: restoredComplete, billingPlan: restoredBillingPlan };
    store.users.push(user);
    if (clerkUser.privateMetadata?.onboardingAnswers) {
      store.onboarding[user.id] = clerkUser.privateMetadata.onboardingAnswers;
    }
    if (restoredComplete) {
      store.onboarding[user.id] = { ...(store.onboarding[user.id] || {}), completedAt: restoredCompletedAt };
    }
    writeStore(store);
    log('user_created', req, user, { provider: 'clerk', restored: restoredComplete });
  } else if (user.onboardingComplete && !completionTimestamp(user, store)) {
    user.onboardingComplete = false;
    const target = store.users.find((u) => u.id === user.id);
    if (target) target.onboardingComplete = false;
    writeStore(store);
    log('onboarding_completion_downgraded', req, user, { reason: 'missing_completed_at' });
  }
  return user;
};

// The console is intentionally a route-by-route wizard. Keep the route guard
// and the client in agreement so a bookmarked later step cannot skip setup.
const firstIncomplete = (user) => {
  const answers = readStore().onboarding[user.id] || {};
  const required = requiredSteps.find((step) => !answers[step]);
  if (required) return required;
  return Object.prototype.hasOwnProperty.call(answers, 'context') ? 'review' : 'context';
};
const nextStep = (step) => ({ company: 'role', role: 'use-case', 'use-case': 'tools', tools: 'memory-needs', 'memory-needs': 'context', context: 'review' }[step]);

const requireAuth = async (req, res) => { const user = await userFor(req); if (!user) { log('redirect_guard', req, null, { reason: 'unauthenticated' }); redirect(res, '/login'); return null; } return user; };
const requireOnboarding = async (req, res) => { const user = await requireAuth(req, res); if (!user) return null; if (!hasCompletedOnboarding(user)) { log('console_access_denied', req, user, { next: firstIncomplete(user) }); redirect(res, `/onboarding/${firstIncomplete(user)}`); return null; } return user; };
const apiAuth = async (req, res) => { const user = await userFor(req); if (!user) { json(res, 401, { error: 'Authentication required.' }); return null; } return user; };
const apiOnboarding = async (req, res) => { const user = await apiAuth(req, res); if (!user) return null; if (!hasCompletedOnboarding(user)) { json(res, 403, { error: 'Complete onboarding before accessing this resource.' }); return null; } return user; };

// ── server ────────────────────────────────────────────────────────────────────

const app = async (req, res) => {
  // Apply security headers to every response before any writeHead call
  for (const [k, v] of Object.entries(SEC_HEADERS)) res.setHeader(k, v);

  // Canonical domain: redirect bare apex (lians.ai) → www.lians.ai, preserving full path + query.
  // Clerk session cookies are scoped to www.lians.ai so auth must stay on one host.
  const reqHost = (req.headers.host || '').split(':')[0];
  if (reqHost === 'lians.ai') {
    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    return redirect(res, `${proto}://www.lians.ai${req.url}`, 301);
  }

  const url = new URL(req.url, baseUrl); const { pathname } = url;
  try {
    // Clerk webhook — must be before CORS/rate-limit (server-to-server, no origin header)
    if (pathname === '/api/webhooks/clerk' && req.method === 'POST') {
      const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
      if (!webhookSecret) return json(res, 500, { error: 'Webhook not configured.' });
      const rawBody = await readRawBody(req);
      const { Webhook } = require('svix');
      let event;
      try {
        event = new Webhook(webhookSecret).verify(rawBody, {
          'svix-id': req.headers['svix-id'],
          'svix-timestamp': req.headers['svix-timestamp'],
          'svix-signature': req.headers['svix-signature'],
        });
      } catch { log('webhook_verify_failed', req, null, {}); return json(res, 400, { error: 'Invalid signature.' }); }

      const clerkUserId = event.data?.id;
      if (!clerkUserId) return json(res, 200, { ok: true });

      if (event.type === 'user.created') {
        const tier = event.data.public_metadata?.plan ?? 'free';
        const scopes = TIER_SCOPES[tier] ?? TIER_SCOPES.free;
        const rawKey = `lians_live_${crypto.randomBytes(32).toString('hex')}`;
        const keyId = crypto.randomUUID();
        try {
          await clerk.users.updateUserMetadata(clerkUserId, {
            privateMetadata: { pendingApiKey: rawKey, pendingKeyId: keyId, pendingKeyScopes: scopes, liansTier: tier },
          });
          log('webhook_user_created', req, null, { clerkUserId, tier });
        } catch (err) { log('webhook_metadata_failed', req, null, { error: err.message, clerkUserId }); }
      }

      if (event.type === 'user.updated') {
        const newTier = event.data.public_metadata?.plan ?? 'free';
        try {
          const clerkUser = await clerk.users.getUser(clerkUserId);
          const currentTier = clerkUser.privateMetadata?.liansTier;
          if (currentTier === newTier) return json(res, 200, { ok: true });
          const scopes = TIER_SCOPES[newTier] ?? TIER_SCOPES.free;
          const rawKey = `lians_live_${crypto.randomBytes(32).toString('hex')}`;
          const keyId = crypto.randomUUID();
          // Revoke the old key in the store
          const oldKeyId = clerkUser.privateMetadata?.liansKeyId;
          if (oldKeyId) { const store = readStore(); const old = store.apiKeys.find((k) => k.id === oldKeyId); if (old) { old.revokedAt = new Date().toISOString(); writeStore(store); } }
          await clerk.users.updateUserMetadata(clerkUserId, {
            privateMetadata: { ...clerkUser.privateMetadata, pendingApiKey: rawKey, pendingKeyId: keyId, pendingKeyScopes: scopes, liansTier: newTier },
          });
          log('webhook_tier_changed', req, null, { clerkUserId, from: currentTier, to: newTier });
        } catch (err) { log('webhook_tier_change_failed', req, null, { error: err.message, clerkUserId }); }
      }

      return json(res, 200, { ok: true });
    }

    // Best-effort, site-wide flood protection (per IP, per server instance) for
    // every page and asset request. The stricter per-IP API limit still applies
    // below. (On serverless this is per-instance; pair with the platform WAF.)
    if (!rateLimit(req, res, { max: 300, windowMs: 60_000, bucket: 'all' })) return;

    // Block cross-origin requests to the API.
    // Allow both apex and www so a misconfigured BASE_URL env var never locks
    // out the live site (e.g. BASE_URL=https://lians.ai while serving www.lians.ai).
    if (pathname.startsWith('/api/')) {
      const origin = req.headers.origin;
      if (origin && !allowedApiOrigins(req).has(origin)) { log('cors_blocked', req, null, { origin }); return json(res, 403, { error: 'Forbidden.' }); }
      if (!rateLimit(req, res, { max: 60, windowMs: 60_000 })) return;
    }

    // Public config for client-side SDK initialisation (publishable keys only)
    if (pathname === '/config.js') {
      res.setHeader('content-type', 'application/javascript; charset=utf-8');
      res.writeHead(200);
      res.end(`window.__lian_config=${JSON.stringify({ clerkPublishableKey: process.env.CLERK_PUBLISHABLE_KEY || '', clerkJsUrl, clerkJsFallbackUrl, canonicalOrigin: baseUrl, billingPlans: { free: process.env.CLERK_BILLING_PLAN_ID_FREE || '', starter: process.env.CLERK_BILLING_PLAN_ID_STARTER || '', growth: process.env.CLERK_BILLING_PLAN_ID_GROWTH || '', pro: process.env.CLERK_BILLING_PLAN_ID_PRO || '', enterprise: process.env.CLERK_BILLING_PLAN_ID_ENTERPRISE || '' } })};`);
      return;
    }

    // Page routes — serve the SPA shell; client-side Clerk drives all routing.
    // Never gate HTML delivery on the session cookie: Clerk sets the cookie
    // asynchronously after OAuth and a cookie-miss here causes a redirect loop.
    // Auth is enforced on every /api/* route instead.
    if (pathname === '/auth/google' || pathname === '/auth/github') return redirect(res, '/login');
    if (pathname === '/memory-governor') return serveFile(res, path.join(root, 'memory-governor.html'));
    if (pathname === '/memory-governor.html') return redirect(res, '/memory-governor');

    // Marketing content pages — pretty URLs mapped to their static .html.
    // Keep this in sync with vercel.json routes.
    const CONTENT_PAGES = {
      '/product': 'product.html',
      '/compliance': 'compliance.html',
      '/security': 'security.html',
      '/sdks': 'sdks.html',
      '/compare': 'compare.html',
      '/pricing': 'pricing.html',
      '/docs': 'docs.html',
      '/solutions': 'solutions.html',
      '/solutions/financial-services': 'solutions-financial-services.html',
      '/solutions/healthcare': 'solutions-healthcare.html',
      '/solutions/legal': 'solutions-legal.html',
    };
    if (CONTENT_PAGES[pathname]) return serveFile(res, path.join(root, CONTENT_PAGES[pathname]));
    if (pathname.endsWith('.html')) {
      const pretty = Object.entries(CONTENT_PAGES).find(([, file]) => `/${file}` === pathname)?.[0];
      if (pretty) return redirect(res, pretty);
    }

    if (pathname === '/login' || pathname === '/sso-callback') return serveFile(res, path.join(root, 'app.html'));
    if (pathname === '/onboarding' || pathname.startsWith('/onboarding/')) return serveFile(res, path.join(root, 'app.html'));
    if (pathname === '/billing') return serveFile(res, path.join(root, 'app.html'));
    if (pathname === '/upgrade') return serveFile(res, path.join(root, 'app.html'));
    if (pathname === '/console' || pathname.startsWith('/console/')) return serveFile(res, path.join(root, 'app.html'));

    // Logout (Clerk handles the actual session; this just redirects)
    if (pathname === '/logout' && req.method === 'POST') { return redirect(res, '/login'); }

    // ── JSON API ──────────────────────────────────────────────────────────────

    if (pathname === '/api/logout' && req.method === 'POST') {
      const expiredCookies = ['__session', '__client_uat'].flatMap((name) => [
        `${name}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`,
        `${name}=; Max-Age=0; Path=/; Domain=.lians.ai; HttpOnly; Secure; SameSite=Lax`,
      ]);
      res.setHeader('set-cookie', expiredCookies);
      return json(res, 200, { ok: true });
    }

    if (pathname === '/api/health' && req.method === 'GET') {
      return json(res, 200, {
        ok: true,
        build: APP_BUILD,
        environment: process.env.VERCEL ? 'vercel' : (process.env.NODE_ENV || 'local'),
        clerkPublishableKeyConfigured: Boolean(process.env.CLERK_PUBLISHABLE_KEY),
        clerkSecretKeyConfigured: Boolean(process.env.CLERK_SECRET_KEY),
        workflow: 'login->onboarding->console',
      });
    }

    if (pathname === '/api/session' && req.method === 'GET') {
      const user = await userFor(req);
      const complete = hasCompletedOnboarding(user);
      return json(res, 200, {
        authenticated: Boolean(user),
        user: user && { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl, onboardingComplete: complete, completedAt: completionTimestamp(user), billingPlan: user.billingPlan || null },
        next: user ? (!complete ? `/onboarding/${firstIncomplete(user)}` : '/console') : '/login',
      });
    }

    // Onboarding
    if (pathname === '/api/onboarding' && req.method === 'GET') { const user = await apiAuth(req, res); if (!user) return; const complete = hasCompletedOnboarding(user); return json(res, 200, { answers: readStore().onboarding[user.id] || {}, onboardingComplete: complete, nextStep: complete ? null : firstIncomplete(user) }); }
    if (pathname.startsWith('/api/onboarding/') && pathname !== '/api/onboarding/complete' && req.method === 'POST') { const user = await apiAuth(req, res); if (!user) return; const step = pathname.split('/').pop(); if (!validSteps.includes(step)) return json(res, 404, { error: 'Unknown onboarding step.' }); const expected = firstIncomplete(user); if (step !== expected) return json(res, 409, { error: `Complete ${expected} first.`, next: `/onboarding/${expected}` }); const body = await readBody(req); const value = step === 'context' ? String(body.value || '') : String(body.value || '').trim(); if (requiredSteps.includes(step) && !value) return json(res, 400, { error: 'Choose an option to continue.' }); const store = readStore(); store.onboarding[user.id] = { ...(store.onboarding[user.id] || {}), [step]: value, updatedAt: new Date().toISOString() }; writeStore(store); const next = nextStep(step); log('onboarding_step_saved', req, user, { step, next }); try { const cu = await clerk.users.getUser(user.clerkUserId); await clerk.users.updateUserMetadata(user.clerkUserId, { privateMetadata: { ...cu.privateMetadata, onboardingAnswers: { ...store.onboarding[user.id] } } }); } catch (err) { log('clerk_answers_backup_failed', req, user, { error: err.message }); } return json(res, 200, { next: `/onboarding/${next}` }); }
    if (pathname === '/api/onboarding/complete' && req.method === 'POST') { const user = await apiAuth(req, res); if (!user) return; const missing = firstIncomplete(user); if (missing !== 'review') return json(res, 409, { error: 'Required onboarding steps are incomplete.', next: `/onboarding/${missing}` }); const store = readStore(); const answers = store.onboarding[user.id] || {}; if (!requiredSteps.every((step) => answers[step])) return json(res, 409, { error: 'Required onboarding steps are incomplete.' }); const target = store.users.find((item) => item.id === user.id); target.onboardingComplete = true; const completedAt = new Date().toISOString(); target.onboardingCompletedAt = completedAt; store.onboarding[user.id] = { ...answers, completedAt }; writeStore(store); log('onboarding_completed', req, target); try { const cu = await clerk.users.getUser(user.clerkUserId); await clerk.users.updateUserMetadata(user.clerkUserId, { privateMetadata: { ...cu.privateMetadata, onboardingComplete: true, onboardingCompletedAt: completedAt, onboardingAnswers: store.onboarding[user.id] } }); } catch (err) { log('clerk_complete_sync_failed', req, user, { error: err.message }); } return json(res, 200, { next: '/console' }); }
    if (pathname === '/api/billing/select' && req.method === 'POST') { const user = await apiAuth(req, res); if (!user) return; if (!hasCompletedOnboarding(user)) return json(res, 403, { error: 'Complete onboarding before selecting a plan.' }); const body = await readBody(req); const plan = String(body.plan || '').toLowerCase(); if (!['free', 'starter', 'growth', 'pro', 'enterprise'].includes(plan)) return json(res, 400, { error: 'Invalid plan.' }); if (plan !== 'free') { try { const sub = await clerk.users.getUserBillingSubscription(user.clerkUserId); const clerkPlan = sub?.data?.plan?.slug; if (!clerkPlan || clerkPlan === 'free') return json(res, 403, { error: 'No active paid subscription found. Please complete checkout.' }); } catch (err) { log('billing_select_verify_warning', req, user, { error: err.message, plan }); return json(res, 503, { error: 'Unable to verify subscription status. Please try again.' }); } } const store = readStore(); const target = store.users.find((item) => item.id === user.id); target.billingPlan = plan; target.billingSelectedAt = new Date().toISOString(); writeStore(store); log('billing_plan_selected', req, target, { plan }); try { const cu = await clerk.users.getUser(user.clerkUserId); await clerk.users.updateUserMetadata(user.clerkUserId, { privateMetadata: { ...cu.privateMetadata, billingPlan: plan, billingSelectedAt: target.billingSelectedAt } }); } catch (err) { log('billing_metadata_sync_failed', req, user, { error: err.message }); } return json(res, 200, { next: '/console', plan }); }
    if (pathname === '/api/billing/sync' && req.method === 'POST') { const user = await apiAuth(req, res); if (!user) return; if (!hasCompletedOnboarding(user)) return json(res, 403, { error: 'Complete onboarding first.' }); try { const sub = await clerk.users.getUserBillingSubscription(user.clerkUserId); const planSlug = sub?.data?.plan?.slug; if (!planSlug || planSlug === 'free') return json(res, 402, { error: 'No active paid subscription found. Please complete checkout.' }); const store = readStore(); const target = store.users.find((item) => item.id === user.id); if (target) { target.billingPlan = planSlug; target.billingUpdatedAt = new Date().toISOString(); writeStore(store); } try { const cu = await clerk.users.getUser(user.clerkUserId); await clerk.users.updateUserMetadata(user.clerkUserId, { privateMetadata: { ...cu.privateMetadata, billingPlan: planSlug } }); } catch (err) { log('billing_sync_metadata_failed', req, user, { error: err.message }); } log('billing_synced', req, user, { plan: planSlug }); return json(res, 200, { plan: planSlug, next: '/console' }); } catch (err) { log('billing_sync_failed', req, user, { error: err.message }); return json(res, 500, { error: 'Unable to sync billing status. Please refresh and try again.' }); } }

    // API keys
    if (pathname === '/api/keys' && req.method === 'GET') {
      const user = await apiOnboarding(req, res); if (!user) return;
      const keys = readStore().apiKeys.filter((key) => key.userId === user.id).map(({ hashedKey, ...key }) => key);
      // Check for one-time pending key from Clerk webhook provisioning
      let freshKey = null;
      try {
        const clerkUser = await clerk.users.getUser(user.clerkUserId);
        const pending = clerkUser.privateMetadata?.pendingApiKey;
        if (pending) {
          const keyId = clerkUser.privateMetadata?.pendingKeyId || crypto.randomUUID();
          const scopes = clerkUser.privateMetadata?.pendingKeyScopes || TIER_SCOPES.free;
          const tier = clerkUser.privateMetadata?.liansTier || 'free';
          // Materialise the key into the store
          const store = readStore();
          const existing = store.apiKeys.find((k) => k.id === keyId);
          if (!existing) {
            const keyRecord = { id: keyId, userId: user.id, label: 'Default', prefix: `${pending.slice(0, 18)}…`, hashedKey: sha256(pending), scopes, createdAt: new Date().toISOString(), lastUsedAt: null, revokedAt: null };
            store.apiKeys.unshift(keyRecord);
            writeStore(store);
            const { hashedKey, ...safeKey } = keyRecord;
            keys.unshift(safeKey);
          }
          // Clear the pending key from Clerk metadata — never reveal again
          await clerk.users.updateUserMetadata(user.clerkUserId, {
            privateMetadata: { ...clerkUser.privateMetadata, pendingApiKey: null, pendingKeyId: null, pendingKeyScopes: null, liansKeyId: keyId, liansTier: tier },
          });
          freshKey = { id: keyId, rawKey: pending };
          log('api_key_revealed', req, user, { keyId });
        }
      } catch (err) { log('pending_key_check_failed', req, user, { error: err.message }); }
      return json(res, 200, { keys, freshKey });
    }
    if (pathname === '/api/keys' && req.method === 'POST') { const user = await apiOnboarding(req, res); if (!user) return; const { label, environment = 'live' } = await readBody(req); if (!label?.trim()) return json(res, 400, { error: 'A key label is required.' }); const rawKey = `lian_${environment === 'test' ? 'test' : 'live'}_${crypto.randomBytes(32).toString('hex')}`; const key = { id: crypto.randomUUID(), userId: user.id, label: label.trim(), prefix: `${rawKey.slice(0, 18)}…`, hashedKey: sha256(rawKey), createdAt: new Date().toISOString(), lastUsedAt: null, revokedAt: null }; const store = readStore(); store.apiKeys.unshift(key); writeStore(store); const { hashedKey, ...safeKey } = key; log('api_key_created', req, user, { prefix: key.prefix, environment }); return json(res, 201, { key: safeKey, rawKey }); }
    if (pathname.match(/^\/api\/keys\/[^/]+\/rotate$/) && req.method === 'POST') {
      const user = await apiOnboarding(req, res); if (!user) return;
      const id = pathname.split('/')[3];
      const store = readStore();
      const old = store.apiKeys.find((k) => k.id === id && k.userId === user.id);
      if (!old || old.revokedAt) return json(res, 404, { error: 'Key not found.' });
      old.revokedAt = new Date().toISOString();
      const rawKey = `lians_live_${crypto.randomBytes(32).toString('hex')}`;
      const newKey = { id: crypto.randomUUID(), userId: user.id, label: old.label, prefix: `${rawKey.slice(0, 18)}…`, hashedKey: sha256(rawKey), scopes: old.scopes || TIER_SCOPES.free, createdAt: new Date().toISOString(), lastUsedAt: null, revokedAt: null };
      store.apiKeys.unshift(newKey);
      writeStore(store);
      // Update liansKeyId in Clerk so future rotations find the right key
      try { const clerkUser = await clerk.users.getUser(user.clerkUserId); await clerk.users.updateUserMetadata(user.clerkUserId, { privateMetadata: { ...clerkUser.privateMetadata, liansKeyId: newKey.id } }); } catch (err) { log('rotate_metadata_update_failed', req, user, { error: err.message }); }
      const { hashedKey, ...safeKey } = newKey;
      log('api_key_rotated', req, user, { oldId: id, newPrefix: newKey.prefix });
      return json(res, 200, { key: safeKey, rawKey });
    }
    if (pathname.startsWith('/api/keys/') && req.method === 'DELETE') { const user = await apiOnboarding(req, res); if (!user) return; const id = pathname.split('/').pop(); const store = readStore(); const key = store.apiKeys.find((item) => item.id === id && item.userId === user.id); if (!key) return json(res, 404, { error: 'Key not found.' }); key.revokedAt = new Date().toISOString(); writeStore(store); log('api_key_deleted', req, user, { prefix: key.prefix }); return json(res, 200, { ok: true }); }

    // ── Projects (per-user, persisted in the store + mirrored to Clerk) ───────
    if (pathname.startsWith('/api/projects')) {
      const user = await apiOnboarding(req, res); if (!user) return;
      const store = readStore();
      store.projects = store.projects || {};
      // Ensure the user has a projects record; restore from Clerk metadata or seed a default.
      const existing = store.projects[user.id];
      if (!existing || !Array.isArray(existing.items) || !existing.items.length) {
        let restored = null;
        try {
          const cu = await clerk.users.getUser(user.clerkUserId);
          if (Array.isArray(cu.privateMetadata?.projects) && cu.privateMetadata.projects.length) {
            restored = { items: cu.privateMetadata.projects, current: cu.privateMetadata.currentProjectId || cu.privateMetadata.projects[0].id };
          }
        } catch {}
        store.projects[user.id] = restored || { items: [{ id: crypto.randomUUID(), name: 'default-project', createdAt: new Date().toISOString() }], current: null };
        if (!store.projects[user.id].current) store.projects[user.id].current = store.projects[user.id].items[0].id;
        writeStore(store);
      }
      const rec = store.projects[user.id];
      const persist = async () => {
        writeStore(store);
        try { const cu = await clerk.users.getUser(user.clerkUserId); await clerk.users.updateUserMetadata(user.clerkUserId, { privateMetadata: { ...cu.privateMetadata, projects: rec.items, currentProjectId: rec.current } }); }
        catch (err) { log('projects_mirror_failed', req, user, { error: err.message }); }
      };
      const reply = () => json(res, 200, { projects: rec.items, currentProjectId: rec.current });

      if (pathname === '/api/projects' && req.method === 'GET') return reply();
      if (pathname === '/api/projects' && req.method === 'POST') {
        const body = await readBody(req); const name = String(body.name || '').trim().slice(0, 60);
        if (!name) return json(res, 400, { error: 'A project name is required.' });
        const project = { id: crypto.randomUUID(), name, createdAt: new Date().toISOString() };
        rec.items.unshift(project); rec.current = project.id; await persist();
        log('project_created', req, user, { id: project.id }); return reply();
      }
      if (pathname === '/api/projects/select' && req.method === 'POST') {
        const body = await readBody(req); const id = String(body.id || '');
        if (!rec.items.some((p) => p.id === id)) return json(res, 404, { error: 'Project not found.' });
        rec.current = id; await persist(); return reply();
      }
      const idMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
      if (idMatch && req.method === 'PATCH') {
        const target = rec.items.find((p) => p.id === idMatch[1]);
        if (!target) return json(res, 404, { error: 'Project not found.' });
        const body = await readBody(req); const name = String(body.name || '').trim().slice(0, 60);
        if (!name) return json(res, 400, { error: 'A project name is required.' });
        target.name = name; await persist(); log('project_renamed', req, user, { id: target.id }); return reply();
      }
      if (idMatch && req.method === 'DELETE') {
        if (rec.items.length <= 1) return json(res, 400, { error: 'You must keep at least one project.' });
        if (!rec.items.some((p) => p.id === idMatch[1])) return json(res, 404, { error: 'Project not found.' });
        rec.items = rec.items.filter((p) => p.id !== idMatch[1]);
        if (rec.current === idMatch[1]) rec.current = rec.items[0].id;
        await persist(); log('project_deleted', req, user, { id: idMatch[1] }); return reply();
      }
      return json(res, 404, { error: 'Unknown project route.' });
    }

    // Playground demo (uses lian-sdk when available, falls back to fixture)
    if (pathname === '/api/demo/recall' && req.method === 'POST') {
      const user = await userFor(req); if (!user) return json(res, 401, { error: 'Authentication required.' });
      try {
        const { LianClient } = require('lian-sdk');
        const client = new LianClient({ apiKey: process.env.LIANS_API_KEY, baseUrl });
        const result = await client.recall({ agentId: 'demo', query: 'NVDA guidance', asOf: '2025-03-01' });
        return json(res, 200, result);
      } catch {
        return json(res, 200, { value: '$32B', validOn: '2025-03-01', content: 'NVDA FY2026 revenue guidance revised to $32B on February 20, 2025. Superseded by the May update.', audit: 'Validity window verified and recall event logged.' });
      }
    }

    // ── Billing (Clerk) ───────────────────────────────────────────────────────
    // Plan state lives in Clerk's publicMetadata. Checkout and portal are
    // handled entirely on the client via the Clerk JS SDK.

    if (pathname === '/api/billing' && req.method === 'GET') {
      const user = await apiAuth(req, res); if (!user) return;
      try {
        const sub = await clerk.users.getUserBillingSubscription(user.clerkUserId);
        const planSlug = sub?.data?.plan?.slug || 'free';
        const features = (sub?.data?.features || []).map((f) => f.key);
        const scopes = TIER_SCOPES[planSlug] || TIER_SCOPES.free;
        return json(res, 200, { plan: planSlug, features, scopes, email: user.email });
      } catch (err) {
        log('clerk_billing_fetch_failed', req, user, { error: err.message });
        return json(res, 200, { plan: 'free', features: [], scopes: TIER_SCOPES.free, email: user.email });
      }
    }

    // Static files
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
    const file = path.resolve(root, relative);
    if (!file.startsWith(root)) return json(res, 403, { error: 'Forbidden' });
    return serveFile(res, file);
  } catch (error) { log('server_error', req, null, { message: error.message, stack: error.stack }); return json(res, 500, { error: 'Unexpected server error.' }); }
};

module.exports = app;

if (require.main === module) {
  http.createServer(app).listen(port, () => console.log(`Lians server running at ${baseUrl}`));
}

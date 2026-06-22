const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  });
}
const port = Number(process.env.PORT || 8000);
const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
const dataDir = path.join(root, 'data');
const dataFile = path.join(dataDir, 'lian-console.json');
const sessions = new Map();
const oauthStates = new Map();

const readStore = () => {
  try { return JSON.parse(fs.readFileSync(dataFile, 'utf8')); } catch { return { apiKeys: [] }; }
};
const writeStore = (store) => {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify(store, null, 2));
};
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve, reject) => { let body = ''; req.on('data', (chunk) => { body += chunk; if (body.length > 1_000_000) req.destroy(); }); req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(error); } }); });
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map((part) => { const [key, ...value] = part.trim().split('='); return [key, decodeURIComponent(value.join('='))]; }));
const fetchJson = (url, options = {}) => new Promise((resolve, reject) => {
  const request = https.request(url, options, (response) => { let body = ''; response.on('data', (chunk) => { body += chunk; }); response.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid OAuth provider response')); } }); });
  request.on('error', reject); if (options.body) request.write(options.body); request.end();
});
const htmlError = (res, title, message) => { res.writeHead(503, { 'content-type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><title>${title}</title><style>body{font:16px system-ui;background:#152225;color:#f6f4ee;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:560px;padding:32px}code{background:#263438;padding:3px 6px}</style><main><h1>${title}</h1><p>${message}</p><p><a href="/app.html" style="color:#d7ff3f">Return to Lian Console</a></p></main>`); };
const createSession = (res, user) => { const id = crypto.randomBytes(32).toString('hex'); sessions.set(id, { ...user, createdAt: new Date().toISOString() }); res.setHeader('set-cookie', `lian_session=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`); };
const sessionFor = (req) => sessions.get(cookies(req).lian_session);
const requireSession = (req, res) => { const session = sessionFor(req); if (!session) { res.writeHead(302, { location: '/login' }); res.end(); return null; } return session; };
const oauthConfig = (provider) => provider === 'github' ? { clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET, authorize: 'https://github.com/login/oauth/authorize', token: 'https://github.com/login/oauth/access_token', user: 'https://api.github.com/user', scope: 'read:user user:email' } : { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', user: 'https://openidconnect.googleapis.com/v1/userinfo', scope: 'openid email profile' };

const serveFile = (res, filename) => {
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
  fs.readFile(filename, (error, content) => { if (error) { res.writeHead(404); res.end('Not found'); return; } res.writeHead(200, { 'content-type': types[path.extname(filename)] || 'application/octet-stream' }); res.end(content); });
};

http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, baseUrl);
  const pathname = requestUrl.pathname;
  try {
    if (pathname === '/api/onboarding' && req.method === 'POST') { const session = sessionFor(req); if (!session) return json(res, 401, { error: 'Sign in is required.' }); const intake = await readBody(req); if (!intake.workspace?.trim()) return json(res, 400, { error: 'A workspace name is required.' }); const store = readStore(); store.workspaces = store.workspaces || {}; store.workspaces[session.email || session.name] = { ...intake, completedAt: new Date().toISOString() }; writeStore(store); return json(res, 201, { workspace: intake.workspace.trim() }); }
    if (pathname === '/api/logout' && req.method === 'POST') { sessions.delete(cookies(req).lian_session); res.setHeader('set-cookie', 'lian_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'); return json(res, 200, { ok: true }); }
    if (pathname === '/api/keys' && req.method === 'GET') { if (!sessionFor(req)) return json(res, 401, { error: 'Sign in is required.' }); const keys = readStore().apiKeys.map(({ keyHash, ...key }) => key); return json(res, 200, { keys }); }
    if (pathname === '/api/keys' && req.method === 'POST') { if (!sessionFor(req)) return json(res, 401, { error: 'Sign in is required.' }); const { name } = await readBody(req); if (!name || !name.trim()) return json(res, 400, { error: 'A key name is required.' }); const secret = `lian_live_${crypto.randomBytes(24).toString('base64url')}`; const key = { id: crypto.randomUUID(), name: name.trim(), prefix: `${secret.slice(0, 15)}…`, keyHash: sha256(secret), createdAt: new Date().toISOString(), lastUsedAt: null, revokedAt: null }; const store = readStore(); store.apiKeys.unshift(key); writeStore(store); const { keyHash, ...safeKey } = key; return json(res, 201, { key: safeKey, secret }); }
    if (pathname.startsWith('/api/keys/') && req.method === 'DELETE') { if (!sessionFor(req)) return json(res, 401, { error: 'Sign in is required.' }); const id = pathname.split('/').pop(); const store = readStore(); const key = store.apiKeys.find((item) => item.id === id); if (!key) return json(res, 404, { error: 'Key not found.' }); key.revokedAt = new Date().toISOString(); writeStore(store); return json(res, 200, { key: { id: key.id, revokedAt: key.revokedAt } }); }
    if (pathname === '/api/validate-key' && req.method === 'POST') { const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, ''); const store = readStore(); const key = store.apiKeys.find((item) => item.keyHash === sha256(token) && !item.revokedAt); if (!key) return json(res, 401, { valid: false }); key.lastUsedAt = new Date().toISOString(); writeStore(store); return json(res, 200, { valid: true, key: { id: key.id, name: key.name } }); }
    if (pathname === '/api/demo/recall' && req.method === 'POST') return json(res, 200, { value: '$32B', validOn: '2025-03-01', content: 'NVDA FY2026 revenue guidance revised to $32B on February 20, 2025. Superseded by the May update.', audit: 'Validity window verified and recall event logged.' });
    if (pathname.startsWith('/auth/') && !pathname.endsWith('/callback')) { const provider = pathname.split('/').pop(); const config = oauthConfig(provider); if (!config.clientId || !config.clientSecret) return htmlError(res, `${provider === 'github' ? 'GitHub' : 'Google'} sign-in needs to be connected`, 'This is a real OAuth route. Add the provider credentials to the server environment before users can authenticate.'); const state = crypto.randomBytes(24).toString('hex'); oauthStates.set(state, { provider, expires: Date.now() + 600_000 }); const callback = `${baseUrl}/auth/${provider}/callback`; const params = new URLSearchParams({ client_id: config.clientId, redirect_uri: callback, response_type: 'code', scope: config.scope, state }); res.writeHead(302, { location: `${config.authorize}?${params}` }); return res.end(); }
    if (pathname.startsWith('/auth/') && pathname.endsWith('/callback')) { const provider = pathname.split('/')[2]; const state = requestUrl.searchParams.get('state'); const code = requestUrl.searchParams.get('code'); const saved = oauthStates.get(state); oauthStates.delete(state); if (!saved || saved.provider !== provider || saved.expires < Date.now() || !code) return htmlError(res, 'Sign-in could not be verified', 'Please start again from the Lian Console.'); const config = oauthConfig(provider); const callback = `${baseUrl}/auth/${provider}/callback`; const tokenBody = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: callback, grant_type: 'authorization_code' }).toString(); const token = await fetchJson(config.token, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(tokenBody) }, body: tokenBody }); const profile = await fetchJson(config.user, { headers: { authorization: `Bearer ${token.access_token}`, 'user-agent': 'Lian-Console' } }); createSession(res, { provider, email: profile.email || '', name: profile.name || profile.login || 'Lian user' }); res.writeHead(302, { location: '/onboarding' }); return res.end(); }
    if (pathname === '/api/session') { const session = sessions.get(cookies(req).lian_session); return json(res, 200, { authenticated: Boolean(session), user: session || null }); }
    if (pathname === '/login') return serveFile(res, path.join(root, 'app.html'));
    if (pathname === '/onboarding') { if (!requireSession(req, res)) return; return serveFile(res, path.join(root, 'app.html')); }
    if (pathname.startsWith('/console/')) { if (!requireSession(req, res)) return; return serveFile(res, path.join(root, 'app.html')); }
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
    const file = path.resolve(root, relative); if (!file.startsWith(root)) return json(res, 403, { error: 'Forbidden' }); return serveFile(res, file);
  } catch (error) { console.error(error); return json(res, 500, { error: 'Unexpected server error.' }); }
}).listen(port, () => console.log(`Lian website and local API running at ${baseUrl}`));

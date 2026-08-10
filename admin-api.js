'use strict';

const crypto = require('node:crypto');
const { ROLES, PERMISSIONS, hasPermission, canManageTarget } = require('./admin-auth');

const parsePage = (url, defaultLimit = 25) => ({
  limit: Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('limit') || defaultLimit, 10) || defaultLimit)),
  offset: Math.max(0, Number.parseInt(url.searchParams.get('offset') || '0', 10) || 0),
});
const publicActor = (actor) => ({ id: actor.id, name: actor.name, email: actor.email, role: actor.role, permissions: [...(require('./admin-auth').ROLE_PERMISSIONS[actor.role] || [])] });

const createAdminApi = ({ enabled, authenticate, store, readBody, json, listKeys, revokeKey, systemStatus }) => {
  const actorFor = async (req, res, permission) => {
    if (!enabled()) { json(res, 404, { error: 'Not found.' }); return null; }
    const websiteUser = await authenticate(req);
    if (!websiteUser) { json(res, 401, { error: 'Authentication required.' }); return null; }
    if (!store.configured()) { json(res, 503, { error: 'Admin Console database is not configured.' }); return null; }
    await store.syncUser(websiteUser);
    const stableId = websiteUser.clerkUserId || websiteUser.providerUserId;
    const actor = await store.getByClerkId(stableId);
    if (!actor || actor.accountStatus !== 'ACTIVE' || actor.role === ROLES.MEMBER) { json(res, 403, { error: 'Admin access denied.' }); return null; }
    if (permission && !hasPermission(actor.role, permission)) { json(res, 403, { error: 'Permission denied.' }); return null; }
    return actor;
  };
  const handle = async (req, res, url) => {
    const path = url.pathname;
    if (!path.startsWith('/api/admin/')) return false;
    const requestId = String(req.headers['x-request-id'] || crypto.randomUUID()).slice(0, 128);
    res.setHeader('x-request-id', requestId);

    if (path === '/api/admin/session' && req.method === 'GET') {
      const actor = await actorFor(req, res); if (!actor) return true;
      json(res, 200, { user: publicActor(actor) }); return true;
    }
    if (path === '/api/admin/overview' && req.method === 'GET') {
      const actor = await actorFor(req, res, PERMISSIONS.OPERATIONAL_READ); if (!actor) return true;
      const [counts, audit, keys] = await Promise.all([store.counts(), store.listAudit({ limit: 8, offset: 0 }), hasPermission(actor.role, PERMISSIONS.API_KEY_READ) ? listKeys({ limit: 100, offset: 0 }) : { keys: [], total: null, available: false }]);
      json(res, 200, { counts: { totalUsers: counts.total_users, onboardedUsers: counts.onboarded_users, onboardingLast24h: counts.onboarding_last_24h, activeApiKeys: keys.available === false ? null : keys.keys.filter((k) => k.status === 'ACTIVE').length }, recentActivity: audit.events }); return true;
    }
    if (path === '/api/admin/users' && req.method === 'GET') {
      const actor = await actorFor(req, res, PERMISSIONS.USER_READ); if (!actor) return true;
      const page = parsePage(url); const result = await store.listUsers({ ...page, search: String(url.searchParams.get('search') || '').slice(0, 120) });
      json(res, 200, { ...result, ...page }); return true;
    }
    const userMatch = path.match(/^\/api\/admin\/users\/([0-9a-f-]+)(?:\/(status|role))?$/i);
    if (userMatch && req.method === 'GET' && !userMatch[2]) {
      const actor = await actorFor(req, res, PERMISSIONS.USER_READ); if (!actor) return true;
      const user = await store.getUser(userMatch[1]); if (!user) { json(res, 404, { error: 'User not found.' }); return true; }
      json(res, 200, { user }); return true;
    }
    if (userMatch && req.method === 'PATCH' && userMatch[2] === 'status') {
      const actor = await actorFor(req, res, PERMISSIONS.USER_STATUS_WRITE); if (!actor) return true;
      const target = await store.getUser(userMatch[1]); if (!target) { json(res, 404, { error: 'User not found.' }); return true; }
      const body = await readBody(req); const status = String(body.status || '').toUpperCase();
      if (!['ACTIVE', 'DISABLED'].includes(status)) { json(res, 400, { error: 'Invalid account status.' }); return true; }
      if (!canManageTarget({ actor, target, operation: 'status' })) { json(res, 403, { error: 'Target account is protected.' }); return true; }
      if (target.role === ROLES.OWNER && status === 'DISABLED' && await store.countOwners() <= 1) { json(res, 409, { error: 'The last active OWNER cannot be disabled.' }); return true; }
      const result = await store.setStatus({ actor, target, status, requestId }); json(res, 200, { user: result.user }); return true;
    }
    if (userMatch && req.method === 'PATCH' && userMatch[2] === 'role') {
      const actor = await actorFor(req, res, PERMISSIONS.ROLE_MANAGE); if (!actor) return true;
      const target = await store.getUser(userMatch[1]); if (!target) { json(res, 404, { error: 'User not found.' }); return true; }
      const body = await readBody(req); const role = String(body.role || '').toUpperCase();
      if (!Object.values(ROLES).includes(role)) { json(res, 400, { error: 'Invalid role.' }); return true; }
      if (!canManageTarget({ actor, target, operation: 'role', nextRole: role })) { json(res, 403, { error: 'Target account or role change is protected.' }); return true; }
      if (target.role === ROLES.OWNER && role !== ROLES.OWNER && await store.countOwners() <= 1) { json(res, 409, { error: 'The last active OWNER cannot be removed.' }); return true; }
      const result = await store.setRole({ actor, target, role, requestId }); json(res, 200, { user: result.user }); return true;
    }
    if (path === '/api/admin/api-keys' && req.method === 'GET') {
      const actor = await actorFor(req, res, PERMISSIONS.API_KEY_READ); if (!actor) return true;
      const page = parsePage(url, 50); json(res, 200, await listKeys(page)); return true;
    }
    const keyMatch = path.match(/^\/api\/admin\/api-keys\/([^/]+)\/revoke$/);
    if (keyMatch && req.method === 'POST') {
      const actor = await actorFor(req, res, PERMISSIONS.API_KEY_REVOKE); if (!actor) return true;
      const target = await revokeKey(decodeURIComponent(keyMatch[1]));
      if (!target) { json(res, 404, { error: 'API key not found.' }); return true; }
      await store.writeAudit({ actor, action: 'API_KEY_REVOKED', targetType: 'api_key', targetId: target.id, beforeState: { status: 'ACTIVE', ownerUserId: target.ownerUserId }, afterState: { status: 'REVOKED', ownerUserId: target.ownerUserId }, requestId });
      json(res, 200, { ok: true }); return true;
    }
    if (path === '/api/admin/audit' && req.method === 'GET') {
      const actor = await actorFor(req, res, PERMISSIONS.AUDIT_READ); if (!actor) return true;
      const page = parsePage(url, 50); json(res, 200, { ...(await store.listAudit(page)), ...page }); return true;
    }
    if (path === '/api/admin/system' && req.method === 'GET') {
      const actor = await actorFor(req, res, PERMISSIONS.SYSTEM_READ); if (!actor) return true;
      json(res, 200, await systemStatus()); return true;
    }
    const actor = await actorFor(req, res); if (!actor) return true;
    json(res, 404, { error: 'Unknown admin route.' }); return true;
  };
  return { handle, actorFor };
};

module.exports = { createAdminApi, parsePage, publicActor };

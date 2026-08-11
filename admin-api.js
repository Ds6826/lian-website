'use strict';

const crypto = require('node:crypto');
const { ROLES, PERMISSIONS, hasPermission, canManageTarget } = require('./admin-auth');

const parsePage = (url, defaultLimit = 25) => ({
  limit: Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('limit') || defaultLimit, 10) || defaultLimit)),
  offset: Math.max(0, Number.parseInt(url.searchParams.get('offset') || '0', 10) || 0),
});
const sinceFor = (url) => { const range=url.searchParams.get('range')||'24h'; const ms={ '24h':86400000,'7d':604800000,'30d':2592000000 }[range]||86400000; return new Date(Date.now()-ms).toISOString(); };
const UUID_PATH='([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
const isUuid=(value)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value||''));
const publicActor = (actor) => ({ id: actor.id, name: actor.name, email: actor.email, role: actor.role, permissions: [...(require('./admin-auth').ROLE_PERMISSIONS[actor.role] || [])] });

const createAdminApi = ({ enabled, authenticate, store, readBody, json, listKeys, revokeKey, systemStatus, environmentStatus = async()=>({}), buildInfo = async()=>({}) }) => {
  const actorFor = async (req, res, permission) => {
    if (!enabled()) { json(res, 404, { error: 'Not found.' }); return null; }
    const websiteUser = await authenticate(req);
    if (!websiteUser) { json(res, 401, { error: 'Authentication required.' }); return null; }
    req._liansUserId = websiteUser.id;
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
    const requestId = String(req._requestId || req.headers['x-request-id'] || crypto.randomUUID()).slice(0, 128);
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
      const page = parsePage(url); const result = await store.listUsers({ ...page, search: String(url.searchParams.get('search') || '').slice(0, 120), tag: String(url.searchParams.get('tag') || '').slice(0,40) });
      json(res, 200, { ...result, ...page }); return true;
    }
    const userMatch = path.match(new RegExp(`^/api/admin/users/${UUID_PATH}(?:/(status|role))?$`,'i'));
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
      const page = parsePage(url, 50); const actorFilter=String(url.searchParams.get('actor')||''),filters={search:String(url.searchParams.get('search')||'').slice(0,120),action:String(url.searchParams.get('action')||'').slice(0,80),role:String(url.searchParams.get('role')||'').slice(0,20),actor:actorFilter,target:String(url.searchParams.get('target')||'').slice(0,120),outcome:String(url.searchParams.get('outcome')||'').slice(0,20),since:url.searchParams.has('range')?sinceFor(url):'1970-01-01T00:00:00.000Z'};if(actorFilter&&!isUuid(actorFilter)){json(res,400,{error:'Invalid actor ID.'});return true} json(res, 200, { ...(await store.listAudit({...page,...filters})), ...page }); return true;
    }
    if (path === '/api/admin/system' && req.method === 'GET') {
      const actor = await actorFor(req, res, PERMISSIONS.SYSTEM_READ); if (!actor) return true;
      json(res, 200, await systemStatus(actor)); return true;
    }
    if (path === '/api/admin/usage' && req.method === 'GET') {
      const actor=await actorFor(req,res,PERMISSIONS.USAGE_READ); if(!actor)return true;
      const userId=String(url.searchParams.get('userId')||'');if(userId&&!isUuid(userId)){json(res,400,{error:'Invalid user ID.'});return true}json(res,200,await store.usage({since:sinceFor(url),userId})); return true;
    }
    if (path === '/api/admin/errors' && req.method === 'GET') {
      const actor=await actorFor(req,res,PERMISSIONS.ERROR_READ); if(!actor)return true; const page=parsePage(url,50);
      json(res,200,{...(await store.listErrors({since:sinceFor(url),category:String(url.searchParams.get('category')||'').slice(0,50),search:String(url.searchParams.get('search')||'').slice(0,120),...page})),...page}); return true;
    }
    if (path === '/api/admin/feature-flags' && req.method === 'GET') {
      const actor=await actorFor(req,res,PERMISSIONS.FLAG_READ); if(!actor)return true;
      json(res,200,{flags:await store.listFlags({search:String(url.searchParams.get('search')||'').slice(0,80)})}); return true;
    }
    if (path === '/api/admin/feature-flags' && req.method === 'POST') {
      const actor=await actorFor(req,res,PERMISSIONS.FLAG_WRITE); if(!actor)return true;
      if(actor.role!==ROLES.OWNER){json(res,403,{error:'Only OWNER can create feature flags.'});return true} const body=await readBody(req); const key=String(body.key||'').trim();
      if(!/^[a-z][a-z0-9_]{1,63}$/.test(key)){json(res,400,{error:'Invalid feature flag key.'});return true} const displayName=String(body.displayName||'').trim().slice(0,100); if(!displayName){json(res,400,{error:'Display name is required.'});return true}
      const flag=await store.saveFlag({actor,key,displayName,description:String(body.description||'').trim().slice(0,500),globalEnabled:Boolean(body.globalEnabled),internalOnly:Boolean(body.internalOnly),requestId});json(res,201,{flag});return true;
    }
    const flagMatch=path.match(new RegExp(`^/api/admin/feature-flags/${UUID_PATH}$`,'i'));
    if(flagMatch&&req.method==='PATCH'){
      const actor=await actorFor(req,res,PERMISSIONS.FLAG_WRITE);if(!actor)return true;const prior=await store.getFlag(flagMatch[1]);if(!prior){json(res,404,{error:'Feature flag not found.'});return true}if(prior.internalOnly&&actor.role!==ROLES.OWNER){json(res,403,{error:'Internal-only flags require OWNER.'});return true}const body=await readBody(req);const flag=await store.saveFlag({actor,id:prior.id,key:prior.key,displayName:String(body.displayName??prior.displayName).trim().slice(0,100),description:String(body.description??prior.description).trim().slice(0,500),globalEnabled:body.globalEnabled===undefined?prior.globalEnabled:Boolean(body.globalEnabled),internalOnly:body.internalOnly===undefined?prior.internalOnly:Boolean(body.internalOnly),requestId});json(res,200,{flag});return true;
    }
    const overrideMatch=path.match(new RegExp(`^/api/admin/feature-flags/${UUID_PATH}/overrides$`,'i'));
    if(overrideMatch&&req.method==='GET'){const actor=await actorFor(req,res,PERMISSIONS.FLAG_READ);if(!actor)return true;json(res,200,{overrides:await store.listFlagOverrides(overrideMatch[1])});return true}
    if(overrideMatch&&req.method==='PUT'){const actor=await actorFor(req,res,PERMISSIONS.FLAG_WRITE);if(!actor)return true;const flag=await store.getFlag(overrideMatch[1]);if(!flag){json(res,404,{error:'Feature flag not found.'});return true}if(flag.internalOnly&&actor.role!==ROLES.OWNER){json(res,403,{error:'Internal-only flags require OWNER.'});return true}const body=await readBody(req);if(!isUuid(body.userId)){json(res,400,{error:'Invalid user ID.'});return true}const target=await store.getUser(String(body.userId));if(!target){json(res,404,{error:'User not found.'});return true}await store.setFlagOverride({actor,flagId:flag.id,userId:target.id,enabled:Boolean(body.enabled),requestId});json(res,200,{ok:true});return true}
    const supportMatch=path.match(new RegExp(`^/api/admin/users/${UUID_PATH}/support$`,'i'));
    if(supportMatch&&req.method==='GET'){const actor=await actorFor(req,res,PERMISSIONS.SUPPORT_READ);if(!actor)return true;const target=await store.getUser(supportMatch[1]);if(!target){json(res,404,{error:'User not found.'});return true}const [keys,usage,errors,tags,limits]=await Promise.all([hasPermission(actor.role,PERMISSIONS.API_KEY_READ)?listKeys({limit:100,offset:0}):{keys:[]},store.usage({since:new Date(Date.now()-604800000).toISOString(),userId:target.id}),store.listErrors({since:new Date(Date.now()-604800000).toISOString(),search:'',category:'',userId:target.id,limit:10,offset:0}),hasPermission(actor.role,PERMISSIONS.TAG_READ)?store.userTags(target.id):[],hasPermission(actor.role,PERMISSIONS.RATE_LIMIT_READ)?store.listRateLimits({userId:target.id}):[]]);json(res,200,{user:target,apiKeys:keys.keys.filter(k=>k.ownerUserId===target.id),usage,errors:errors.events,tags,rateLimits:limits,guardrails:{impersonation:false,sessionsExposed:false,rawEvidenceExposed:false}});return true}
    const notesMatch=path.match(new RegExp(`^/api/admin/users/${UUID_PATH}/notes$`,'i'));
    if(notesMatch&&req.method==='GET'){const actor=await actorFor(req,res,PERMISSIONS.NOTE_READ);if(!actor)return true;json(res,200,{notes:await store.listNotes(notesMatch[1])});return true}
    if(notesMatch&&req.method==='POST'){const actor=await actorFor(req,res,PERMISSIONS.NOTE_WRITE);if(!actor)return true;const target=await store.getUser(notesMatch[1]);if(!target){json(res,404,{error:'User not found.'});return true}const body=await readBody(req),note=String(body.note||'').trim(),category=String(body.category||'GENERAL').toUpperCase();if(!note||note.length>4000||!['DESIGN_PARTNER','PILOT','SUPPORT','SALES','SECURITY','FOLLOW_UP','GENERAL'].includes(category)){json(res,400,{error:'Invalid note.'});return true}await store.saveNote({actor,userId:target.id,note,category,requestId});json(res,201,{ok:true});return true}
    const noteMatch=path.match(new RegExp(`^/api/admin/notes/${UUID_PATH}$`,'i'));
    if(noteMatch&&req.method==='PATCH'){const actor=await actorFor(req,res,PERMISSIONS.NOTE_WRITE);if(!actor)return true;const body=await readBody(req),note=String(body.note||'').trim(),category=String(body.category||'GENERAL').toUpperCase();if(!note||note.length>4000||!['DESIGN_PARTNER','PILOT','SUPPORT','SALES','SECURITY','FOLLOW_UP','GENERAL'].includes(category)){json(res,400,{error:'Invalid note.'});return true}const saved=await store.updateNote({actor,id:noteMatch[1],note,category,requestId});json(res,saved?200:404,saved?{ok:true}:{error:'Note not found.'});return true}
    if(path==='/api/admin/tags'&&req.method==='GET'){const actor=await actorFor(req,res,PERMISSIONS.TAG_READ);if(!actor)return true;json(res,200,{tags:await store.listTags()});return true}
    const tagsMatch=path.match(new RegExp(`^/api/admin/users/${UUID_PATH}/tags/${UUID_PATH}$`,'i'));
    if(tagsMatch&&['PUT','DELETE'].includes(req.method)){const actor=await actorFor(req,res,PERMISSIONS.TAG_WRITE);if(!actor)return true;const target=await store.getUser(tagsMatch[1]);if(!target){json(res,404,{error:'User not found.'});return true}await store.setUserTag({actor,userId:target.id,tagId:tagsMatch[2],assigned:req.method==='PUT',requestId});json(res,200,{ok:true});return true}
    if(path==='/api/admin/rate-limits'&&req.method==='GET'){const actor=await actorFor(req,res,PERMISSIONS.RATE_LIMIT_READ);if(!actor)return true;const userId=String(url.searchParams.get('userId')||'');if(userId&&!isUuid(userId)){json(res,400,{error:'Invalid user ID.'});return true}json(res,200,{rateLimits:await store.listRateLimits({userId})});return true}
    if(path==='/api/admin/rate-limits'&&req.method==='POST'){const actor=await actorFor(req,res,PERMISSIONS.RATE_LIMIT_WRITE);if(!actor)return true;const body=await readBody(req),value=Number(body.value),expiresAt=new Date(body.expiresAt),reason=String(body.reason||'').trim();if(!isUuid(body.userId)||!Number.isInteger(value)||value<5||value>10000||!Number.isFinite(expiresAt.getTime())||expiresAt<=new Date()||reason.length<3||reason.length>500){json(res,400,{error:'Invalid rate-limit configuration.'});return true}const target=await store.getUser(String(body.userId));if(!target){json(res,404,{error:'User not found.'});return true}const id=await store.saveRateLimit({actor,userId:target.id,value,expiresAt:expiresAt.toISOString(),reason,requestId});json(res,201,{id});return true}
    const rateMatch=path.match(new RegExp(`^/api/admin/rate-limits/${UUID_PATH}$`,'i'));
    if(rateMatch&&req.method==='DELETE'){const actor=await actorFor(req,res,PERMISSIONS.RATE_LIMIT_WRITE);if(!actor)return true;const ok=await store.revokeRateLimit({actor,id:rateMatch[1],requestId});json(res,ok?200:404,ok?{ok:true}:{error:'Rate limit not found.'});return true}
    if(path==='/api/admin/environment'&&req.method==='GET'){const actor=await actorFor(req,res,PERMISSIONS.ENVIRONMENT_READ);if(!actor)return true;json(res,200,await environmentStatus());return true}
    if(path==='/api/admin/build'&&req.method==='GET'){const actor=await actorFor(req,res,PERMISSIONS.BUILD_READ);if(!actor)return true;json(res,200,await buildInfo());return true}
    const actor = await actorFor(req, res); if (!actor) return true;
    json(res, 404, { error: 'Unknown admin route.' }); return true;
  };
  return { handle, actorFor };
};

module.exports = { createAdminApi, parsePage, publicActor, sinceFor, isUuid };

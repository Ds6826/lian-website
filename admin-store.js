'use strict';

const crypto = require('node:crypto');
const { neon } = require('@neondatabase/serverless');
const { ROLES, resolveFeatureFlag } = require('./admin-auth');

const cleanUser = (row) => row && ({
  id: row.id, clerkUserId: row.clerk_user_id, email: row.email, name: row.name,
  avatarUrl: row.avatar_url || '', onboardingComplete: row.onboarding_complete,
  onboardingCompletedAt: row.onboarding_completed_at, accountStatus: row.account_status,
  createdAt: row.created_at, updatedAt: row.updated_at, role: row.role || ROLES.MEMBER,
});
const cleanAudit = (row) => ({ id: row.id, actorUserId: row.actor_user_id, actorRole: row.actor_role, action: row.action, targetType: row.target_type, targetId: row.target_id, beforeState: row.before_state || {}, afterState: row.after_state || {}, requestId: row.request_id, outcome: row.outcome || 'SUCCESS', createdAt: row.created_at });
const cleanFlag = (row) => row && ({ id: row.id, key: row.key, displayName: row.display_name, description: row.description, globalEnabled: row.global_enabled, internalOnly: row.internal_only, updatedBy: row.updated_by, createdAt: row.created_at, updatedAt: row.updated_at });
const cleanEvent = (row) => ({ id: row.id, timestamp: row.occurred_at, requestId: row.request_id, route: row.route, method: row.method, statusCode: row.status_code, category: row.category, component: row.component, eventType: row.event_type, userId: row.user_id, retryable: row.retryable, durationMs: row.duration_ms, message: row.message });

const createAdminStore = ({ databaseUrl = process.env.DATABASE_URL } = {}) => {
  const sql = databaseUrl ? neon(databaseUrl) : null;
  const configured = () => Boolean(sql);
  const syncUser = async (user) => {
    if (!sql) return null;
    const stableId = user.clerkUserId || user.providerUserId;
    if (!stableId) throw new Error('Stable Clerk identity is required.');
    const rows = await sql`
      INSERT INTO app_users (id, clerk_user_id, email, name, avatar_url, onboarding_complete, onboarding_completed_at, account_status, created_at, updated_at)
      VALUES (${user.id}, ${stableId}, ${user.email || ''}, ${user.name || ''}, ${user.avatarUrl || ''}, ${Boolean(user.onboardingComplete)}, ${user.onboardingCompletedAt || null}, 'ACTIVE', ${user.createdAt || new Date().toISOString()}, now())
      ON CONFLICT (clerk_user_id) DO UPDATE SET email=EXCLUDED.email, name=EXCLUDED.name, avatar_url=EXCLUDED.avatar_url,
        onboarding_complete=EXCLUDED.onboarding_complete, onboarding_completed_at=EXCLUDED.onboarding_completed_at, updated_at=now()
      RETURNING *`;
    await sql`INSERT INTO internal_role_assignments (user_id, role, active) VALUES (${rows[0].id}, 'MEMBER', true) ON CONFLICT DO NOTHING`;
    return getByClerkId(stableId);
  };
  const getByClerkId = async (clerkId) => {
    if (!sql) return null;
    const rows = await sql`SELECT u.*, COALESCE(r.role, 'MEMBER') role FROM app_users u LEFT JOIN internal_role_assignments r ON r.user_id=u.id AND r.active=true WHERE u.clerk_user_id=${clerkId} LIMIT 1`;
    return cleanUser(rows[0]);
  };
  const getUser = async (id) => {
    const rows = await sql`SELECT u.*, COALESCE(r.role, 'MEMBER') role FROM app_users u LEFT JOIN internal_role_assignments r ON r.user_id=u.id AND r.active=true WHERE u.id=${id} LIMIT 1`;
    return cleanUser(rows[0]);
  };
  const listUsers = async ({ search = '', tag = '', limit = 25, offset = 0 } = {}) => {
    const pattern = `%${search}%`;
    const [rows, count] = await Promise.all([
      sql`SELECT u.*, COALESCE(r.role, 'MEMBER') role FROM app_users u LEFT JOIN internal_role_assignments r ON r.user_id=u.id AND r.active=true WHERE (${search}='' OR u.email ILIKE ${pattern} OR u.name ILIKE ${pattern}) AND (${tag}='' OR EXISTS (SELECT 1 FROM user_internal_tags ut JOIN internal_tags t ON t.id=ut.tag_id WHERE ut.user_id=u.id AND t.key=${tag})) ORDER BY u.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      sql`SELECT count(*)::int total FROM app_users u WHERE (${search}='' OR u.email ILIKE ${pattern} OR u.name ILIKE ${pattern}) AND (${tag}='' OR EXISTS (SELECT 1 FROM user_internal_tags ut JOIN internal_tags t ON t.id=ut.tag_id WHERE ut.user_id=u.id AND t.key=${tag}))`,
    ]);
    return { users: rows.map(cleanUser), total: count[0].total };
  };
  const counts = async () => {
    const rows = await sql`SELECT count(*)::int total_users, count(*) FILTER (WHERE onboarding_complete)::int onboarded_users, count(*) FILTER (WHERE onboarding_completed_at >= now()-interval '24 hours')::int onboarding_last_24h FROM app_users`;
    return rows[0];
  };
  const setStatus = async ({ actor, target, status, requestId }) => {
    const after = { accountStatus: status };
    const queries = await sql.transaction((tx) => [
      tx`UPDATE app_users SET account_status=${status}, updated_at=now() WHERE id=${target.id} RETURNING *`,
      tx`INSERT INTO admin_audit_events (id,actor_user_id,actor_role,action,target_type,target_id,before_state,after_state,request_id) VALUES (${crypto.randomUUID()},${actor.id},${actor.role},${status === 'ACTIVE' ? 'USER_ENABLED' : 'USER_DISABLED'},'user',${target.id},${JSON.stringify({ accountStatus: target.accountStatus })}::jsonb,${JSON.stringify(after)}::jsonb,${requestId}) RETURNING *`,
    ]);
    return { user: await getUser(target.id), audit: cleanAudit(queries[1][0]) };
  };
  const setRole = async ({ actor, target, role, requestId }) => {
    const queries = await sql.transaction((tx) => [
      tx`UPDATE internal_role_assignments SET active=false, revoked_by=${actor.id}, revoked_at=now() WHERE user_id=${target.id} AND active=true`,
      tx`INSERT INTO internal_role_assignments (user_id,role,active,granted_by) VALUES (${target.id},${role},true,${actor.id})`,
      tx`INSERT INTO admin_audit_events (id,actor_user_id,actor_role,action,target_type,target_id,before_state,after_state,request_id) VALUES (${crypto.randomUUID()},${actor.id},${actor.role},'ROLE_CHANGED','user',${target.id},${JSON.stringify({ role: target.role })}::jsonb,${JSON.stringify({ role })}::jsonb,${requestId}) RETURNING *`,
    ]);
    return { user: await getUser(target.id), audit: cleanAudit(queries[2][0]) };
  };
  const countOwners = async () => (await sql`SELECT count(*)::int total FROM internal_role_assignments r JOIN app_users u ON u.id=r.user_id WHERE r.active=true AND r.role='OWNER' AND u.account_status='ACTIVE'`)[0].total;
  const writeAudit = async ({ actor, action, targetType, targetId, beforeState = {}, afterState = {}, requestId }) => cleanAudit((await sql`INSERT INTO admin_audit_events (id,actor_user_id,actor_role,action,target_type,target_id,before_state,after_state,request_id) VALUES (${crypto.randomUUID()},${actor.id},${actor.role},${action},${targetType},${targetId},${JSON.stringify(beforeState)}::jsonb,${JSON.stringify(afterState)}::jsonb,${requestId}) RETURNING *`)[0]);
  const listAudit = async ({ limit = 50, offset = 0, search = '', action = '', role = '', actor = '', target = '', outcome = '', since = '1970-01-01T00:00:00.000Z' } = {}) => { const pattern=`%${search}%`; const [rows,count]=await Promise.all([sql`SELECT * FROM admin_audit_events WHERE created_at>=${since} AND (${search}='' OR action ILIKE ${pattern} OR target_id ILIKE ${pattern} OR request_id ILIKE ${pattern}) AND (${action}='' OR action=${action}) AND (${role}='' OR actor_role=${role}) AND (${actor}='' OR actor_user_id::text=${actor}) AND (${target}='' OR target_id=${target}) AND (${outcome}='' OR outcome=${outcome}) ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,sql`SELECT count(*)::int total FROM admin_audit_events WHERE created_at>=${since} AND (${search}='' OR action ILIKE ${pattern} OR target_id ILIKE ${pattern} OR request_id ILIKE ${pattern}) AND (${action}='' OR action=${action}) AND (${role}='' OR actor_role=${role}) AND (${actor}='' OR actor_user_id::text=${actor}) AND (${target}='' OR target_id=${target}) AND (${outcome}='' OR outcome=${outcome})`]); return { events: rows.map(cleanAudit), total: count[0].total }; };
  const health = async () => { const start=Date.now(); await sql`SELECT 1`; return { ok:true, latencyMs:Date.now()-start }; };

  const listFlags = async ({ search = '' } = {}) => { const pattern=`%${search}%`; return (await sql`SELECT * FROM feature_flags WHERE (${search}='' OR key ILIKE ${pattern} OR display_name ILIKE ${pattern}) ORDER BY key`).map(cleanFlag); };
  const getFlag = async (id) => cleanFlag((await sql`SELECT * FROM feature_flags WHERE id=${id} LIMIT 1`)[0]);
  const saveFlag = async ({ actor, id, key, displayName, description, globalEnabled, internalOnly, requestId }) => {
    const prior = id ? await getFlag(id) : null; const flagId = id || crypto.randomUUID();
    const action = prior ? 'FEATURE_FLAG_UPDATED' : 'FEATURE_FLAG_CREATED';
    const queries = await sql.transaction((tx)=>[
      prior ? tx`UPDATE feature_flags SET display_name=${displayName},description=${description},global_enabled=${globalEnabled},internal_only=${internalOnly},updated_by=${actor.id},updated_at=now() WHERE id=${flagId} RETURNING *` : tx`INSERT INTO feature_flags (id,key,display_name,description,global_enabled,internal_only,created_by,updated_by) VALUES (${flagId},${key},${displayName},${description},${globalEnabled},${internalOnly},${actor.id},${actor.id}) RETURNING *`,
      tx`INSERT INTO admin_audit_events (id,actor_user_id,actor_role,action,target_type,target_id,before_state,after_state,request_id) VALUES (${crypto.randomUUID()},${actor.id},${actor.role},${action},'feature_flag',${flagId},${JSON.stringify(prior||{})}::jsonb,${JSON.stringify({key,displayName,description,globalEnabled,internalOnly})}::jsonb,${requestId})`,
    ]); return cleanFlag(queries[0][0]);
  };
  const listFlagOverrides = async (flagId) => (await sql`SELECT o.id,o.user_id,o.enabled,o.created_at,o.updated_at,u.name,u.email FROM feature_flag_overrides o JOIN app_users u ON u.id=o.user_id WHERE o.feature_flag_id=${flagId} ORDER BY u.email`).map(r=>({id:r.id,userId:r.user_id,enabled:r.enabled,name:r.name,email:r.email,createdAt:r.created_at,updatedAt:r.updated_at}));
  const setFlagOverride = async ({ actor, flagId, userId, enabled, requestId }) => { const id=crypto.randomUUID(); const rows=await sql.transaction((tx)=>[tx`INSERT INTO feature_flag_overrides (id,feature_flag_id,user_id,enabled,created_by) VALUES (${id},${flagId},${userId},${enabled},${actor.id}) ON CONFLICT (feature_flag_id,user_id) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now() RETURNING *`,tx`INSERT INTO admin_audit_events (id,actor_user_id,actor_role,action,target_type,target_id,before_state,after_state,request_id) VALUES (${crypto.randomUUID()},${actor.id},${actor.role},'FEATURE_FLAG_OVERRIDE_CHANGED','user',${userId},'{}'::jsonb,${JSON.stringify({flagId,enabled})}::jsonb,${requestId})`]); return rows[0][0]; };
  const evaluateFlag = async (userId, key, internal) => { const rows=await sql`SELECT f.global_enabled,f.internal_only,o.enabled override_enabled FROM feature_flags f LEFT JOIN feature_flag_overrides o ON o.feature_flag_id=f.id AND o.user_id=${userId} WHERE f.key=${key} LIMIT 1`; const flag=rows[0]; return flag ? resolveFeatureFlag({globalEnabled:flag.global_enabled,internalOnly:flag.internal_only,overrideEnabled:flag.override_enabled},internal) : false; };

  const recordOperationalEvent = async (event) => sql`INSERT INTO operational_events (id,request_id,route,method,status_code,category,component,event_type,user_id,retryable,duration_ms,message) VALUES (${crypto.randomUUID()},${event.requestId},${event.route},${event.method},${event.statusCode},${event.category},${event.component||'website'},${event.eventType||'api_request'},${event.userId||null},${Boolean(event.retryable)},${Math.max(0,Math.min(600000,Number(event.durationMs)||0))},${String(event.message||'').slice(0,300)})`;
  const usage = async ({ since, userId = '' }) => { const rows=await sql`SELECT count(*)::int api_calls,count(*) FILTER (WHERE status_code>=400)::int failed_requests,count(DISTINCT user_id)::int active_users,count(*) FILTER (WHERE status_code=429)::int rate_limit_hits FROM operational_events WHERE occurred_at>=${since} AND (${userId}='' OR user_id::text=${userId})`; const byType=await sql`SELECT event_type,count(*)::int count FROM operational_events WHERE occurred_at>=${since} AND (${userId}='' OR user_id::text=${userId}) GROUP BY event_type ORDER BY count DESC`; return {...rows[0],byType:byType.map(r=>({eventType:r.event_type,count:r.count}))}; };
  const listErrors = async ({ since, category = '', search = '', userId = '', limit = 50, offset = 0 }) => { const pattern=`%${search}%`; const [rows,count]=await Promise.all([sql`SELECT * FROM operational_events WHERE occurred_at>=${since} AND status_code>=400 AND (${category}='' OR category=${category}) AND (${userId}='' OR user_id::text=${userId}) AND (${search}='' OR route ILIKE ${pattern} OR message ILIKE ${pattern} OR request_id ILIKE ${pattern}) ORDER BY occurred_at DESC LIMIT ${limit} OFFSET ${offset}`,sql`SELECT count(*)::int total FROM operational_events WHERE occurred_at>=${since} AND status_code>=400 AND (${category}='' OR category=${category}) AND (${userId}='' OR user_id::text=${userId}) AND (${search}='' OR route ILIKE ${pattern} OR message ILIKE ${pattern} OR request_id ILIKE ${pattern})`]); return {events:rows.map(cleanEvent),total:count[0].total}; };

  const listNotes = async (userId) => (await sql`SELECT n.*,u.name author_name FROM admin_notes n JOIN app_users u ON u.id=n.author_user_id WHERE n.user_id=${userId} ORDER BY n.created_at DESC`).map(r=>({id:r.id,userId:r.user_id,authorUserId:r.author_user_id,authorName:r.author_name,note:r.note,category:r.category,createdAt:r.created_at,updatedAt:r.updated_at}));
  const saveNote = async ({ actor, userId, note, category, requestId }) => { const id=crypto.randomUUID(); const rows=await sql.transaction(tx=>[tx`INSERT INTO admin_notes (id,user_id,author_user_id,note,category) VALUES (${id},${userId},${actor.id},${note},${category}) RETURNING *`,tx`INSERT INTO admin_audit_events (id,actor_user_id,actor_role,action,target_type,target_id,before_state,after_state,request_id) VALUES (${crypto.randomUUID()},${actor.id},${actor.role},'ADMIN_NOTE_CREATED','user',${userId},'{}'::jsonb,${JSON.stringify({noteId:id,category})}::jsonb,${requestId})`]); return rows[0][0]; };
  const updateNote = async ({actor,id,note,category,requestId}) => { const prior=(await sql`SELECT id,user_id,note,category FROM admin_notes WHERE id=${id} LIMIT 1`)[0]; if(!prior)return null; const rows=await sql.transaction(tx=>[tx`UPDATE admin_notes SET note=${note},category=${category},updated_at=now() WHERE id=${id} RETURNING *`,tx`INSERT INTO admin_audit_events (id,actor_user_id,actor_role,action,target_type,target_id,before_state,after_state,request_id) VALUES (${crypto.randomUUID()},${actor.id},${actor.role},'ADMIN_NOTE_UPDATED','user',${prior.user_id},${JSON.stringify({noteId:id,category:prior.category})}::jsonb,${JSON.stringify({noteId:id,category})}::jsonb,${requestId})`]);return rows[0][0]; };
  const listTags = async () => (await sql`SELECT * FROM internal_tags ORDER BY display_name`).map(r=>({id:r.id,key:r.key,displayName:r.display_name}));
  const userTags = async (userId) => (await sql`SELECT t.id,t.key,t.display_name,ut.assigned_at FROM user_internal_tags ut JOIN internal_tags t ON t.id=ut.tag_id WHERE ut.user_id=${userId} ORDER BY t.display_name`).map(r=>({id:r.id,key:r.key,displayName:r.display_name,assignedAt:r.assigned_at}));
  const setUserTag = async ({ actor,userId,tagId,assigned,requestId }) => { const exists=Boolean((await sql`SELECT 1 FROM user_internal_tags WHERE user_id=${userId} AND tag_id=${tagId} LIMIT 1`)[0]); if(exists===assigned)return false; await sql.transaction(tx=>[assigned?tx`INSERT INTO user_internal_tags (user_id,tag_id,assigned_by) VALUES (${userId},${tagId},${actor.id})`:tx`DELETE FROM user_internal_tags WHERE user_id=${userId} AND tag_id=${tagId}`,tx`INSERT INTO admin_audit_events (id,actor_user_id,actor_role,action,target_type,target_id,before_state,after_state,request_id) VALUES (${crypto.randomUUID()},${actor.id},${actor.role},${assigned?'USER_TAG_ASSIGNED':'USER_TAG_REMOVED'},'user',${userId},${JSON.stringify({tagId,assigned:!assigned})}::jsonb,${JSON.stringify({tagId,assigned})}::jsonb,${requestId})`]); return true; };
  const listRateLimits = async ({ userId = '' } = {}) => (await sql`SELECT * FROM admin_rate_limits WHERE (${userId}='' OR target_id::text=${userId}) ORDER BY created_at DESC LIMIT 200`).map(r=>({id:r.id,targetType:r.target_type,targetId:r.target_id,limitType:r.limit_type,value:r.value,expiresAt:r.expires_at,reason:r.reason,createdAt:r.created_at,revokedAt:r.revoked_at}));
  const activeRateLimit = async (userId) => { const row=(await sql`SELECT * FROM admin_rate_limits WHERE target_id=${userId} AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC LIMIT 1`)[0]; return row&&{id:row.id,value:row.value,expiresAt:row.expires_at}; };
  const saveRateLimit = async ({actor,userId,value,expiresAt,reason,requestId}) => { const id=crypto.randomUUID(); await sql.transaction(tx=>[tx`INSERT INTO admin_rate_limits (id,target_type,target_id,limit_type,value,expires_at,reason,created_by) VALUES (${id},'USER',${userId},'WEBSITE_API_REQUESTS_PER_MINUTE',${value},${expiresAt},${reason},${actor.id})`,tx`INSERT INTO admin_audit_events (id,actor_user_id,actor_role,action,target_type,target_id,before_state,after_state,request_id) VALUES (${crypto.randomUUID()},${actor.id},${actor.role},'RATE_LIMIT_CREATED','user',${userId},'{}'::jsonb,${JSON.stringify({rateLimitId:id,value,expiresAt,reason})}::jsonb,${requestId})`]); return id; };
  const revokeRateLimit = async ({actor,id,requestId}) => { const prior=(await sql`SELECT id,target_id,value,expires_at FROM admin_rate_limits WHERE id=${id} AND revoked_at IS NULL LIMIT 1`)[0]; if(!prior)return false; const rows=await sql.transaction(tx=>[tx`UPDATE admin_rate_limits SET revoked_by=${actor.id},revoked_at=now() WHERE id=${id} AND revoked_at IS NULL RETURNING target_id`,tx`INSERT INTO admin_audit_events (id,actor_user_id,actor_role,action,target_type,target_id,before_state,after_state,request_id) VALUES (${crypto.randomUUID()},${actor.id},${actor.role},'RATE_LIMIT_REVOKED','rate_limit',${id},${JSON.stringify({active:true,value:prior.value,expiresAt:prior.expires_at})}::jsonb,${JSON.stringify({active:false})}::jsonb,${requestId})`]); return Boolean(rows[0][0]); };

  return { configured, syncUser, getByClerkId, getUser, listUsers, counts, setStatus, setRole, countOwners, writeAudit, listAudit, health, listFlags, getFlag, saveFlag, listFlagOverrides, setFlagOverride, evaluateFlag, recordOperationalEvent, usage, listErrors, listNotes, saveNote, updateNote, listTags, userTags, setUserTag, listRateLimits, activeRateLimit, saveRateLimit, revokeRateLimit };
};

module.exports = { createAdminStore, cleanUser, cleanAudit, cleanFlag, cleanEvent };

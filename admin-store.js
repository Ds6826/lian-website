'use strict';

const crypto = require('node:crypto');
const { neon } = require('@neondatabase/serverless');
const { ROLES } = require('./admin-auth');

const cleanUser = (row) => row && ({
  id: row.id, clerkUserId: row.clerk_user_id, email: row.email, name: row.name,
  avatarUrl: row.avatar_url || '', onboardingComplete: row.onboarding_complete,
  onboardingCompletedAt: row.onboarding_completed_at, accountStatus: row.account_status,
  createdAt: row.created_at, updatedAt: row.updated_at, role: row.role || ROLES.MEMBER,
});
const cleanAudit = (row) => ({ id: row.id, actorUserId: row.actor_user_id, actorRole: row.actor_role, action: row.action, targetType: row.target_type, targetId: row.target_id, beforeState: row.before_state || {}, afterState: row.after_state || {}, requestId: row.request_id, createdAt: row.created_at });

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
  const listUsers = async ({ search = '', limit = 25, offset = 0 } = {}) => {
    const pattern = `%${search}%`;
    const [rows, count] = await Promise.all([
      sql`SELECT u.*, COALESCE(r.role, 'MEMBER') role FROM app_users u LEFT JOIN internal_role_assignments r ON r.user_id=u.id AND r.active=true WHERE (${search}='' OR u.email ILIKE ${pattern} OR u.name ILIKE ${pattern}) ORDER BY u.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      sql`SELECT count(*)::int total FROM app_users u WHERE (${search}='' OR u.email ILIKE ${pattern} OR u.name ILIKE ${pattern})`,
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
  const listAudit = async ({ limit = 50, offset = 0 } = {}) => { const [rows,count]=await Promise.all([sql`SELECT * FROM admin_audit_events ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,sql`SELECT count(*)::int total FROM admin_audit_events`]); return { events: rows.map(cleanAudit), total: count[0].total }; };
  const health = async () => { const start=Date.now(); await sql`SELECT 1`; return { ok:true, latencyMs:Date.now()-start }; };
  return { configured, syncUser, getByClerkId, getUser, listUsers, counts, setStatus, setRole, countOwners, writeAudit, listAudit, health };
};

module.exports = { createAdminStore, cleanUser, cleanAudit };

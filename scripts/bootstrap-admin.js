'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { neon } = require('@neondatabase/serverless');
const { createClerkClient } = require('@clerk/backend');

const databaseUrl = process.env.DATABASE_URL;
const ownerClerkId = process.env.LIANS_OWNER_CLERK_USER_ID;
const clerkSecretKey = process.env.CLERK_SECRET_KEY;
if (!databaseUrl || !ownerClerkId || !clerkSecretKey) {
  console.error('Set DATABASE_URL, CLERK_SECRET_KEY, and LIANS_OWNER_CLERK_USER_ID. Values are never printed.');
  process.exitCode = 1;
} else {
  const sql = neon(databaseUrl);
  const clerk = createClerkClient({ secretKey: clerkSecretKey });
  const dataFile = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'lian-console.json');
  const users = fs.existsSync(dataFile) ? (JSON.parse(fs.readFileSync(dataFile, 'utf8')).users || []) : [];
  const normalized = users.map((u) => ({ ...u, stableId: u.clerkUserId || u.providerUserId })).filter((u) => u.stableId);
  const duplicates = normalized.filter((u, i) => normalized.findIndex((x) => x.stableId === u.stableId) !== i);
  if (duplicates.length) throw new Error('Duplicate stable Clerk identities found; no backfill was performed.');
  (async () => {
    for (const u of normalized) {
      await sql`INSERT INTO app_users (id,clerk_user_id,email,name,avatar_url,onboarding_complete,onboarding_completed_at,created_at) VALUES (${u.id},${u.stableId},${u.email||''},${u.name||''},${u.avatarUrl||''},${Boolean(u.onboardingComplete)},${u.onboardingCompletedAt||null},${u.createdAt||new Date().toISOString()}) ON CONFLICT (clerk_user_id) DO NOTHING`;
      await sql`INSERT INTO internal_role_assignments (user_id,role,active) SELECT id,'MEMBER',true FROM app_users WHERE clerk_user_id=${u.stableId} ON CONFLICT DO NOTHING`;
    }
    let owner = await sql`SELECT id FROM app_users WHERE clerk_user_id=${ownerClerkId} LIMIT 1`;
    if (!owner[0]) {
      const clerkUser = await clerk.users.getUser(ownerClerkId);
      const appUserId = clerkUser.privateMetadata?.liansUserId || crypto.randomUUID();
      const email = clerkUser.emailAddresses?.[0]?.emailAddress || '';
      const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || clerkUser.username || 'Lians user';
      owner = await sql`INSERT INTO app_users (id,clerk_user_id,email,name,avatar_url) VALUES (${appUserId},${ownerClerkId},${email},${name},${clerkUser.imageUrl||''}) ON CONFLICT (clerk_user_id) DO UPDATE SET email=EXCLUDED.email,name=EXCLUDED.name,avatar_url=EXCLUDED.avatar_url,updated_at=now() RETURNING id`;
    }
    await sql.transaction((tx) => [tx`UPDATE internal_role_assignments SET active=false,revoked_at=now() WHERE user_id=${owner[0].id} AND active=true`,tx`INSERT INTO internal_role_assignments (user_id,role,active) VALUES (${owner[0].id},'OWNER',true)`]);
    console.log(`Backfilled ${normalized.length} unique users and assigned one OWNER.`);
  })().catch((error) => { console.error(error.message); process.exitCode = 1; });
}

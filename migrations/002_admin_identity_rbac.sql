BEGIN;

CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY,
  clerk_user_id text NOT NULL UNIQUE,
  email text NOT NULL DEFAULT '',
  name text NOT NULL DEFAULT '',
  avatar_url text NOT NULL DEFAULT '',
  onboarding_complete boolean NOT NULL DEFAULT false,
  onboarding_completed_at timestamptz,
  account_status text NOT NULL DEFAULT 'ACTIVE' CHECK (account_status IN ('ACTIVE','DISABLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS internal_role_assignments (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users(id),
  role text NOT NULL CHECK (role IN ('OWNER','ADMIN','DEVELOPER','MEMBER')),
  active boolean NOT NULL DEFAULT true,
  granted_by uuid REFERENCES app_users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid REFERENCES app_users(id),
  revoked_at timestamptz,
  CHECK ((active AND revoked_at IS NULL) OR (NOT active))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_internal_role_active_user ON internal_role_assignments(user_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_internal_roles_role ON internal_role_assignments(role) WHERE active;

CREATE TABLE IF NOT EXISTS admin_audit_events (
  id uuid PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES app_users(id),
  actor_role text NOT NULL CHECK (actor_role IN ('OWNER','ADMIN','DEVELOPER','MEMBER')),
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  organization_id uuid,
  before_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_actor ON admin_audit_events(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit_events(target_type, target_id, created_at DESC);

CREATE OR REPLACE FUNCTION prevent_admin_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'admin_audit_events is append-only'; END $$;
DROP TRIGGER IF EXISTS admin_audit_events_append_only ON admin_audit_events;
CREATE TRIGGER admin_audit_events_append_only BEFORE UPDATE OR DELETE ON admin_audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_admin_audit_mutation();

-- Existing JSON users are backfilled by scripts/bootstrap-admin.js after identity
-- uniqueness is verified. Every synchronized user is assigned MEMBER by default.
COMMIT;

BEGIN;

CREATE TABLE IF NOT EXISTS feature_flags (
  id uuid PRIMARY KEY,
  key text NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_]{1,63}$'),
  display_name text NOT NULL,
  description text NOT NULL DEFAULT '',
  global_enabled boolean NOT NULL DEFAULT false,
  internal_only boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES app_users(id),
  updated_by uuid REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_feature_flags_updated ON feature_flags(updated_at DESC);

CREATE TABLE IF NOT EXISTS feature_flag_overrides (
  id uuid PRIMARY KEY,
  feature_flag_id uuid NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_users(id),
  enabled boolean NOT NULL,
  created_by uuid NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(feature_flag_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_flag_overrides_user ON feature_flag_overrides(user_id);

CREATE TABLE IF NOT EXISTS operational_events (
  id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  request_id text NOT NULL,
  route text NOT NULL,
  method text NOT NULL,
  status_code integer NOT NULL,
  category text NOT NULL,
  component text NOT NULL DEFAULT 'website',
  event_type text NOT NULL DEFAULT 'api_request',
  user_id uuid REFERENCES app_users(id),
  retryable boolean NOT NULL DEFAULT false,
  duration_ms integer NOT NULL DEFAULT 0,
  message text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_operational_events_time ON operational_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_operational_events_user_time ON operational_events(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_operational_events_category_time ON operational_events(category, occurred_at DESC);

CREATE TABLE IF NOT EXISTS admin_notes (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users(id),
  author_user_id uuid NOT NULL REFERENCES app_users(id),
  note text NOT NULL CHECK (char_length(note) BETWEEN 1 AND 4000),
  category text NOT NULL CHECK (category IN ('DESIGN_PARTNER','PILOT','SUPPORT','SALES','SECURITY','FOLLOW_UP','GENERAL')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_notes_user_time ON admin_notes(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS internal_tags (
  id uuid PRIMARY KEY,
  key text NOT NULL UNIQUE CHECK (key IN ('DESIGN_PARTNER','BETA','INTERNAL','EARLY_ACCESS','PILOT','SECURITY_REVIEW','PRIORITY_SUPPORT')),
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS user_internal_tags (
  user_id uuid NOT NULL REFERENCES app_users(id),
  tag_id uuid NOT NULL REFERENCES internal_tags(id),
  assigned_by uuid NOT NULL REFERENCES app_users(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_user_internal_tags_tag ON user_internal_tags(tag_id, user_id);

CREATE TABLE IF NOT EXISTS admin_rate_limits (
  id uuid PRIMARY KEY,
  target_type text NOT NULL CHECK (target_type IN ('USER')),
  target_id uuid NOT NULL REFERENCES app_users(id),
  limit_type text NOT NULL CHECK (limit_type IN ('WEBSITE_API_REQUESTS_PER_MINUTE')),
  value integer NOT NULL CHECK (value BETWEEN 5 AND 10000),
  expires_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),
  created_by uuid NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid REFERENCES app_users(id),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_admin_rate_limits_active ON admin_rate_limits(target_id, expires_at DESC) WHERE revoked_at IS NULL;

ALTER TABLE admin_audit_events ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'SUCCESS' CHECK (outcome IN ('SUCCESS','FAILURE','REQUESTED'));

INSERT INTO internal_tags (id,key,display_name) VALUES
  ('10000000-0000-4000-8000-000000000001','DESIGN_PARTNER','Design Partner'),
  ('10000000-0000-4000-8000-000000000002','BETA','Beta'),
  ('10000000-0000-4000-8000-000000000003','INTERNAL','Internal'),
  ('10000000-0000-4000-8000-000000000004','EARLY_ACCESS','Early Access'),
  ('10000000-0000-4000-8000-000000000005','PILOT','Pilot'),
  ('10000000-0000-4000-8000-000000000006','SECURITY_REVIEW','Security Review'),
  ('10000000-0000-4000-8000-000000000007','PRIORITY_SUPPORT','Priority Support')
ON CONFLICT (key) DO NOTHING;

INSERT INTO feature_flags (id,key,display_name,description,global_enabled,internal_only) VALUES
  ('20000000-0000-4000-8000-000000000001','policy_gate','Policy Gate','Server-evaluated rollout state for policy-gate integrations.',false,false),
  ('20000000-0000-4000-8000-000000000002','evidence_exports','Evidence Exports','Controls future metadata-only evidence export workflows.',false,false),
  ('20000000-0000-4000-8000-000000000003','experimental_sdk','Experimental SDK','Early access to experimental SDK capabilities.',false,false),
  ('20000000-0000-4000-8000-000000000004','new_console_modules','New Console Modules','Rollout state for approved customer-console modules.',false,false),
  ('20000000-0000-4000-8000-000000000005','beta_investigation_tools','Beta Investigation Tools','Internal-only rollout marker; raw evidence access remains prohibited.',false,true)
ON CONFLICT (key) DO NOTHING;

COMMIT;

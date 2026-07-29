CREATE TABLE IF NOT EXISTS agent_experiences (
  id uuid PRIMARY KEY,
  namespace text NOT NULL,
  agent_id text NOT NULL,
  task text NOT NULL,
  task_key text NOT NULL,
  decision jsonb NOT NULL,
  context_memory_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome jsonb,
  reward double precision,
  reviewer_feedback text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS agent_experiences_namespace_agent_idx
  ON agent_experiences (namespace, agent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reflection_proposals (
  id uuid PRIMARY KEY,
  namespace text NOT NULL,
  agent_id text NOT NULL,
  task_key text NOT NULL,
  content text NOT NULL,
  supporting_experience_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence double precision NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  reviewer_note text,
  promoted_memory_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);

CREATE INDEX IF NOT EXISTS reflection_proposals_namespace_status_idx
  ON reflection_proposals (namespace, status, created_at DESC);

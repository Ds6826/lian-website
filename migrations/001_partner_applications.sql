CREATE TABLE IF NOT EXISTS partner_applications (
  id uuid PRIMARY KEY,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'received',
  high_fit boolean NOT NULL DEFAULT false,
  work_email text NOT NULL,
  company text NOT NULL,
  role text NOT NULL,
  company_website text NOT NULL,
  agent_workflow text NOT NULL,
  changing_facts text NOT NULL,
  audit_requirement text NOT NULL,
  current_stage text NOT NULL,
  preferred_track text NOT NULL,
  deployment_requirement text NOT NULL,
  architecture_file jsonb,
  attribution jsonb NOT NULL DEFAULT '{}'::jsonb,
  internal_email_id text,
  confirmation_email_id text
);


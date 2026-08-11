# Lians Admin Console V2

Admin V2 extends the Clerk-authenticated, Postgres-authorized internal console. It does
not create a separate login and does not change the customer login, onboarding, or
Console flow. All `/api/admin/*` permissions are resolved server-side from the stable
Clerk user ID, durable account status, role assignment, and centralized permission map.

## Operational surfaces

- Dashboard and genuine system health
- Users and non-impersonating support metadata
- Safe API-key metadata and revocation
- Aggregated website API usage and sanitized failures
- Global and per-user feature flags
- User-level temporary website API restrictions
- Internal notes and beta/internal tags
- Searchable admin audit history
- Configuration-presence and safe build information

Page routes are `/admin`, `/admin/system`, `/admin/errors`, `/admin/users`,
`/admin/api-keys`, `/admin/usage`, `/admin/feature-flags`, `/admin/abuse`,
`/admin/audit`, `/admin/environment`, and `/admin/build`. Their APIs use the matching
`/api/admin/*` namespace. Authenticated product code can read evaluated, non-secret flag
state from `GET /api/features`; the server remains authoritative for enforcement.

## Roles

- OWNER: all approved V2 reads and mutations, role management, and flag creation.
- ADMIN: approved user, key, flag, note, tag, and abuse-control operations. OWNER
  accounts and internal-only flags remain protected.
- DEVELOPER: sanitized system, usage, error, audit, support, environment, build, and
  flag reads. No V2 mutations.
- MEMBER: no Admin Console access.

## Data sources and privacy

`operational_events` records route templates, method, status, request ID, duration,
category, component, retryability, and application user ID. It never stores request
bodies, prompts, evidence, documents, tokens, credentials, or API-key material. Usage
and error pages aggregate or list only this metadata. Internal notes are limited to
4,000 characters and must not be used for secrets or raw evidence.

The support view cannot impersonate users and exposes no sessions, Clerk private
metadata, raw evidence, or plaintext keys. Configuration status returns booleans/states
only. Audit records remain append-only through the database trigger created by migration
002; migration 003 extends their outcome vocabulary and adds V2 tables.

## Abuse controls

V2 restrictions apply only to authenticated website API traffic. Values are bounded to
5-10,000 requests per minute, require a reason and future expiry, and cannot weaken the
existing global/IP limit. The current limiter is per server instance. Lians data-plane
API-key throttling is deferred until the Lians backend exposes an authoritative control.

## Deferred

- Global decision, validation, and policy-event enumeration
- Raw evidence or prompt inspection
- API-key disable/re-enable and authoritative backend throttling
- Organizations and organization-scoped RBAC
- Customer impersonation or onboarding reset
- Grafana replacement or fabricated recorder/evidence/policy health

## Deployment handoff

The cofounder must review and run migrations 002 and 003 in order, bootstrap OWNER,
keep `ADMIN_CONSOLE_ENABLED=false` during initial validation, then enable it during the
controlled rollout. Required variables remain `DATABASE_URL`, Clerk configuration, and
the Lians backend configuration. Optional safe build metadata can be supplied through
`GIT_COMMIT_SHA`, `GIT_BRANCH`, and `BUILD_TIMESTAMP`. Rollback is performed by disabling
the Admin Console and reverting the application build; retain schema and audit history.

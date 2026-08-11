# Public website boundary

This repository contains the publicly readable website and the deployment
shell used by Lians. It is not the Apache-licensed Lians Community repository.
Unless a file explicitly says otherwise, the contents are proprietary and are
covered by [LICENSE](LICENSE).

## What belongs here

- public marketing pages and product explanations;
- public pricing and plan descriptions shown to buyers;
- security, privacy, terms, trust, and status pages;
- browser assets needed to operate the public website;
- narrow integration contracts required to connect the website to Clerk and
  the public Lians API; and
- tests and workflows that make those public surfaces safer.

## What stays private

- investor materials, fundraising strategy, outreach lists, and internal GTM;
- customer or partner applications and attachments;
- production runbooks, infrastructure state, incident notes, and credentials;
- entitlement policy experiments, revenue reporting, and billing operations;
- customer-specific configurations, data, traces, evaluations, or deliverables;
- private connectors, operator tooling, and future commercial modules; and
- internal redesign notes, screenshots, drafts, or decision logs.

The hosted service verifies plan entitlements on the server. Browser-side locks
are only a usability aid and are never the authorization boundary. If billing
verification is unavailable, paid access fails closed while the free surface
remains available.

The public Community versus commercial Platform source boundary is documented
in [Lians-ai/Lians](https://github.com/Lians-ai/Lians/blob/master/OPEN_CORE.md).

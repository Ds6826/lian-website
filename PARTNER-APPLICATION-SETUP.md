# Partner application production setup

The site owns the complete application pipeline. Pipedream is not used.

## Required production environment variables

- `DATABASE_URL`: pooled Neon PostgreSQL connection string.
- `SMTP_HOST`: Optional; defaults to `smtp.gmail.com`.
- `SMTP_PORT`: Optional; defaults to `465`.
- `SMTP_SECURE`: Optional; defaults to `true`.
- `SMTP_USER`: Optional Google Workspace mailbox, for example `info@lians.ai`.
- `SMTP_PASSWORD`: Optional Google app password for that mailbox.
- `PARTNER_EMAIL_FROM`: sender, for example `Lians <info@lians.ai>`.
- `PARTNER_NOTIFICATION_TO`: internal recipient, for example `sales@lians.ai`.
- `PARTNER_SCHEDULING_URL`: optional booking URL for high-fit applicants. Leave unset to schedule manually by email.

## Database

1. Create or connect a Neon database from the Vercel project.
2. Add its pooled connection string to `DATABASE_URL` for Production.
3. The application service creates the required table safely on first use. The equivalent auditable migration is in `migrations/001_partner_applications.sql`.

## Google Workspace SMTP

1. Enable two-step verification for the sending Google Workspace account.
2. Create an app password for the website mailer.
3. To enable notifications, store the mailbox as `SMTP_USER` and a dedicated,
   revocable app password as `SMTP_PASSWORD` in Vercel Production. Without
   these variables, validated applications are still stored durably with
   status `stored`; email delivery is not attempted.
4. Set `PARTNER_EMAIL_FROM` to the same authenticated mailbox. Google may rewrite an unrelated From address.
5. Set `PARTNER_NOTIFICATION_TO` to the internal application inbox.

## Release gate

After all values exist, redeploy production and submit one labeled QA application. Confirm:

- A row exists in `partner_applications` with status `notified`.
- The internal notification contains application and attribution fields.
- The applicant receives the confirmation.
- When a scheduling URL is configured, a qualified Pilot or Production implementation applicant receives it.
- When it is not configured, every applicant receives the email-based next step instead.

# Lians website

Public website and hosted-console shell for [Lians](https://github.com/Lians-ai/Lians).
The Apache-licensed memory engine, SDKs, and verifiers live in the Community
repository. This repository is publicly readable but proprietary; see
[LICENSE](LICENSE) and [PUBLIC_BOUNDARY.md](PUBLIC_BOUNDARY.md).

Hosted plan access is verified server-side against Clerk Billing. Client-side
locked states explain availability but are not trusted for authorization.

## Run locally

```bash
npm install
node server.js
```

Open `http://localhost:8000`. The Console, including API-key creation and its local JSON-backed API, is available after sign-in and onboarding.

## Clerk auth

Copy `.env.example` to `.env` and provide Clerk credentials:

```env
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
SESSION_SECRET=replace_with_a_long_random_string
```

The login page uses Clerk JS OAuth strategies for Google and GitHub. It should not link to `/auth/google` or `/auth/github`.

For local testing, use Clerk development keys or allow `http://localhost:8000` in Clerk. Production custom-domain keys, such as keys tied to `clerk.lians.ai`, may reject localhost.

## Deployment

The same server can run locally with `node server.js`, in Docker/Fly, or on Vercel through `api/index.js` and `vercel.json`.

Set these environment variables in the deployment platform:

```env
BASE_URL=https://www.lians.ai
CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...
SESSION_SECRET=replace_with_a_long_random_string
CLERK_BILLING_PLAN_ID_STARTER=
CLERK_BILLING_PLAN_ID_GROWTH=
CLERK_BILLING_PLAN_ID_PRO=
LIANS_API_URL=
LIANS_PROVISIONING_SECRET=
```

The local API-key store is deliberately ignored by Git. Investor materials,
customer data, production runbooks, commercial strategy, and private platform
modules must not be committed here. Run `npm run check:public-boundary` before
publishing changes.

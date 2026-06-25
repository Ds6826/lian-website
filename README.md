# Lian website

Standalone marketing site and local Console prototype for [Lian](https://github.com/ebeirne/Lian). This repository contains only the website; it does not modify or include Lian's application code.

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
CLERK_BILLING_PLAN_ID=
LIAN_API_KEY=
```

The local API-key store is deliberately ignored by Git.

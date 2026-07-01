# Lians — Production Setup & Security Checklist

This is the exact, step-by-step list of what *you* need to do (mostly clicking in
dashboards and pasting env vars). The code is already written to use everything below —
it just needs the credentials/toggles. Each item says **what's done in code** vs.
**what you do**.

Set every env var in **Vercel → your project → Settings → Environment Variables**
(Production scope), then redeploy. Never commit secrets to git.

---

## 1. Security headers (CSP, HSTS, etc.) — ✅ DONE in code
`server.js` sends a strict Content-Security-Policy, HSTS, `x-frame-options: DENY`,
`x-content-type-options: nosniff`, referrer-policy, and permissions-policy on every
response. **Nothing for you to do** unless you add a new third-party script/embed — if
you do, tell me and I'll add its origin to the CSP (otherwise the browser blocks it,
exactly like the inline-script error we just fixed).

**Verify:** open the site → DevTools → Network → click the document → Response Headers →
confirm `content-security-policy` and `strict-transport-security` are present.

---

## 2. Rate limiting — ✅ app-level DONE, ⚠️ needs the real edge limiter

**Done in code:** `server.js` has an in-memory limiter — 300 requests/min/IP site-wide
and 60/min/IP on `/api/*`, keyed off `x-forwarded-for`.

**The catch:** on Vercel, each serverless instance has its *own* memory, so this counter
resets per instance and per cold-start. It stops casual hammering but is **not** a real
DDoS defense.

**What you do — turn on Vercel's edge firewall (5 min):**
1. Vercel → project → **Firewall** tab.
2. Toggle **"Attack Challenge Mode"** on if you're under abuse (challenges suspicious traffic).
3. Click **"Add Rule"** → e.g. *Rate limit* → 100 requests / 10s per IP → action: *Deny*.
   Add a stricter rule scoped to path `/api/*` (e.g. 30 / 10s).
4. (Optional, paid) **Vercel WAF** managed rulesets for OWASP-style protection.

This runs at the edge before requests hit your function — that's the durable rate limit.

---

## 3. Persistent database — ⚠️ ACTION NEEDED (currently ephemeral)

**Done in code:** user/project/onboarding data is written to a JSON file and *mirrored to
Clerk `privateMetadata`* so it survives. But the JSON file lives in `/tmp`, which Vercel
**wipes between deploys and cold starts** — so anything not mirrored to Clerk is temporary.

**What you do — add a real key-value store (10 min):**
1. Vercel → project → **Storage** → **Create** → choose **Upstash for Redis** (KV) — or
   **Neon/Postgres** if you prefer SQL.
2. Connect it to the project. Vercel auto-injects the connection env vars
   (`KV_REST_API_URL`, `KV_REST_API_TOKEN`, or `DATABASE_URL`).
3. Tell me which you picked — I'll swap the `/tmp` JSON store for it (the read/write
   layer is already isolated to a few functions, so it's a contained change).

---

## 4. Real API keys — ✅ DONE / live usage — ⚠️ pending a backend endpoint

**Backend:** deployed on Render at `https://agentmem-api.onrender.com` (Postgres + Redis +
all migrations). `LIANS_API_URL` and `LIANS_ADMIN_SECRET` are set in Vercel (Production).

**Done:** the console now provisions **real API keys** against the backend admin API
(`/v1/admin/api-keys`, `X-Admin-Secret`) — create / list / rotate / delete, one namespace
per user (`ns_<userId>`), scopes derived from the user's tier. Verified end-to-end: a
minted key authenticates on `/v1/*` with `X-API-Key`.

**Still pending — live usage numbers:** the backend has no per-namespace usage-count
endpoint (only `/v1/admin/billing/{ns}` = Stripe mapping). So the console's usage figures
aren't live yet. To finish this we need a backend endpoint that returns write/recall counts
per namespace (a small addition to the Lians server), then I wire the console to it.

**Cold start:** on Render Starter the API can spin down when idle; the first request may
take a few seconds. Add a keep-warm ping later if needed.

---

## 5. Billing (Clerk + Stripe) — ✅ DONE
Custom on-theme plan cards open Clerk's checkout drawer; plan IDs are resolved at runtime
via `clerk.billing.getPlans()`. **What you do:** in the **Clerk Dashboard → Billing**,
make sure each plan's *slug* matches `starter` / `growth` / `pro` (so the cards map
correctly), and that Stripe is connected in Clerk. If a card shows "Unavailable," the
slug didn't match — send me the names you used.

**Also:** keep `js.stripe.com` in the CSP (already there) — removing it breaks checkout.

---

## 6. Error monitoring — ✅ DONE
Sentry is wired for **both** the server (`@sentry/node` — captures unexpected request
errors + unhandled rejections) and the **browser console** (official Sentry CDN SDK,
initialised from `sentryDsn` in `/config.js`). `SENTRY_DSN` is set in Vercel (Production).
Events now flow to your Sentry project automatically.

**Note:** instrumented on the *console app* + server. Marketing pages aren't (they're
mostly static) — say the word if you want them covered too.
Vercel function logs remain available at Vercel → project → **Logs**.

---

## 7. Auto-deploy & preview builds — ⚠️ RECOMMENDED (removes manual deploys)
Right now I deploy manually with the Vercel CLI each round.
**What you do (2 min):** Vercel → project → **Settings → Git → Connect** the
`Ds6826/lian-website` repo, branch `main` = Production. After that, every push to `main`
auto-deploys, and every PR gets a preview URL. No more manual deploys.

---

## 8. Auth hardening (Clerk) — mostly ✅, a couple of toggles
**Done in code:** server verifies Clerk session tokens on every `/api` call; cookies are
httpOnly/secure; sign-in is OAuth-only (Google/GitHub).
**What you do in Clerk Dashboard:**
- **Domains:** ensure `www.lians.ai` (and `lians.ai`) are the allowed/production origins.
- **Attack protection:** turn on **bot protection** and **rate limiting** for sign-in.
- **Session:** set a sensible session lifetime (e.g. 7 days) and enable
  **revoke on password/credential change**.

---

## 9. Legal pages — offer
Privacy Policy, Terms of Service, and a DPA are expected for a regulated-data product.
I can scaffold all three now (you'd just need a lawyer to review before relying on them).
Say the word.

---

## Priority order (what to do first)
1. **#7 Connect Git** (stops manual deploys; everything after is easier).
2. **#3 Database** (so data stops being ephemeral).
3. **#2 Firewall rate limit** (real abuse protection).
4. **#4 Live API keys/usage** (makes the console real).
5. **#6 Sentry** + **#8 Clerk toggles** + **#9 Legal**.

For each, just give me the env var / confirmation and I'll wire the code.

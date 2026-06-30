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

## 4. Real API keys + live usage — ⚠️ ACTION NEEDED (currently cosmetic)

**Done in code:** the console generates/display keys and shows usage numbers, but they're
placeholders — there's no live Lians backend wired in yet.

**What you do:**
1. Stand up / point to your Lians backend (the `Lians-ai/Lians` server).
2. Set env vars:
   - `LIANS_API_URL` = base URL of that backend (e.g. `https://api.lians.ai`)
   - `LIANS_ADMIN_SECRET` = an admin token the website uses to provision keys / read usage
3. Tell me, and I'll wire key provisioning + real usage metering to those endpoints.

---

## 5. Billing (Clerk + Stripe) — ✅ DONE
Custom on-theme plan cards open Clerk's checkout drawer; plan IDs are resolved at runtime
via `clerk.billing.getPlans()`. **What you do:** in the **Clerk Dashboard → Billing**,
make sure each plan's *slug* matches `starter` / `growth` / `pro` (so the cards map
correctly), and that Stripe is connected in Clerk. If a card shows "Unavailable," the
slug didn't match — send me the names you used.

**Also:** keep `js.stripe.com` in the CSP (already there) — removing it breaks checkout.

---

## 6. Error monitoring — ⚠️ ACTION NEEDED (recommended)
**What you do:**
1. Create a free **Sentry** project (Node/JS).
2. Copy the **DSN**, set env var `SENTRY_DSN`.
3. Tell me — I'll add the SDK + capture server errors and client exceptions.

Until then, your only visibility is Vercel's function logs (Vercel → project →
**Logs**), which is fine for now but not alerting.

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

# Lians Pricing Tiers

> Source of truth: the repo's `docs/billing.md` (quotas + scope mapping) and
> `docs/pricing-tiers.md` (packaging philosophy). Keep this file, the `/pricing`
> page, and `app.js` `BILLING_PLANS` / `PLAN_LIMITS` in sync.

## Free - $0 / mo
*Start building at no cost.*

**Limits:** 10K writes · 10K recalls / mo

**Features:**
- Memory writes
- Memory recalls
- Semantic search

---

## Starter - $15 / mo
*For growing projects.*

**Limits:** 100K writes · 50K recalls / mo

**Features:**
- Everything in Free
- Domain adapters (finance, healthcare, legal)
- Audit log & memory lineage

---

## Growth - $69 / mo
*For production workloads.*

**Limits:** 500K writes · 250K recalls / mo

**Features:**
- Everything in Starter
- Conflict detection
- Webhooks
- Compliance reports
- Merkle audit chain

---

## Pro - $199 / mo ⭐ (highlighted)
*For regulated environments.*

**Limits:** 2M writes · 1M recalls / mo

**Features:**
- Everything in Growth
- Information barriers (PostgreSQL RLS)
- HIPAA encryption
- GDPR erasure certificates
- Backtest contamination check
- Prometheus metrics

---

## Enterprise - Custom pricing
*For banks, hospitals, law firms, insurers, and government - priced by deployment boundary.*

**Limits:** Unlimited writes · Unlimited recalls

**Features:**
- Everything in Pro
- Air-gap mode
- Custom KMS (AWS / Azure / Vault)
- Dedicated onboarding
- SLA & named support

---

**Notes:**
- Overage on paid tiers is metered (writes + recalls) via Stripe usage metering.
- Enterprise is contract-based, not a flat monthly tier - do not position the
  enterprise product as a $200/mo SaaS plan.
- Healthcare requires an executed BAA before PHI is processed.
- Managed Cloud is available only where the customer's compliance posture permits
  hosted processing.

'use strict';

const PLAN_ORDER = ['free', 'starter', 'growth', 'pro', 'enterprise'];

// These scopes are the contract between Clerk Billing, the hosted console, and
// the API keys provisioned for a Lians namespace. The Community server remains
// self-hostable; these entitlements govern Lians-operated services.
const TIER_SCOPES = Object.freeze({
  free: Object.freeze(['read', 'write', 'context']),
  starter: Object.freeze(['read', 'write', 'context', 'adapters', 'audit']),
  growth: Object.freeze([
    'read', 'write', 'context', 'adapters', 'audit', 'conflicts', 'webhooks',
    'compliance', 'graph', 'governance',
  ]),
  pro: Object.freeze([
    'read', 'write', 'adapters', 'audit', 'conflicts', 'webhooks',
    'compliance', 'graph', 'governance', 'barriers', 'hipaa', 'erasure',
    'backtest', 'metrics', 'learning', 'context',
  ]),
  enterprise: Object.freeze([
    'read', 'write', 'adapters', 'audit', 'conflicts', 'webhooks',
    'compliance', 'graph', 'governance', 'barriers', 'hipaa', 'erasure',
    'backtest', 'metrics', 'learning', 'context', 'airgap', 'kms', 'sso',
    'scim', 'private-connectors',
  ]),
});

const TIER_USAGE_LIMITS = Object.freeze({
  free: Object.freeze({ writes: 10_000, recalls: 10_000 }),
  starter: Object.freeze({ writes: 100_000, recalls: 50_000 }),
  growth: Object.freeze({ writes: 500_000, recalls: 250_000 }),
  pro: Object.freeze({ writes: 2_000_000, recalls: 1_000_000 }),
  enterprise: Object.freeze({ writes: null, recalls: null }),
});

const canonicalPlan = (value) => {
  if (typeof value !== 'string') return 'free';
  const normalized = value.trim().toLowerCase().replace(/_/g, '-');
  const candidate = normalized.endsWith('-user') ? normalized.slice(0, -5) : normalized;
  return PLAN_ORDER.includes(candidate) ? candidate : 'free';
};

const scopesForPlan = (plan) => [...TIER_SCOPES[canonicalPlan(plan)]];

const minimumPlanForScope = (scope) => PLAN_ORDER.find((plan) => TIER_SCOPES[plan].includes(scope)) || 'enterprise';

const createEntitlementVerifier = ({ getSubscription, ttlMs = 60_000, maxEntries = 5_000 } = {}) => {
  if (typeof getSubscription !== 'function') throw new TypeError('getSubscription is required');
  const cache = new Map();
  const inflight = new Map();

  const prune = () => {
    const now = Date.now();
    for (const [key, entry] of cache) if (entry.expiresAt <= now) cache.delete(key);
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
  };

  const verify = async (userId, { fresh = false } = {}) => {
    const cached = cache.get(userId);
    if (!fresh && cached && cached.expiresAt > Date.now()) return cached.value;
    if (!fresh && inflight.has(userId)) return inflight.get(userId);

    const request = Promise.resolve()
      .then(() => getSubscription(userId))
      .then((subscription) => {
        const plan = canonicalPlan(subscription?.plan);
        const value = Object.freeze({
          plan,
          providerPlan: subscription?.providerPlan || null,
          status: subscription?.status || null,
          providerFeatures: Object.freeze([...(subscription?.features || [])]),
          scopes: Object.freeze(scopesForPlan(plan)),
        });
        cache.set(userId, { value, expiresAt: Date.now() + ttlMs });
        prune();
        return value;
      })
      .finally(() => inflight.delete(userId));

    inflight.set(userId, request);
    return request;
  };

  const invalidate = (userId) => {
    if (userId) cache.delete(userId);
    else cache.clear();
  };

  return Object.freeze({ verify, invalidate });
};

module.exports = {
  PLAN_ORDER,
  TIER_SCOPES,
  TIER_USAGE_LIMITS,
  canonicalPlan,
  createEntitlementVerifier,
  minimumPlanForScope,
  scopesForPlan,
};

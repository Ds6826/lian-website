'use strict';

const CLERK_API_URL = 'https://api.clerk.com/v1';
const CLERK_API_VERSION = '2026-05-12';
const CLERK_BILLING_TIMEOUT_MS = 7000;
const LIANS_PLANS = new Set(['free', 'starter', 'growth', 'pro', 'enterprise']);

class ClerkBillingError extends Error {
  constructor(message, { status = 502, code = 'CLERK_BILLING_ERROR' } = {}) {
    super(message);
    this.name = 'ClerkBillingError';
    this.status = status;
    this.code = code;
  }
}

const arrayFrom = (value) => (Array.isArray(value) ? value : []);

const canonicalPlanSlug = (value) => {
  if (typeof value !== 'string') return 'free';
  const normalized = value.trim().toLowerCase().replace(/_/g, '-');
  const candidate = normalized.endsWith('-user') ? normalized.slice(0, -5) : normalized;
  return LIANS_PLANS.has(candidate) ? candidate : 'free';
};

const normalizeSubscription = (subscription) => {
  const payload = subscription?.data && !Array.isArray(subscription.data) ? subscription.data : subscription;
  const items = arrayFrom(payload?.subscriptionItems || payload?.subscription_items);
  const activeItems = items.filter((item) => !item?.status || item.status === 'active');
  const rankedItems = [...activeItems].sort((left, right) => {
    const leftDefault = Boolean(left?.plan?.isDefault ?? left?.plan?.is_default);
    const rightDefault = Boolean(right?.plan?.isDefault ?? right?.plan?.is_default);
    return Number(leftDefault) - Number(rightDefault);
  });
  const item = rankedItems.find((candidate) => candidate?.plan?.slug) || null;
  const plan = item?.plan || null;
  const features = arrayFrom(plan?.features)
    .map((feature) => feature?.slug || feature?.key)
    .filter((feature) => typeof feature === 'string' && feature.length > 0);

  const providerPlan = typeof plan?.slug === 'string' ? plan.slug : null;
  return {
    plan: canonicalPlanSlug(providerPlan),
    providerPlan,
    features: [...new Set(features)],
    status: payload?.status || null,
  };
};

const getUserBillingSubscription = async (userId, {
  secretKey = process.env.CLERK_SECRET_KEY,
  fetchImpl = globalThis.fetch,
  timeoutMs = CLERK_BILLING_TIMEOUT_MS,
} = {}) => {
  if (typeof userId !== 'string' || !/^user_[A-Za-z0-9]+$/.test(userId)) {
    throw new ClerkBillingError('A valid Clerk user ID is required.', { status: 400, code: 'INVALID_CLERK_USER_ID' });
  }
  if (typeof secretKey !== 'string' || !secretKey) {
    throw new ClerkBillingError('Clerk billing is not configured.', { status: 503, code: 'CLERK_NOT_CONFIGURED' });
  }
  if (typeof fetchImpl !== 'function') {
    throw new ClerkBillingError('Clerk billing transport is unavailable.', { status: 503, code: 'CLERK_TRANSPORT_UNAVAILABLE' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${CLERK_API_URL}/users/${encodeURIComponent(userId)}/billing/subscription`, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${secretKey}`,
        'Clerk-API-Version': CLERK_API_VERSION,
      },
      signal: controller.signal,
    });
    const body = await response.text();
    let data = null;
    try { data = body ? JSON.parse(body) : null; } catch { /* Clerk returned non-JSON. */ }
    if (!response.ok) {
      const remoteCode = data?.errors?.[0]?.code || data?.code || 'CLERK_BILLING_REQUEST_FAILED';
      throw new ClerkBillingError('Clerk could not verify the billing subscription.', { status: response.status, code: remoteCode });
    }
    return normalizeSubscription(data);
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new ClerkBillingError('Clerk billing verification timed out.', { status: 504, code: 'CLERK_BILLING_TIMEOUT' });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

module.exports = {
  CLERK_API_VERSION,
  ClerkBillingError,
  canonicalPlanSlug,
  getUserBillingSubscription,
  normalizeSubscription,
};

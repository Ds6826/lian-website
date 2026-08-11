'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CLERK_API_VERSION, canonicalPlanSlug, getUserBillingSubscription, normalizeSubscription } = require('../clerk-billing');

test('canonicalPlanSlug maps Clerk payer slugs only to allowlisted Lians tiers', () => {
  assert.equal(canonicalPlanSlug('free_user'), 'free');
  assert.equal(canonicalPlanSlug('STARTER-USER'), 'starter');
  assert.equal(canonicalPlanSlug('growth'), 'growth');
  assert.equal(canonicalPlanSlug('enterprise-admin'), 'free');
  assert.equal(canonicalPlanSlug(null), 'free');
});

test('normalizeSubscription selects the active paid item and deduplicates features', () => {
  assert.deepEqual(normalizeSubscription({
    status: 'active',
    subscription_items: [
      { status: 'active', plan: { slug: 'free', is_default: true, features: [] } },
      { status: 'active', plan: { slug: 'growth', is_default: false, features: [{ slug: 'audit' }, { slug: 'audit' }, { slug: 'webhooks' }] } },
      { status: 'ended', plan: { slug: 'enterprise', features: [{ slug: 'airgap' }] } },
    ],
  }), { plan: 'growth', providerPlan: 'growth', features: ['audit', 'webhooks'], status: 'active' });
});

test('getUserBillingSubscription uses the versioned Clerk Backend API without exposing the secret', async () => {
  let request;
  const result = await getUserBillingSubscription('user_123ABC', {
    secretKey: 'sk_test_do-not-log',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ subscriptionItems: [{ status: 'active', plan: { slug: 'starter', features: [{ slug: 'audit' }] } }] }), { status: 200 });
    },
  });
  assert.deepEqual(result, { plan: 'starter', providerPlan: 'starter', features: ['audit'], status: null });
  assert.equal(request.url, 'https://api.clerk.com/v1/users/user_123ABC/billing/subscription');
  assert.equal(request.options.headers['Clerk-API-Version'], CLERK_API_VERSION);
  assert.equal(request.options.headers.authorization, 'Bearer sk_test_do-not-log');
});

test('getUserBillingSubscription rejects invalid identifiers before making a request', async () => {
  let called = false;
  await assert.rejects(
    getUserBillingSubscription('../users', { secretKey: 'secret', fetchImpl: async () => { called = true; } }),
    (error) => error.code === 'INVALID_CLERK_USER_ID',
  );
  assert.equal(called, false);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canonicalPlan,
  createEntitlementVerifier,
  minimumPlanForScope,
  scopesForPlan,
} = require('../entitlements');

test('unknown provider plans fail closed to the free tier', () => {
  assert.equal(canonicalPlan('unexpected-premium'), 'free');
  assert.deepEqual(scopesForPlan('unexpected-premium'), ['read', 'write', 'context']);
});

test('paid scopes have a stable minimum plan', () => {
  assert.equal(minimumPlanForScope('context'), 'free');
  assert.equal(minimumPlanForScope('audit'), 'starter');
  assert.equal(minimumPlanForScope('governance'), 'growth');
  assert.equal(minimumPlanForScope('learning'), 'pro');
  assert.equal(minimumPlanForScope('sso'), 'enterprise');
});

test('token-reduced context remains available through every plan', () => {
  for (const plan of ['free', 'starter', 'growth', 'pro', 'enterprise']) {
    assert.ok(scopesForPlan(plan).includes('context'), `${plan} must include context`);
  }
});

test('verification is cached and concurrent requests share one provider call', async () => {
  let calls = 0;
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const verifier = createEntitlementVerifier({
    getSubscription: async () => { calls += 1; await wait; return { plan: 'growth', features: ['audit'] }; },
    ttlMs: 10_000,
  });
  const first = verifier.verify('user_123');
  const second = verifier.verify('user_123');
  release();
  const [left, right] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(left, right);
  assert.ok(left.scopes.includes('governance'));
  assert.equal((await verifier.verify('user_123')).plan, 'growth');
  assert.equal(calls, 1);
});

test('invalidating a user forces fresh subscription verification', async () => {
  let plan = 'starter';
  let calls = 0;
  const verifier = createEntitlementVerifier({
    getSubscription: async () => { calls += 1; return { plan }; },
  });
  assert.equal((await verifier.verify('user_456')).plan, 'starter');
  plan = 'pro';
  assert.equal((await verifier.verify('user_456')).plan, 'starter');
  verifier.invalidate('user_456');
  assert.equal((await verifier.verify('user_456')).plan, 'pro');
  assert.equal(calls, 2);
});

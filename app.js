const LIANS_CLIENT_BUILD = 'workflow-perf-20260630-v1';
console.info('Lians client build:', LIANS_CLIENT_BUILD);
const authPage = document.querySelector('#auth-page');
const onboardingPage = document.querySelector('#onboarding-page');
const billingPage = document.querySelector('#billing-page');
const upgradePage = document.querySelector('#upgrade-page');
const consolePage = document.querySelector('#console-page');
const show = (page) => [authPage, onboardingPage, billingPage, upgradePage, consolePage].forEach((item) => {
  const active = item === page;
  item.hidden = !active;
  // These route shells live in one HTML document. The inline display guard keeps
  // inactive shells from appearing even if older CSS overrides `[hidden]`.
  item.style.display = active ? '' : 'none';
});
const onboardingSteps = ['company', 'role', 'use-case', 'tools', 'memory-needs', 'context', 'review'];
const labels = { company: 'What you are building', role: 'Your role', 'use-case': 'Memory use case', tools: 'First connection', 'memory-needs': 'Memory behavior', context: 'Additional context' };
const route = window.location.pathname;
const selectedAnswers = {};
const authBox = document.querySelector('#auth-box');
const callbackBox = document.querySelector('#callback-box');
const workflowState = { running: false, completedCallback: false };
const runtime = {
  token: null,
  tokenAt: 0,
  tokenPromise: null,
  inflight: new Map(),
  keysCache: null,
  keysCacheAt: 0,
};
const PERF_TOKEN_TTL_MS = 45000;
const KEYS_CACHE_TTL_MS = 30000;
const perfLog = (event, metadata = {}) => console.info('[Lians perf]', {
  event,
  route: window.location.pathname,
  build: LIANS_CLIENT_BUILD,
  ...metadata,
});
const onceInFlight = async (key, task) => {
  if (runtime.inflight.has(key)) return runtime.inflight.get(key);
  const promise = Promise.resolve().then(task).finally(() => runtime.inflight.delete(key));
  runtime.inflight.set(key, promise);
  return promise;
};
const workflowLog = (metadata) => console.info('[Lians workflow]', {
  pathname: window.location.pathname,
  clerkLoaded: window.__liansClerkStatus?.state === 'ready',
  signedIn: Boolean(window.Clerk?.user || window.Clerk?.session),
  ...metadata,
});
const renderShellForRoute = (pathname = window.location.pathname) => {
  if (pathname.startsWith('/onboarding')) show(onboardingPage);
  else if (pathname === '/billing') show(billingPage);
  else if (pathname === '/upgrade') show(upgradePage);
  else if (pathname.startsWith('/console')) show(consolePage);
  else show(authPage);
  if (authBox && callbackBox) {
    const isCallback = pathname === '/sso-callback';
    authBox.hidden = isCallback;
    callbackBox.hidden = !isCallback;
  }
};
renderShellForRoute(route);
// Early cookie-based session check on /login — fires before Clerk JS loads so returning
// users with a valid session are sent straight to their destination without seeing the form.
if (route === '/login') {
  fetch('/api/session', { credentials: 'include' }).then((r) => r.ok ? r.json() : null).then((d) => {
    if (d?.authenticated) window.location.assign(d.next || (d.user?.onboardingComplete ? '/console' : '/onboarding/company'));
  }).catch(() => {});
}

const getClerkToken = async ({ fresh = false } = {}) => {
  const now = Date.now();
  if (!fresh && runtime.token && now - runtime.tokenAt < PERF_TOKEN_TTL_MS) return runtime.token;
  if (!fresh && runtime.tokenPromise) return runtime.tokenPromise;
  runtime.tokenPromise = Promise.resolve()
    .then(() => window.Clerk?.session?.getToken?.(fresh ? { skipCache: true } : undefined))
    .then((token) => {
      runtime.token = token || null;
      runtime.tokenAt = Date.now();
      return runtime.token;
    })
    .catch(() => null)
    .finally(() => { runtime.tokenPromise = null; });
  return runtime.tokenPromise;
};
const clerkAuthHeaders = async ({ fresh = false } = {}) => {
  try {
    const token = await getClerkToken({ fresh });
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
};
const authedFetch = async (url, options = {}) => {
  const startedAt = performance.now();
  const method = String(options.method || 'GET').toUpperCase();
  const buildRequest = async (fresh = false) => ({
    ...options,
    credentials: 'include',
    headers: { ...(options.headers || {}), ...(await clerkAuthHeaders({ fresh })) },
  });
  // Always try the cached token first — forcing skipCache contacts clerk.lians.ai which can fail.
  // Fall back to a fresh token only if the server actually rejects the cached one.
  let response = await fetch(url, await buildRequest(false));
  if (response.status === 401) {
    console.info('[Lians auth] Retrying mutating request with a fresh Clerk token.', {
      url,
      method,
      clerkLoaded: window.__liansClerkStatus?.state === 'ready',
      signedIn: Boolean(window.Clerk?.user || window.Clerk?.session),
    });
    response = await fetch(url, await buildRequest(true));
  }
  if (/\/api\/(session|onboarding|keys|demo)/.test(url)) {
    perfLog('api_request', {
      url,
      method,
      status: response.status,
      durationMs: Math.round(performance.now() - startedAt),
    });
  }
  return response;
};
const pathStep = () => route.split('/')[2] || 'company';
const redirectOnce = (destination, reason = 'workflow') => {
  if (!destination) return false;
  const next = destination === '/onboarding' ? '/onboarding/company' : destination;
  if (window.location.pathname === next) return false;
  const now = Date.now();
  const loop = JSON.parse(sessionStorage.getItem('lians:redirectLoop') || '{"count":0,"startedAt":0}');
  const fresh = now - loop.startedAt < 8000;
  const nextLoop = { count: fresh ? loop.count + 1 : 1, startedAt: fresh ? loop.startedAt : now };
  sessionStorage.setItem('lians:redirectLoop', JSON.stringify(nextLoop));
  if (nextLoop.count > 3) {
    workflowLog({ reason: 'redirect_loop_paused', next, loopCount: nextLoop.count });
    const message = 'Workflow routing paused because the app detected a redirect loop. Please refresh or sign out.';
    setAuthMessage(message);
    setCallbackMessage(message);
    return true;
  }
  if (window.__liansRedirectingTo === next) return true;
  window.__liansRedirectingTo = next;
  workflowLog({ reason, next });
  window.location.replace(next);
  return true;
};
const readSession = async () => {
  let response;
  let data = {};
  try {
    response = await authedFetch('/api/session');
    data = await response.json();
  } catch (error) {
    workflowLog({ reason: 'session_fetch_failed', error: error?.message });
    return { status: 0, authenticated: false, next: '/login' };
  }
  workflowLog({ reason: 'session_checked', sessionStatus: response.status, next: data.next, authenticated: Boolean(data.authenticated) });
  return { status: response.status, ...data };
};
const waitForClerkSession = async ({ timeoutMs = 8000 } = {}) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (window.Clerk?.session || window.Clerk?.user) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return Boolean(window.Clerk?.session || window.Clerk?.user);
};
const setOnboardingError = (message, detail = {}) => {
  const activeStep = document.querySelector(`.wizard-step[data-step="${pathStep()}"]`);
  if (!activeStep) return;
  let error = activeStep.querySelector('.onboarding-error');
  if (!error) {
    error = document.createElement('p');
    error.className = 'onboarding-error';
    error.setAttribute('role', 'alert');
    activeStep.append(error);
  }
  error.textContent = message;
  console.warn('[Lians onboarding]', {
    route,
    clerkLoaded: window.__liansClerkStatus?.state === 'ready',
    signedIn: Boolean(window.Clerk?.user || window.Clerk?.session),
    ...detail,
  });
};
const clearOnboardingError = () => document.querySelectorAll('.onboarding-error').forEach((error) => error.remove());
const setWizard = async () => {
  const step = pathStep(); const response = await authedFetch('/api/onboarding'); if (!response.ok) throw new Error('Unable to load onboarding.'); const data = await response.json(); const answers = data.answers || {};
  if (data.onboardingComplete) { window.location.assign('/console'); return; }
  if (data.nextStep && onboardingSteps.indexOf(data.nextStep) > onboardingSteps.indexOf(step)) { window.location.assign(`/onboarding/${data.nextStep}`); return; }
  Object.assign(selectedAnswers, answers);
  document.querySelectorAll('.wizard-step').forEach((panel) => { panel.hidden = panel.dataset.step !== step; });
  document.querySelectorAll('.wizard-progress i').forEach((item, index) => item.classList.toggle('active', index <= onboardingSteps.indexOf(step)));
  document.querySelectorAll('.choice-grid button').forEach((button) => button.classList.toggle('active', answers[button.parentElement.dataset.field] === button.textContent));
  const continueButton = document.querySelector(`.wizard-step[data-step="${step}"] .step-next`);
  if (continueButton && step !== 'context') continueButton.hidden = !selectedAnswers[step];
  if (step === 'context') { document.querySelector('#context').value = answers.context || ''; document.querySelector('#character-count').textContent = (answers.context || '').length; }
  if (step === 'review') document.querySelector('#review-list').innerHTML = Object.entries(labels).map(([key, label]) => `<div><span>${label}</span><b>${answers[key] || '-'}</b></div>`).join('');
};

const BILLING_PLANS = [
  { id: 'free', name: 'Free', price: '$0', period: '/ mo', tagline: 'Start building at no cost.', features: ['Memory writes', 'Memory recalls', 'Semantic search'], cta: 'Get started free' },
  { id: 'starter', name: 'Starter', price: '$15', period: '/ mo', tagline: 'For growing projects.', features: ['Everything in Free', 'Domain adapters', 'Finance, healthcare, legal', 'Audit log'], cta: 'Choose Starter' },
  { id: 'growth', name: 'Growth', price: '$70', period: '/ mo', tagline: 'For production workloads.', features: ['Everything in Starter', 'Conflict detection', 'Webhooks', 'Compliance reports', 'Merkle audit chain'], cta: 'Choose Growth' },
  { id: 'pro', name: 'Pro', price: '$200', period: '/ mo', tagline: 'For regulated environments.', features: ['Everything in Growth', 'Information barriers', 'HIPAA encryption', 'GDPR erasure certifications', 'Backtest', 'Prometheus metrics'], cta: 'Choose Pro', highlight: true },
  { id: 'enterprise', name: 'Enterprise', price: 'Custom', period: '', tagline: 'For enterprise deployments.', features: ['Everything in Pro', 'Air-gap mode', 'Custom KMS (AWS / Azure / Vault)', 'Dedicated onboarding', 'SLA'], cta: 'Contact us', contact: true },
];
const PLAN_NAMES = { free: 'Free', starter: 'Starter', growth: 'Growth', pro: 'Pro', enterprise: 'Enterprise' };
const PLAN_LIMITS = { free: { memories: '10K', recalls: '1K' }, starter: { memories: '100K', recalls: '10K' }, growth: { memories: '1M', recalls: '100K' }, pro: { memories: '10M', recalls: '1M' }, enterprise: { memories: 'Unlimited', recalls: 'Unlimited' } };
const VIEW_SCOPE_REQ = { webhooks: 'webhooks', exports: 'compliance' };
const setBillingPage = () => {
  const grid = document.querySelector('#plan-grid');
  const note = document.querySelector('#billing-note');
  if (!grid) return;

  // Handle successful return from Clerk checkout
  const params = new URLSearchParams(window.location.search);
  const completedPlan = params.get('billing_complete');
  if (completedPlan && ['free', 'starter', 'growth', 'pro', 'enterprise'].includes(completedPlan)) {
    if (note) note.textContent = 'Activating your plan…';
    const syncPromise = completedPlan === 'free'
      ? authedFetch('/api/billing/select', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan: completedPlan }) })
      : authedFetch('/api/billing/sync', { method: 'POST' });
    syncPromise
      .then(async (r) => {
        const result = await r.json().catch(() => ({}));
        if (!r.ok) {
          if (note) note.textContent = result.error || 'Payment not completed. Please choose a plan below.';
          return;
        }
        window.location.assign(result.next || '/console');
      })
      .catch(() => { if (note) note.textContent = 'Unable to activate plan. Please refresh.'; });
    // No early return — grid renders below so the user can retry if payment fails
  }

  const clerkPlanIds = window.__lian_config?.billingPlans || {};
  grid.innerHTML = BILLING_PLANS.map((plan) => `
    <div class="plan-card${plan.highlight ? ' plan-highlight' : ''}">
      <p class="plan-tier">${plan.name}</p>
      <div class="plan-price">${plan.price}${plan.period ? `<small> ${plan.period}</small>` : ''}</div>
      <p class="plan-tagline">${plan.tagline}</p>
      <ul class="plan-features">${plan.features.map((f) => `<li>${f}</li>`).join('')}</ul>
      ${plan.contact
        ? `<a class="plan-cta plan-cta-link" href="https://github.com/Lians-ai/Lians" target="_blank" rel="noreferrer">${plan.cta} ↗</a>`
        : `<button class="plan-cta" data-plan="${plan.id}">${plan.cta}</button>`}
    </div>`).join('');

  grid.querySelectorAll('.plan-cta[data-plan]').forEach((btn) => btn.addEventListener('click', async () => {
    const plan = btn.dataset.plan;
    if (note) note.textContent = '';
    grid.querySelectorAll('.plan-cta').forEach((b) => { b.disabled = true; });

    // Free plan: record immediately, no payment needed
    if (plan === 'free') {
      const response = await authedFetch('/api/billing/select', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        grid.querySelectorAll('.plan-cta').forEach((b) => { b.disabled = false; });
        if (note) note.textContent = result.error || 'Unable to select plan. Please refresh and try again.';
        return;
      }
      window.location.assign(result.next || '/console');
      return;
    }

    // Paid plans: launch Clerk billing checkout
    const clerkPlanId = clerkPlanIds[plan];
    const origin = window.__lian_config?.canonicalOrigin || window.location.origin;
    const clerkBilling = window.Clerk?.billing;
    const clerkAllKeys = window.Clerk ? Object.getOwnPropertyNames(window.Clerk).filter((k) => /bill|sub|checkout|payment|plan/i.test(k)) : [];
    console.info('[Lians billing debug]', {
      plan,
      clerkPlanId,
      hasBillingNs: Boolean(clerkBilling),
      billingType: typeof clerkBilling,
      billingOwnKeys: clerkBilling ? Object.getOwnPropertyNames(clerkBilling) : [],
      billingProtoKeys: clerkBilling ? Object.getOwnPropertyNames(Object.getPrototypeOf(clerkBilling) || {}) : [],
      hasStartCheckout: typeof clerkBilling?.startCheckout,
      clerkBillingRelatedKeys: clerkAllKeys,
      clerkVersion: window.Clerk?.version,
    });
    const startCheckout = clerkBilling?.startCheckout;
    if (clerkPlanId && startCheckout) {
      if (note) note.textContent = 'Opening checkout…';
      try {
        // Clerk v5 billing is a modal — no successUrl/cancelUrl. The Promise resolves when the modal closes.
        await startCheckout.call(window.Clerk.billing, { planId: clerkPlanId });
        if (note) note.textContent = 'Activating your plan…';
        const syncRes = await authedFetch('/api/billing/sync', { method: 'POST' });
        const syncResult = await syncRes.json().catch(() => ({}));
        if (!syncRes.ok) {
          grid.querySelectorAll('.plan-cta').forEach((b) => { b.disabled = false; });
          if (note) note.textContent = syncResult.error || 'Payment not completed. Please try again.';
          return;
        }
        window.location.assign(syncResult.next || '/console');
      } catch (err) {
        grid.querySelectorAll('.plan-cta').forEach((b) => { b.disabled = false; });
        if (note) note.textContent = '';
        console.error('[Lians billing]', err);
      }
      return;
    }

    // Clerk billing SDK not available — most likely cause: Stripe is not connected to
    // your Clerk account. Go to Clerk Dashboard → Configure → Billing → Connect Stripe.
    console.error('[Lians billing] window.Clerk.billing.startCheckout is not available.', {
      billing: window.Clerk?.billing,
      clerkVersion: window.Clerk?.version,
    });
    grid.querySelectorAll('.plan-cta').forEach((b) => { b.disabled = false; });
    if (note) note.textContent = 'Billing checkout is not available. Please refresh and try again.';
  }));
};
const doSignOut = async () => {
  try { if (window.Clerk?.signOut) await window.Clerk.signOut(); } catch (e) {}
  await fetch('/api/logout', { method: 'POST' }).catch(() => {});
  window.location.assign('/login');
};
document.querySelector('#billing-sign-out')?.addEventListener('click', doSignOut);
document.querySelector('#upgrade-sign-out')?.addEventListener('click', doSignOut);

const PLAN_ORDER = ['free', 'starter', 'growth', 'pro', 'enterprise'];
const setUpgradePage = (sessionData) => {
  const currentPlan = sessionData?.user?.billingPlan || 'free';
  const currentIndex = PLAN_ORDER.indexOf(currentPlan);
  const sub = document.querySelector('#upgrade-sub');
  const grid = document.querySelector('#upgrade-plan-grid');
  const note = document.querySelector('#upgrade-note');
  const upgradable = BILLING_PLANS.filter((plan) => PLAN_ORDER.indexOf(plan.id) > currentIndex);
  const currentLabel = BILLING_PLANS.find((p) => p.id === currentPlan)?.name || 'Free';
  if (sub) sub.innerHTML = `You're on the <strong>${currentLabel}</strong> plan. Upgrade to unlock more of Lians.`;
  if (!grid) return;
  if (!upgradable.length) {
    grid.innerHTML = '<p class="upgrade-maxed">You\'re on our highest tier. <a href="https://github.com/Lians-ai/Lians" target="_blank" rel="noreferrer">Contact us</a> for custom solutions.</p>';
    return;
  }
  const clerkPlanIds = window.__lian_config?.billingPlans || {};
  grid.innerHTML = upgradable.map((plan) => `
    <div class="plan-card${plan.highlight ? ' plan-highlight' : ''}">
      <p class="plan-tier">${plan.name}</p>
      <div class="plan-price">${plan.price}${plan.period ? `<small> ${plan.period}</small>` : ''}</div>
      <p class="plan-tagline">${plan.tagline}</p>
      <ul class="plan-features">${plan.features.map((f) => `<li>${f}</li>`).join('')}</ul>
      ${plan.contact
        ? `<a class="plan-cta plan-cta-link" href="https://github.com/Lians-ai/Lians" target="_blank" rel="noreferrer">${plan.cta} ↗</a>`
        : `<button class="plan-cta" data-plan="${plan.id}">${plan.cta}</button>`}
    </div>`).join('');
  grid.querySelectorAll('.plan-cta[data-plan]').forEach((btn) => btn.addEventListener('click', async () => {
    const plan = btn.dataset.plan;
    if (note) note.textContent = '';
    grid.querySelectorAll('.plan-cta').forEach((b) => { b.disabled = true; });
    const clerkPlanId = clerkPlanIds[plan];
    const origin = window.__lian_config?.canonicalOrigin || window.location.origin;
    const startCheckoutUpgrade = window.Clerk?.billing?.startCheckout;
    if (clerkPlanId && startCheckoutUpgrade) {
      if (note) note.textContent = 'Opening checkout…';
      try {
        await startCheckoutUpgrade.call(window.Clerk.billing, { planId: clerkPlanId });
        if (note) note.textContent = 'Activating your plan…';
        const syncRes = await authedFetch('/api/billing/sync', { method: 'POST' });
        const syncResult = await syncRes.json().catch(() => ({}));
        if (!syncRes.ok) {
          grid.querySelectorAll('.plan-cta').forEach((b) => { b.disabled = false; });
          if (note) note.textContent = syncResult.error || 'Payment not completed. Please try again.';
          return;
        }
        window.location.assign('/console');
      } catch (err) {
        grid.querySelectorAll('.plan-cta').forEach((b) => { b.disabled = false; });
        if (note) note.textContent = '';
        console.error('[Lians upgrade]', err);
      }
      return;
    }
    console.error('[Lians upgrade] window.Clerk.billing.startCheckout is not available.', { billing: window.Clerk?.billing });
    grid.querySelectorAll('.plan-cta').forEach((b) => { b.disabled = false; });
    if (note) note.textContent = 'Billing checkout is not available. Please refresh and try again.';
  }));
};

document.querySelectorAll('.choice-grid button').forEach((button) => button.addEventListener('click', () => {
  clearOnboardingError();
  const field = button.parentElement.dataset.field;
  selectedAnswers[field] = button.textContent;
  button.parentElement.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
  const continueButton = button.closest('.wizard-step').querySelector('.step-next');
  if (continueButton) continueButton.hidden = false;
}));
document.querySelector('#context').addEventListener('input', (event) => { document.querySelector('#character-count').textContent = event.target.value.length; });
document.querySelectorAll('.step-next').forEach((button) => button.addEventListener('click', async () => {
  if (button.dataset.loading === 'true') return;
  const step = pathStep();
  const value = step === 'context' ? document.querySelector('#context').value : selectedAnswers[step];
  if (step !== 'context' && !value) return;
  clearOnboardingError();
  const originalHtml = button.innerHTML;
  button.dataset.loading = 'true';
  button.disabled = true;
  button.innerHTML = 'Saving… <span>→</span>';
  const endpoint = `/api/onboarding/${step}`;
  const response = await onceInFlight(`onboarding:${step}`, () => authedFetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value }) }));
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    button.dataset.loading = 'false';
    button.disabled = false;
    button.innerHTML = originalHtml;
    if (result.next) redirectOnce(result.next, 'onboarding_save_server_next');
    return setOnboardingError('We could not save this onboarding step. Please refresh and try again.', {
      endpoint,
      status: response.status,
      message: result.error || response.statusText,
      tokenPresent: Boolean(await clerkAuthHeaders().then((headers) => headers.authorization)),
    });
  }
  const idx = onboardingSteps.indexOf(step);
  window.location.assign(idx >= 0 && idx < onboardingSteps.length - 1 ? `/onboarding/${onboardingSteps[idx + 1]}` : '/console');
}));
document.querySelector('.onboarding-submit').addEventListener('click', async () => {
  const button = document.querySelector('.onboarding-submit');
  if (button.dataset.loading === 'true') return;
  clearOnboardingError();
  button.dataset.loading = 'true';
  button.disabled = true;
  button.textContent = 'Creating workspace…';
  const endpoint = '/api/onboarding/complete';
  const response = await onceInFlight('onboarding:complete', () => authedFetch(endpoint, { method: 'POST' }));
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    button.dataset.loading = 'false';
    button.disabled = false;
    button.innerHTML = 'Proceed to Console <span>→</span>';
    if (result.next) redirectOnce(result.next, 'onboarding_complete_server_next');
    return setOnboardingError('We could not finish onboarding. Please refresh and try again.', {
      endpoint,
      status: response.status,
      message: result.error || response.statusText,
      tokenPresent: Boolean(await clerkAuthHeaders().then((headers) => headers.authorization)),
    });
  }
  window.location.assign(result.next);
});
document.querySelector('#back-to-auth').addEventListener('click', doSignOut);

const authButtons = document.querySelectorAll('[data-auth-provider]');
const authNote = document.querySelector('.auth-note');
const setAuthMessage = (message) => { if (authNote) authNote.textContent = message; };
const setAuthButtonsDisabled = (disabled) => authButtons.forEach((button) => {
  button.setAttribute('aria-disabled', String(disabled));
  button.tabIndex = disabled ? -1 : 0;
});
const beginSocialSignIn = async (provider) => {
  const status = window.__liansClerkStatus?.state;
  if (status === 'error') return setAuthMessage(window.__liansClerkStatus.detail);
  if (!window.Clerk || status !== 'ready') return setAuthMessage('Secure sign-in is loading. Please wait a moment.');
  // window.location.origin is always the right host here — the server-side 301 ensures the user
  // is already on www.lians.ai (or localhost) before this code runs.
  try {
    await window.Clerk.client.signIn.authenticateWithRedirect({
      strategy: `oauth_${provider}`,
      redirectUrl: `${window.location.origin}/sso-callback`,
      redirectUrlComplete: `${window.location.origin}/sso-callback`,
      continueSignIn: true,
      continueSignUp: true,
    });
  } catch (error) {
    const clerkError = error?.errors?.[0]?.longMessage || error?.errors?.[0]?.message || error?.message;
    const message = /Origin header must be equal to or a subdomain/i.test(clerkError || '')
      ? 'This Clerk key is configured for the production domain. For local testing, use Clerk development keys or configure localhost in Clerk.'
      : clerkError;
    setAuthMessage(message || `Unable to continue with ${provider === 'google' ? 'Google' : 'GitHub'}. Check that this connection is enabled in Clerk.`);
  }
};
authButtons.forEach((button) => button.addEventListener('click', (event) => { event.preventDefault(); beginSocialSignIn(button.dataset.authProvider); }));
const setCallbackMessage = (msg) => { const el = document.querySelector('#callback-note'); if (el) el.textContent = msg; };
const handleClerkError = (message) => {
  setAuthButtonsDisabled(true);
  setAuthMessage(message);
  if (route === '/sso-callback') setCallbackMessage(message);
  if (route.startsWith('/console') || route.startsWith('/onboarding')) redirectOnce('/login', 'clerk_error_protected_route');
};
const completeClerkCallback = async () => {
  if (route !== '/sso-callback' || workflowState.completedCallback) return;
  workflowState.completedCallback = true;
  renderShellForRoute('/sso-callback');
  setCallbackMessage('Finishing secure sign-in…');
  // Quick sanity check: warn if the current origin doesn't match the canonical origin.
  const canonicalOrigin = window.__lian_config?.canonicalOrigin;
  if (canonicalOrigin && !canonicalOrigin.includes(window.location.hostname)) {
    console.warn('[sso-callback] Origin mismatch: page is on', window.location.hostname, 'but BASE_URL is', canonicalOrigin, '— session cookies may not apply.');
  }
  // Check that Clerk got redirect params — if the URL has no Clerk markers, something went wrong upstream.
  const hasClerkParams = window.location.href.includes('__clerk') || window.location.hash.includes('__clerk');
  if (!hasClerkParams) console.warn('[sso-callback] No Clerk redirect parameters found in URL — OAuth may not have completed.');
  try {
    // Clerk JS v5 processes the OAuth callback inside Clerk.load() and sets Clerk.user before
    // the ready event fires. Calling handleRedirectCallback after that throws "no pending redirect".
    // Check for a live session first; only fall back to handleRedirectCallback if not yet signed in.
    if (window.Clerk.user || window.Clerk.session) {
      await waitForClerkSession();
      await runWorkflowGate('callback_signed_in');
      return;
    }
    await window.Clerk.handleRedirectCallback({
      signInFallbackRedirectUrl: '/sso-callback',
      signUpFallbackRedirectUrl: '/sso-callback',
    }, async () => {});
    // handleRedirectCallback may navigate on its own; if still here, route manually.
    await waitForClerkSession();
    await runWorkflowGate('callback_completed');
  } catch (err) {
    const detail = err?.errors?.[0]?.longMessage || err?.errors?.[0]?.message || err?.message || String(err);
    console.error('[sso-callback] Clerk callback error:', detail);
    // Clerk v5 may throw AND have already signed the user in — check before showing error.
    if (window.Clerk?.user || window.Clerk?.session) { await runWorkflowGate('callback_error_signed_in'); return; }
    const friendly = /no pending/i.test(detail) ? 'Sign-in session was not found after redirect. Try signing in again.' : detail || 'We could not complete secure sign-in. Please try again.';
    setCallbackMessage(friendly);
  }
};
const loadConsolePlan = async () => {
  try {
    const r = await authedFetch('/api/billing');
    if (!r.ok) return;
    const { plan = 'free', scopes = [] } = await r.json();
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
    const usageEl = document.querySelector('.usage');
    if (usageEl) usageEl.innerHTML = `<span>${PLAN_NAMES[plan] || plan} plan</span><p>Memories <b>0 / ${limits.memories}</b></p><div><i></i></div><p>Recall <b>0 / ${limits.recalls}</b></p><div><i></i></div>`;
    for (const [view, scope] of Object.entries(VIEW_SCOPE_REQ)) {
      if (scopes.includes(scope)) continue;
      document.querySelector(`.nav-item[data-view="${view}"]`)?.classList.add('locked');
      const wrap = document.querySelector(`#view-${view} .view-wrap`);
      if (wrap) {
        const [section, title] = viewMeta[view] || ['ACTIVITY', view];
        wrap.innerHTML = `<p class="console-eyebrow">${section}</p><h1>${title}</h1><div class="upgrade-prompt"><h3>Upgrade to unlock ${title}</h3><p>This feature is not available on your current plan.</p><button class="console-button" onclick="window.location.assign('/upgrade')">View upgrade options <span>→</span></button></div>`;
      }
    }
  } catch {}
};
const runWorkflowGate = async (reason = 'clerk_ready') => {
  if (workflowState.running && route !== '/sso-callback') return;
  workflowState.running = true;
  const signedIn = Boolean(window.Clerk?.user || window.Clerk?.session);
  workflowLog({ reason: `${reason}:start` });
  if (route === '/sso-callback') {
    if (!signedIn) {
      const hasSession = await waitForClerkSession();
      if (!hasSession) {
        workflowLog({ reason: 'callback_no_session_after_wait' });
        setCallbackMessage('Sign-in did not finish. Please return to login and try again.');
        workflowState.running = false;
        return;
      }
    }
    const sessionData = await readSession();
    if (sessionData.authenticated) redirectOnce(sessionData.next || '/onboarding/company', 'callback_session_ready');
    else redirectOnce('/onboarding/company', 'callback_clerk_signed_in_session_pending');
    return;
  }
  if (!signedIn) {
    if (route.startsWith('/console') || route.startsWith('/onboarding') || route === '/billing' || route === '/upgrade') redirectOnce('/login', 'protected_route_signed_out');
    workflowState.running = false;
    return;
  }
  const sessionData = await readSession();
  if (!sessionData.authenticated) {
    if (route === '/login' || route.startsWith('/console')) redirectOnce('/onboarding/company', 'signed_in_session_pending');
    workflowState.running = false;
    return;
  }
  const destination = sessionData.next || (
    !sessionData.user?.onboardingComplete ? '/onboarding/company' :
    !sessionData.user?.billingPlan ? '/billing' : '/console'
  );
  if (route === '/login') {
    window.location.assign(destination);
    return;
  }
  if (route.startsWith('/console') && destination !== '/console') {
    window.location.assign(destination);
    return;
  }
  if (route.startsWith('/console') && destination === '/console') {
    document.querySelector('#console-gate')?.classList.add('cleared');
    loadConsolePlan();
    workflowState.running = false;
    return;
  }
  if (route === '/billing') {
    if (destination !== '/billing') { window.location.assign(destination); return; }
    setBillingPage();
    workflowState.running = false;
    return;
  }
  if (route === '/upgrade') {
    if (destination !== '/console') { window.location.assign(destination); return; }
    // Handle return from Clerk checkout on the upgrade flow
    const upgradeParams = new URLSearchParams(window.location.search);
    const upgradedPlan = upgradeParams.get('billing_complete');
    if (upgradedPlan && ['starter', 'growth', 'pro', 'enterprise'].includes(upgradedPlan)) {
      const upgradeNote = document.querySelector('#upgrade-note');
      if (upgradeNote) upgradeNote.textContent = 'Activating your plan…';
      authedFetch('/api/billing/sync', { method: 'POST' })
        .then((r) => r.json().catch(() => ({})))
        .then(() => window.location.assign('/console'))
        .catch(() => window.location.assign('/console'));
      return;
    }
    setUpgradePage(sessionData);
    workflowState.running = false;
    return;
  }
  if (route.startsWith('/onboarding')) {
    if (destination === '/console' || destination === '/billing') {
      window.location.assign(destination);
      return;
    }
    try { await setWizard(); } catch (err) { setOnboardingError('Unable to load your onboarding state. Please refresh to try again.', { error: err.message }); }
  }
  workflowState.running = false;
};
const onClerkReady = () => {
  setAuthButtonsDisabled(false);
  if (route === '/sso-callback') completeClerkCallback();
  else if (route === '/login' || route.startsWith('/onboarding') || route === '/billing' || route === '/upgrade' || route.startsWith('/console')) runWorkflowGate('clerk_ready');
};
window.addEventListener('lians:clerk-error', (event) => handleClerkError(event.detail));
window.addEventListener('lians:clerk-loading', () => setAuthButtonsDisabled(true));
window.addEventListener('lians:clerk-ready', onClerkReady);
if (window.__liansClerkStatus?.state === 'error') handleClerkError(window.__liansClerkStatus.detail);
if (window.__liansClerkStatus?.state === 'loading') setAuthButtonsDisabled(true);
if (window.__liansClerkStatus?.state === 'ready') onClerkReady();

const installContent = { python: [['Install the SDK', 'Install the local-first Python SDK. No Docker or account is required for the first run.', 'pip <em>install</em> Lians-sdk[local]'], ['Add a memory', 'Store an event with its real-world timestamp and structured metadata.', 'mem.<em>add</em>(agent_id="analyst-1", content="NVDA guidance raised to $40B")'], ['Recall at a point in time', 'Ask what was valid when a decision was made.', 'mem.<em>recall_at</em>(agent_id="analyst-1", query="NVDA guidance", as_of=...)']], node: [['Install the SDK', 'Add the Node package to your existing agent application.', 'npm <em>install</em> Lians'], ['Create the client', 'Use your local or hosted Lians endpoint.', 'import { <em>LianClient</em> } from "Lians"'], ['Recall a fact', 'Request context that is valid right now or at a prior date.', 'await client.<em>recall</em>({ query: "NVDA guidance" })']], curl: [['Write a memory', 'Send a fact, its event time, and metadata to the memory service.', 'curl -X <em>POST</em> /v1/memories'], ['Recall it', 'Use the optional as_of field for historical recall.', 'curl -X <em>POST</em> /v1/recall'], ['Verify the trail', 'Reconstruct the memory state behind an agent decision.', 'curl /v1/audit/<em>reconstruct</em>']] };
const renderSteps = (language) => { document.querySelector('#install-steps').innerHTML = installContent[language].map((step, index) => `<article class="install-step"><span class="step-number">${index + 1}</span><div><h3>${step[0]}</h3><p>${step[1]}</p></div><div class="code-block"><header>${language}</header><pre>${step[2]}</pre></div></article>`).join(''); };
renderSteps('python');
document.querySelectorAll('.language-tabs button').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('.language-tabs button').forEach((item) => item.classList.remove('active')); button.classList.add('active'); renderSteps(button.dataset.language); }));
document.querySelectorAll('.path-card').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('.path-card').forEach((item) => item.classList.remove('active')); button.classList.add('active'); }));

const viewMeta = { 'get-started': ['SETUP', 'Get started'], playground: ['SETUP', 'Playground'], 'api-keys': ['SETUP', 'API keys'], dashboard: ['ACTIVITY', 'Dashboard'], requests: ['ACTIVITY', 'Requests'], entities: ['ACTIVITY', 'Entities'], memories: ['ACTIVITY', 'Memories'], graph: ['ACTIVITY', 'Graph'], webhooks: ['ACTIVITY', 'Webhooks'], exports: ['ACTIVITY', 'Memory exports'], settings: ['ACCOUNT', 'Settings'], billing: ['ACCOUNT', 'Usage & billing'] };
const activateView = (view, updateUrl = false) => {
  if (!viewMeta[view]) view = 'get-started';
  document.querySelectorAll('.nav-item[data-view]').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  document.querySelectorAll('.view').forEach((item) => item.classList.toggle('active', item.id === `view-${view}`));
  document.querySelector('#view-label').textContent = viewMeta[view][0];
  document.querySelector('#view-title').textContent = viewMeta[view][1];
  if (updateUrl) {
    const nextUrl = `/console/${view}`;
    if (window.location.pathname !== nextUrl) window.history.pushState({ view }, '', nextUrl);
  }
  if (view === 'api-keys') loadKeys();
};
document.querySelectorAll('.nav-item[data-view]').forEach((button) => button.addEventListener('click', () => activateView(button.dataset.view, true)));
if (route.startsWith('/console')) activateView(route.split('/')[2] || 'get-started');
window.addEventListener('popstate', () => {
  if (window.location.pathname.startsWith('/console')) activateView(window.location.pathname.split('/')[2] || 'get-started');
});
document.querySelector('#run-recall').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  if (button.dataset.loading === 'true') return;
  button.dataset.loading = 'true';
  button.disabled = true;
  const answer = document.querySelector('#playground-answer');
  try {
    const result = await (await onceInFlight('demo:recall', () => authedFetch('/api/demo/recall', { method: 'POST' }))).json();
    answer.querySelector('strong').textContent = result.value;
    answer.querySelector('p').textContent = result.content;
    answer.querySelector('small').textContent = `✓ ${result.audit}`;
    answer.hidden = false;
  } finally {
    button.dataset.loading = 'false';
    button.disabled = false;
  }
});
const formatDate = (value) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const renderKeys = (keys) => {
  const table = document.querySelector('#key-table');
  table.querySelectorAll('.key-row').forEach((row) => row.remove());
  document.querySelector('#key-state').hidden = keys.length > 0;
  keys.forEach((key) => {
    const row = document.createElement('div');
    row.className = 'key-row';
    row.innerHTML = `<b>${key.label}</b><code>${key.prefix}</code><span>${formatDate(key.createdAt)}</span><span class="key-status ${key.revokedAt ? 'revoked' : ''}">${key.revokedAt ? 'Revoked' : 'Active'}</span><button data-rotate="${key.id}" ${key.revokedAt ? 'disabled' : ''} style="margin-right:4px">Rotate</button><button data-revoke="${key.id}" ${key.revokedAt ? 'disabled' : ''}>${key.revokedAt ? 'Revoked' : 'Revoke'}</button>`;
    table.append(row);
  });
  document.querySelectorAll('[data-revoke]').forEach((button) => button.addEventListener('click', async () => {
    if (button.dataset.loading === 'true') return;
    button.dataset.loading = 'true';
    button.disabled = true;
    await onceInFlight(`keys:revoke:${button.dataset.revoke}`, () => authedFetch(`/api/keys/${button.dataset.revoke}`, { method: 'DELETE' }));
    runtime.keysCache = null;
    loadKeys({ force: true });
  }));
  document.querySelectorAll('[data-rotate]').forEach((button) => button.addEventListener('click', async () => {
    if (button.dataset.loading === 'true') return;
    if (!confirm('Rotate this key? The current key will stop working immediately.')) return;
    button.dataset.loading = 'true';
    button.disabled = true;
    const res = await onceInFlight(`keys:rotate:${button.dataset.rotate}`, () => authedFetch(`/api/keys/${button.dataset.rotate}/rotate`, { method: 'POST' }));
    if (!res.ok) {
      button.dataset.loading = 'false';
      button.disabled = false;
      return;
    }
    const { rawKey } = await res.json();
    document.querySelector('#new-key-secret').textContent = rawKey;
    document.querySelector('#key-reveal').hidden = false;
    document.querySelector('#copy-key').textContent = 'Copy';
    runtime.keysCache = null;
    loadKeys({ force: true });
  }));
};
async function loadKeys({ force = false } = {}) {
  const cached = runtime.keysCache && Date.now() - runtime.keysCacheAt < KEYS_CACHE_TTL_MS;
  if (!force && cached) {
    renderKeys(runtime.keysCache);
    return;
  }
  const data = await onceInFlight('keys:list', async () => {
    const response = await authedFetch('/api/keys');
    if (!response.ok) return null;
    return response.json();
  });
  if (!data) return;
  const { keys, freshKey } = data;
  runtime.keysCache = keys;
  runtime.keysCacheAt = Date.now();
  renderKeys(keys);
  if (freshKey) {
    document.querySelector('#new-key-secret').textContent = freshKey.rawKey;
    document.querySelector('#key-reveal').hidden = false;
    document.querySelector('#copy-key').textContent = 'Copy';
  }
}
document.querySelector('#key-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  if (submit?.dataset.loading === 'true') return;
  const label = document.querySelector('#key-name').value;
  if (submit) {
    submit.dataset.loading = 'true';
    submit.disabled = true;
  }
  try {
    const response = await onceInFlight('keys:create', () => authedFetch('/api/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label }) }));
    const result = await response.json();
    if (!response.ok) return document.querySelector('#backend-note').textContent = result.error || 'Unable to create key.';
    document.querySelector('#new-key-secret').textContent = result.rawKey;
    document.querySelector('#key-reveal').hidden = false;
    document.querySelector('#key-name').value = '';
    runtime.keysCache = null;
    loadKeys({ force: true });
  } finally {
    if (submit) {
      submit.dataset.loading = 'false';
      submit.disabled = false;
    }
  }
});
document.querySelector('#copy-key').addEventListener('click', async () => { await navigator.clipboard.writeText(document.querySelector('#new-key-secret').textContent); document.querySelector('#copy-key').textContent = 'Copied'; });
document.querySelector('#save-settings').addEventListener('click', () => alert('Settings saved.'));
document.querySelector('#sign-out').addEventListener('click', doSignOut);
document.querySelector('.upgrade-button')?.addEventListener('click', () => window.location.assign('/upgrade'));
document.querySelector('.mobile-menu').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('open'));

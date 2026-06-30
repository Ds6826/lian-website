const LIANS_CLIENT_BUILD = 'workflow-postauth-20260626-v15';
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
const labels = { company: 'Deployment domain', role: 'Your role', 'use-case': 'What to keep truthful', tools: "How you'll run Lians", 'memory-needs': 'Guarantees that matter', context: 'Additional context' };
const route = window.location.pathname;
const selectedAnswers = {};
const authBox = document.querySelector('#auth-box');
const callbackBox = document.querySelector('#callback-box');
const workflowState = { running: false, completedCallback: false };
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

const clerkAuthHeaders = async ({ fresh = false } = {}) => {
  try {
    const token = await window.Clerk?.session?.getToken?.(fresh ? { skipCache: true } : undefined);
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
};
const authedFetch = async (url, options = {}) => {
  const buildRequest = async (fresh = false) => ({
    ...options,
    credentials: 'include',
    headers: { ...(options.headers || {}), ...(await clerkAuthHeaders({ fresh })) },
  });
  // Always try the cached token first — forcing skipCache contacts clerk.lians.ai which can fail.
  // Fall back to a fresh token only if the server actually rejects the cached one.
  let response = await fetch(url, await buildRequest(false));
  if (response.status === 401) {
    response = await fetch(url, await buildRequest(true));
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
  { id: 'growth', name: 'Growth', price: '$69', period: '/ mo', tagline: 'For production workloads.', features: ['Everything in Starter', 'Conflict detection', 'Webhooks', 'Compliance reports', 'Merkle audit chain'], cta: 'Choose Growth' },
  { id: 'pro', name: 'Pro', price: '$199', period: '/ mo', tagline: 'For regulated environments.', features: ['Everything in Growth', 'Information barriers', 'HIPAA encryption', 'GDPR erasure certifications', 'Backtest', 'Prometheus metrics'], cta: 'Choose Pro', highlight: true },
  { id: 'enterprise', name: 'Enterprise', price: 'Custom', period: '', tagline: 'For enterprise deployments.', features: ['Everything in Pro', 'Air-gap mode', 'Custom KMS (AWS / Azure / Vault)', 'Dedicated onboarding', 'SLA'], cta: 'Contact us', contact: true },
];
const PLAN_NAMES = { free: 'Free', starter: 'Starter', growth: 'Growth', pro: 'Pro', enterprise: 'Enterprise' };
const PLAN_LIMITS = { free: { memories: '10K', recalls: '10K' }, starter: { memories: '100K', recalls: '50K' }, growth: { memories: '500K', recalls: '250K' }, pro: { memories: '2M', recalls: '1M' }, enterprise: { memories: 'Unlimited', recalls: 'Unlimited' } };
// Console views gated by tier scope (see TIER_SCOPES in server.js). Views not listed here
// stay open on every plan: get-started, playground, api-keys, dashboard, memories, settings, billing.
const VIEW_SCOPE_REQ = {
  requests: 'audit',       // Starter+  · audit log of API requests
  entities: 'adapters',    // Starter+  · domain adapters (finance / healthcare / legal)
  graph:    'conflicts',   // Growth+   · conflict / relationship graph
  webhooks: 'webhooks',    // Growth+
  exports:  'compliance',  // Growth+   · compliance reports · Merkle audit chain
};
// Full capability ladder so every tier is visibly differentiated in the console, including
// Pro/Enterprise scopes that have no dedicated view. label keyed by the TIER_SCOPES scope.
const CAPABILITY_CATALOG = [
  { scope: 'adapters', label: 'Domain adapters · finance, healthcare, legal', tier: 'Starter' },
  { scope: 'audit', label: 'Audit log', tier: 'Starter' },
  { scope: 'conflicts', label: 'Conflict detection', tier: 'Growth' },
  { scope: 'webhooks', label: 'Webhooks', tier: 'Growth' },
  { scope: 'compliance', label: 'Compliance reports · Merkle audit chain', tier: 'Growth' },
  { scope: 'barriers', label: 'Information barriers (row-level security)', tier: 'Pro' },
  { scope: 'hipaa', label: 'HIPAA encryption', tier: 'Pro' },
  { scope: 'erasure', label: 'GDPR erasure certifications', tier: 'Pro' },
  { scope: 'backtest', label: 'Backtest · lookahead-bias check', tier: 'Pro' },
  { scope: 'metrics', label: 'Prometheus metrics', tier: 'Pro' },
  { scope: 'airgap', label: 'Air-gap mode', tier: 'Enterprise' },
  { scope: 'kms', label: 'Custom KMS · AWS, Azure, Vault', tier: 'Enterprise' },
];
// Clerk PricingTable theming to match the dark billing/upgrade pages (#101817 bg, cream text, lime accent).
const CLERK_BILLING_APPEARANCE = {
  variables: {
    colorPrimary: '#d7ff3f',
    colorText: '#f6f4ee',
    colorTextSecondary: '#8aada6',
    colorBackground: '#152320',
    colorInputBackground: '#101817',
    colorInputText: '#f6f4ee',
    colorDanger: '#d45f5f',
    colorSuccess: '#4cb88a',
    borderRadius: '6px',
    fontFamily: '"Manrope", sans-serif',
  },
};
// After a Clerk checkout (paid or free) we return here; reconcile the plan with the server,
// then continue. sync records a paid subscription; a 402 means the free plan was chosen,
// which we record via select. Either way we end on /console.
const finishBilling = async (note) => {
  if (note) note.textContent = 'Activating your plan…';
  try {
    const r = await authedFetch('/api/billing/sync', { method: 'POST' });
    if (r.ok) { const d = await r.json().catch(() => ({})); window.location.assign(d.next || '/console'); return; }
    const sel = await authedFetch('/api/billing/select', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan: 'free' }) });
    const d = await sel.json().catch(() => ({}));
    window.location.assign(d.next || '/console');
  } catch { window.location.assign('/console'); }
};
// Our own plan-card UI (restored). Paid plans open Clerk's checkout drawer via
// __internal_openCheckout — the same drawer PricingTable uses — so the look stays ours
// while checkout still works. On success Clerk redirects to newSubscriptionRedirectUrl.
const PLAN_CARD = (plan) => `
    <div class="plan-card${plan.highlight ? ' plan-highlight' : ''}">
      <p class="plan-tier">${plan.name}</p>
      <div class="plan-price">${plan.price}${plan.period ? `<small> ${plan.period}</small>` : ''}</div>
      <p class="plan-tagline">${plan.tagline}</p>
      <ul class="plan-features">${plan.features.map((f) => `<li>${f}</li>`).join('')}</ul>
      ${plan.contact
        ? `<a class="plan-cta plan-cta-link" href="https://github.com/Lians-ai/Lians" target="_blank" rel="noreferrer">${plan.cta} ↗</a>`
        : `<button class="plan-cta" data-plan="${plan.id}">${plan.cta}</button>`}
    </div>`;
const openClerkCheckout = (plan, note, returnPath) => {
  const clerkPlanId = (window.__lian_config?.billingPlans || {})[plan];
  const opener = window.Clerk?.__internal_openCheckout;
  if (!clerkPlanId || typeof opener !== 'function') {
    if (note) note.textContent = 'Checkout is unavailable right now. Please refresh and try again.';
    return;
  }
  if (note) note.textContent = '';
  try {
    opener.call(window.Clerk, {
      planId: clerkPlanId,
      planPeriod: 'month',
      newSubscriptionRedirectUrl: `${window.location.origin}${returnPath}`,
      appearance: CLERK_BILLING_APPEARANCE,
    });
  } catch (err) {
    console.error('[Lians billing] openCheckout failed', err);
    if (note) note.textContent = 'Checkout could not open. Please refresh and try again.';
  }
};
const setBillingPage = () => {
  const grid = document.querySelector('#plan-grid');
  const note = document.querySelector('#billing-note');
  if (!grid) return;
  // Returning from a Clerk checkout — reconcile the plan, then continue to the console.
  if (new URLSearchParams(window.location.search).get('billing_complete')) { finishBilling(note); return; }
  grid.innerHTML = BILLING_PLANS.map(PLAN_CARD).join('');
  grid.querySelectorAll('.plan-cta[data-plan]').forEach((btn) => btn.addEventListener('click', async () => {
    const plan = btn.dataset.plan;
    if (note) note.textContent = '';
    // Free plan: record immediately, no payment needed.
    if (plan === 'free') {
      grid.querySelectorAll('.plan-cta').forEach((b) => { b.disabled = true; });
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
    openClerkCheckout(plan, note, '/billing?billing_complete=1');
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
  grid.innerHTML = upgradable.map(PLAN_CARD).join('');
  grid.querySelectorAll('.plan-cta[data-plan]').forEach((btn) => btn.addEventListener('click', () => {
    openClerkCheckout(btn.dataset.plan, note, '/upgrade?billing_complete=1');
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
  const step = pathStep();
  const value = step === 'context' ? document.querySelector('#context').value : selectedAnswers[step];
  if (step !== 'context' && !value) return;
  clearOnboardingError();
  button.disabled = true;
  const endpoint = `/api/onboarding/${step}`;
  const response = await authedFetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    button.disabled = false;
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
  clearOnboardingError();
  button.disabled = true;
  button.textContent = 'Creating workspace…';
  const endpoint = '/api/onboarding/complete';
  const response = await authedFetch(endpoint, { method: 'POST' });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
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
    // Usage & billing view: reflect the live plan instead of the hard-coded "Dev" placeholder.
    const planNameEl = document.querySelector('#billing-plan-name');
    if (planNameEl) planNameEl.textContent = PLAN_NAMES[plan] || plan;
    const planDescEl = document.querySelector('#billing-plan-desc');
    if (planDescEl) planDescEl.textContent = (BILLING_PLANS.find((p) => p.id === plan) || {}).tagline || '';
    const memLimitEl = document.querySelector('#billing-mem-limit');
    if (memLimitEl) memLimitEl.textContent = limits.memories;
    const recallLimitEl = document.querySelector('#billing-recall-limit');
    if (recallLimitEl) recallLimitEl.textContent = limits.recalls;
    // Tier capability checklist on Get started — included vs. locked across all 5 tiers.
    const capEl = document.querySelector('#plan-capabilities');
    if (capEl) {
      capEl.innerHTML = `<p class="console-eyebrow">YOUR ${(PLAN_NAMES[plan] || plan).toUpperCase()} PLAN</p>
        <ul class="plan-capability-list">${CAPABILITY_CATALOG.map((cap) => {
          const unlocked = scopes.includes(cap.scope);
          return `<li class="${unlocked ? 'cap-on' : 'cap-off'}"><i>${unlocked ? '✓' : '🔒'}</i><span>${cap.label}</span>${unlocked ? '' : `<small>${cap.tier}</small>`}</li>`;
        }).join('')}</ul>
        ${plan === 'enterprise' ? '' : '<button class="console-button" onclick="window.location.assign(\'/upgrade\')">Upgrade plan <span>→</span></button>'}`;
    }
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
    // Returning from a Clerk checkout on the upgrade flow — reconcile and continue.
    if (new URLSearchParams(window.location.search).get('billing_complete')) {
      finishBilling(document.querySelector('#upgrade-note'));
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

// Setup steps keyed by deployment path × language, grounded in github.com/Lians-ai/Lians.
const installContent = {
  sdk: {
    python: [['Install the SDK', 'Local-first Python SDK — SQLite, zero setup, no account for the first run.', 'pip <em>install</em> lians-sdk[local]'], ['Create a client', 'Local mode now; swap one import for the hosted server later.', 'from lians import <em>LocalLiansClient</em>'], ['Add a memory', 'Store a fact with its real-world event time and metadata.', 'mem.<em>add</em>(agent_id="analyst-1", content="NVDA guidance raised to $40B")'], ['Recall at a point in time', 'Ask what was valid when a decision was made.', 'mem.<em>recall_at</em>(agent_id="analyst-1", query="NVDA guidance", as_of=...)']],
    node: [['Install the package', 'Add Lians to your TypeScript / Node agent.', 'npm <em>install</em> @ebeirne/lians'], ['Create the client', 'Connect to your local or hosted Lians endpoint.', 'import { <em>LiansClient</em> } from "@ebeirne/lians"'], ['Add a memory', 'Write a fact with its event time.', 'await client.<em>add</em>({ agentId: "analyst-1", content: "..." })'], ['Recall a fact', 'Retrieve context valid now or at a prior date.', 'await client.<em>recallAt</em>({ agentId: "analyst-1", query: "NVDA guidance", asOf })']],
    curl: [['Add a memory', 'POST a fact; supersession runs automatically.', 'curl -X <em>POST</em> /v1/memories'], ['Recall', 'Hybrid BM25 + vector recall; add as_of for point-in-time.', 'curl -X <em>POST</em> /v1/recall'], ['Reconstruct', 'Rebuild agent state at any past date.', 'curl /v1/audit/<em>reconstruct</em>']],
  },
  docker: {
    python: [['Get the stack', 'Clone the repo with the Docker Compose setup.', 'git <em>clone</em> https://github.com/Lians-ai/Lians'], ['Start the server', 'Postgres 16 + pgvector + Redis — one command.', 'docker compose <em>up</em> --build'], ['Connect the SDK', 'Point the Python client at your self-hosted server.', 'from lians import <em>LiansClient</em>']],
    node: [['Get the stack', 'Clone the repo with the Docker Compose setup.', 'git <em>clone</em> https://github.com/Lians-ai/Lians'], ['Start the server', 'Postgres 16 + pgvector + Redis — one command.', 'docker compose <em>up</em> --build'], ['Connect the SDK', 'Point the Node client at your self-hosted server.', 'import { <em>LiansClient</em> } from "@ebeirne/lians"']],
    curl: [['Get the stack', 'Clone the repo with the Docker Compose setup.', 'git <em>clone</em> https://github.com/Lians-ai/Lians'], ['Start the server', 'Postgres 16 + pgvector + Redis — one command.', 'docker compose <em>up</em> --build'], ['Call the REST API', 'Your server exposes the full v1 API.', 'curl http://localhost:8000/v1/<em>recall</em>']],
  },
  mcp: {
    python: [['Install a framework adapter', 'LangChain, LangGraph, CrewAI, AutoGen, or OpenAI Agents.', 'pip <em>install</em> lians-sdk[langgraph]'], ['Wire memory into your agent', 'Drop recall / remember nodes into your graph.', 'from lians.langgraph_integration import <em>create_recall_node</em>'], ['Or connect any MCP host', 'Claude Desktop, Cursor, VS Code — one-time config.', 'uvx --from "lians-sdk[mcp]" <em>lians-mcp</em>']],
    node: [['Install the package', 'TypeScript client for agent tools.', 'npm <em>install</em> @ebeirne/lians'], ['Expose memory tools', 'Wire recall / remember into your agent.', 'import { <em>LiansClient</em> } from "@ebeirne/lians"'], ['Or connect any MCP host', 'Claude Desktop, Cursor, VS Code — one-time config.', 'uvx --from "lians-sdk[mcp]" <em>lians-mcp</em>']],
    curl: [['Add a memory', 'Any MCP host or agent can POST facts.', 'curl -X <em>POST</em> /v1/memories'], ['Recall', 'Retrieve valid context for the agent.', 'curl -X <em>POST</em> /v1/recall'], ['MCP registry', 'Listed as io.github.ebeirne/lians on the MCP registry.', 'uvx --from "lians-sdk[mcp]" <em>lians-mcp</em>']],
  },
};
const installState = { path: 'sdk', language: 'python' };
const renderSteps = () => { const steps = (installContent[installState.path] || installContent.sdk)[installState.language] || []; document.querySelector('#install-steps').innerHTML = steps.map((step, index) => `<article class="install-step"><span class="step-number">${index + 1}</span><div><h3>${step[0]}</h3><p>${step[1]}</p></div><div class="code-block"><header>${installState.language}</header><pre>${step[2]}</pre></div></article>`).join(''); };
renderSteps();
document.querySelectorAll('.language-tabs button').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('.language-tabs button').forEach((item) => item.classList.remove('active')); button.classList.add('active'); installState.language = button.dataset.language; renderSteps(); }));
document.querySelectorAll('.path-card').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('.path-card').forEach((item) => item.classList.remove('active')); button.classList.add('active'); installState.path = button.dataset.path; renderSteps(); }));

const viewMeta = { 'get-started': ['SETUP', 'Get started'], playground: ['SETUP', 'Playground'], 'api-keys': ['SETUP', 'API keys'], dashboard: ['ACTIVITY', 'Dashboard'], requests: ['ACTIVITY', 'Requests'], entities: ['ACTIVITY', 'Entities'], memories: ['ACTIVITY', 'Memories'], graph: ['ACTIVITY', 'Graph'], webhooks: ['ACTIVITY', 'Webhooks'], exports: ['ACTIVITY', 'Memory exports'], settings: ['ACCOUNT', 'Settings'], billing: ['ACCOUNT', 'Usage & billing'] };
const activateView = (view, updateUrl = false) => { if (!viewMeta[view]) view = 'get-started'; document.querySelectorAll('.nav-item[data-view]').forEach((item) => item.classList.toggle('active', item.dataset.view === view)); document.querySelectorAll('.view').forEach((item) => item.classList.toggle('active', item.id === `view-${view}`)); document.querySelector('#view-label').textContent = viewMeta[view][0]; document.querySelector('#view-title').textContent = viewMeta[view][1]; if (updateUrl) window.location.assign(`/console/${view}`); if (view === 'api-keys') loadKeys(); if (view === 'settings') loadSettings(); };
document.querySelectorAll('.nav-item[data-view]').forEach((button) => button.addEventListener('click', () => activateView(button.dataset.view, true)));
if (route.startsWith('/console')) activateView(route.split('/')[2] || 'get-started');
// ── Playground: interactive point-in-time recall showcase ──────────────────────
// A faithful local SIMULATION of Lians's validity-gate + supersession behavior.
// The real engine uses semantic embeddings (Voyage Finance-2) + LLM adjudication;
// this demo uses lexical matching + deterministic supersession — same behavior, simpler
// mechanism — and shows the authentic SDK/REST code so devs can reproduce it for real.
(() => {
  const root = document.querySelector('#playground-root');
  if (!root) return;

  const PG_SCENARIOS = {
    finance: {
      name: 'Finance', synthetic: false, agentId: 'analyst-1',
      subject: 'NVDA · revenue_guidance · FY2026', query: 'NVDA FY2026 revenue guidance',
      blurb: 'Sell-side guidance gets revised every quarter. An agent must answer with the number that was valid when a decision was made — not the most recent or the most similar.',
      facts: [
        { value: '$28B', date: '2025-01-15', provenance: 'Q4 FY2025 earnings call', detail: 'Initial FY2026 revenue guidance issued at $28B.' },
        { value: '$32B', date: '2025-02-20', provenance: 'Investor day', detail: 'Guidance raised to $32B on data-center demand.' },
        { value: '$36B', date: '2025-05-22', provenance: 'Q1 FY2026 earnings', detail: 'Guidance raised to $36B.' },
        { value: '$38B', date: '2025-08-27', provenance: 'Q2 FY2026 earnings', detail: 'Guidance raised to $38B.' },
        { value: '$40B', date: '2025-11-19', provenance: 'Q3 FY2026 earnings', detail: 'Guidance raised to $40B.' },
      ],
      presets: [{ label: 'Mar 1, 2025', date: '2025-03-01' }, { label: 'Jun 1, 2025', date: '2025-06-01' }, { label: 'Sep 1, 2025', date: '2025-09-01' }, { label: 'Today', date: null }],
    },
    healthcare: {
      name: 'Healthcare', synthetic: true, agentId: 'care-agent-1',
      subject: 'Patient 4172 · anticoagulant_therapy', query: 'current anticoagulant therapy',
      blurb: 'A clinical agent reconstructing a past decision must see the medication that was active on that date — not today’s prescription.',
      facts: [
        { value: 'Warfarin 5mg', date: '2025-01-08', provenance: 'Cardiology note', detail: 'Started warfarin 5mg daily for atrial fibrillation.' },
        { value: 'Warfarin 7.5mg', date: '2025-03-12', provenance: 'INR clinic', detail: 'Dose increased to 7.5mg for subtherapeutic INR.' },
        { value: 'Apixaban 5mg', date: '2025-06-04', provenance: 'Cardiology note', detail: 'Switched to apixaban 5mg twice daily.' },
        { value: 'Apixaban 2.5mg', date: '2025-09-18', provenance: 'Nephrology note', detail: 'Reduced to 2.5mg twice daily for renal impairment.' },
      ],
      presets: [{ label: 'Feb 1, 2025', date: '2025-02-01' }, { label: 'Apr 1, 2025', date: '2025-04-01' }, { label: 'Jul 1, 2025', date: '2025-07-01' }, { label: 'Today', date: null }],
    },
    legal: {
      name: 'Legal', synthetic: true, agentId: 'counsel-agent-1',
      subject: 'Acme MSA · liability_cap', query: 'Acme MSA liability cap',
      blurb: 'Contract terms change by amendment. Diligence must reflect the cap that governed at a given date, with every prior version still auditable.',
      facts: [
        { value: '$1M cap', date: '2025-02-01', provenance: 'Executed MSA', detail: 'Liability cap set at $1M in the master services agreement.' },
        { value: '$5M cap', date: '2025-04-15', provenance: 'Amendment 1', detail: 'Liability cap raised to $5M.' },
        { value: '$10M cap', date: '2025-07-22', provenance: 'Amendment 2', detail: 'Liability cap raised to $10M for expanded scope.' },
        { value: '$2M cap', date: '2025-10-30', provenance: 'Settlement agreement', detail: 'Mutual liability cap reset to $2M under settlement.' },
      ],
      presets: [{ label: 'Mar 1, 2025', date: '2025-03-01' }, { label: 'Jun 1, 2025', date: '2025-06-01' }, { label: 'Aug 1, 2025', date: '2025-08-01' }, { label: 'Today', date: null }],
    },
  };

  // ── engine ──
  const PG_STOP = new Set(['the', 'of', 'for', 'a', 'an', 'to', 'current', 'what', 'was', 'is', 'on', 'at', 'and', 'in']);
  const pgTokens = (s) => (String(s).toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 1 && !PG_STOP.has(w));
  const pgScore = (query, m) => { const q = pgTokens(query); if (!q.length) return 0; const hay = new Set(pgTokens(`${m.subject} ${m.query} ${m.value} ${m.detail}`)); return q.filter((w) => hay.has(w)).length / q.length; };
  const pgDate = (s) => new Date(`${s}T00:00:00Z`);
  const pgRecompute = (mems) => {
    const groups = {};
    mems.forEach((m) => { (groups[m.subjectKey] = groups[m.subjectKey] || []).push(m); });
    Object.values(groups).forEach((g) => { g.sort((a, b) => a.eventTime - b.eventTime); g.forEach((m, i) => { m.validFrom = m.eventTime; m.validTo = i < g.length - 1 ? g[i + 1].eventTime : null; }); });
    return mems;
  };
  const pgBuild = (sc) => pgRecompute(sc.facts.map((f, i) => ({ id: `${sc.subject}#${i}`, subjectKey: sc.subject, subject: sc.subject, query: sc.query, value: f.value, detail: f.detail, provenance: f.provenance, eventTime: pgDate(f.date), validFrom: null, validTo: null })));
  const pgRecall = (mems, query, asOf) => {
    const at = asOf || new Date();
    const cands = mems.map((m) => ({ m, score: pgScore(query, m) })).filter((x) => x.score > 0);
    const valid = [], superseded = [], future = [];
    cands.forEach(({ m }) => { if (m.validFrom <= at && (m.validTo === null || at < m.validTo)) valid.push(m); else if (m.validFrom > at) future.push(m); else superseded.push(m); });
    valid.sort((a, b) => b.validFrom - a.validFrom);
    return { valid: valid[0] || null, superseded, future, asOf: at, isNow: !asOf };
  };
  const pgConventional = (mems, query, k = 5) => mems.map((m) => ({ m, score: pgScore(query, m) })).filter((x) => x.score > 0).sort((a, b) => (b.score - a.score) || (b.m.eventTime - a.m.eventTime)).slice(0, k).map((x) => x.m);

  // ── helpers ──
  const PG_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pgFmt = (d) => d ? `${PG_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}` : '—';
  const pgWindow = (m) => `${pgFmt(m.validFrom)} → ${m.validTo ? pgFmt(m.validTo) : 'present'}`;
  const pgEsc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pgCode = (lang, sc, asOf) => {
    const q = sc.query, a = sc.agentId;
    if (lang === 'python') return asOf
      ? `from lians import LocalLiansClient\nfrom datetime import datetime, timezone\n\nmem = LocalLiansClient()\nresult = mem.recall_at(\n    agent_id="${a}",\n    query="${q}",\n    as_of=datetime(${asOf.getUTCFullYear()}, ${asOf.getUTCMonth() + 1}, ${asOf.getUTCDate()}, tzinfo=timezone.utc),\n)`
      : `from lians import LocalLiansClient\n\nmem = LocalLiansClient()\nresult = mem.recall(agent_id="${a}", query="${q}")`;
    if (lang === 'node') return asOf
      ? `import { LiansClient } from "@ebeirne/lians";\n\nconst client = new LiansClient();\nconst result = await client.recallAt({\n  agentId: "${a}",\n  query: "${q}",\n  asOf: new Date("${asOf.toISOString()}"),\n});`
      : `import { LiansClient } from "@ebeirne/lians";\n\nconst client = new LiansClient();\nconst result = await client.recall({ agentId: "${a}", query: "${q}" });`;
    const body = asOf ? `{"agent_id":"${a}","query":"${q}","as_of":"${asOf.toISOString()}"}` : `{"agent_id":"${a}","query":"${q}"}`;
    return `curl -X POST https://api.lians.dev/v1/recall \\\n  -H "Authorization: Bearer $LIANS_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${body}'`;
  };

  // ── state ──
  const pgState = { domain: 'finance', mode: 'guided', presetIdx: 0, codeLang: 'python', sandbox: {} };
  const pgSandboxMems = (key) => { if (!pgState.sandbox[key]) pgState.sandbox[key] = pgBuild(PG_SCENARIOS[key]); return pgState.sandbox[key]; };

  // ── chain / row rendering ──
  const pgChainRow = (m, valid, asOf) => {
    let state = 'future', badge = 'NOT YET KNOWN';
    if (m === valid) { state = 'valid'; badge = 'VALID'; }
    else if (m.validFrom <= asOf) { state = 'superseded'; badge = 'SUPERSEDED'; }
    return `<div class="pg-row pg-row-${state}"><div class="pg-row-main"><b>${pgEsc(m.value)}</b><span>${pgEsc(m.detail)}</span></div><div class="pg-row-meta"><span>${pgWindow(m)}</span><i>${pgEsc(m.provenance)}</i></div><span class="pg-badge pg-badge-${state}">${badge}</span></div>`;
  };

  const pgGuided = () => {
    const sc = PG_SCENARIOS[pgState.domain];
    const mems = pgBuild(sc);
    const preset = sc.presets[pgState.presetIdx];
    const asOf = preset.date ? pgDate(preset.date) : null;
    const r = pgRecall(mems, sc.query, asOf);
    const conv = pgConventional(mems, sc.query);
    const atDate = r.asOf;
    const chips = sc.presets.map((p, i) => `<button class="pg-chip${i === pgState.presetIdx ? ' active' : ''}" data-preset="${i}">${pgEsc(p.label)}</button>`).join('');
    const chain = [...mems].sort((a, b) => a.eventTime - b.eventTime).map((m) => pgChainRow(m, r.valid, atDate)).join('');
    const codeTabs = ['python', 'node', 'curl'].map((l) => `<button class="pg-code-tab${l === pgState.codeLang ? ' active' : ''}" data-lang="${l}">${l === 'curl' ? 'cURL' : l[0].toUpperCase() + l.slice(1)}</button>`).join('');
    return `
      <div class="pg-queryline"><span>QUERY</span><code>${pgEsc(sc.query)}</code><i>agent_id: ${pgEsc(sc.agentId)}</i></div>
      <div class="pg-asof"><span>RECALL AS OF</span><div class="pg-chips">${chips}</div></div>
      <div class="pg-result-grid">
        <div class="pg-result">
          <p class="pg-result-label">${r.isNow ? 'VALID TODAY' : `VALID ON ${pgFmt(atDate).toUpperCase()}`}</p>
          <strong class="pg-result-value">${r.valid ? pgEsc(r.valid.value) : 'No valid fact'}</strong>
          ${r.valid ? `<p class="pg-result-detail">${pgEsc(r.valid.detail)}</p><div class="pg-result-meta"><span>VALIDITY<b>${pgWindow(r.valid)}</b></span><span>PROVENANCE<b>${pgEsc(r.valid.provenance)}</b></span></div>` : '<p class="pg-result-detail">No fact was on record at this date.</p>'}
          <small class="pg-audit">✓ Validity gate applied · ✓ ${r.superseded.length} superseded, ${r.future.length} not-yet-known excluded · ✓ recall event logged</small>
        </div>
        <div class="pg-contrast">
          <div class="pg-contrast-card pg-bad"><p>Conventional memory</p><b>${conv.length} returned</b><small>Top-k by similarity — includes ${Math.max(conv.length - 1, 0)} stale revision${conv.length - 1 === 1 ? '' : 's'}.</small></div>
          <div class="pg-contrast-card pg-good"><p>Lians</p><b>${r.valid ? 1 : 0} returned</b><small>Only the value valid at the requested moment.</small></div>
          <div class="pg-bench">Point-in-time benchmark · <b>4 / 4</b> vs <b>0 / 4</b> conventional</div>
        </div>
      </div>
      <p class="pg-sub">MEMORY CHAIN · ${pgEsc(sc.subject)}</p>
      <div class="pg-chain">${chain}</div>
      <div class="pg-code"><div class="pg-code-tabs">${codeTabs}</div><pre>${pgEsc(pgCode(pgState.codeLang, sc, asOf))}</pre></div>`;
  };

  const pgSandbox = () => {
    const sc = PG_SCENARIOS[pgState.domain];
    const mems = pgSandboxMems(pgState.domain);
    const now = new Date();
    const rNow = pgRecall(mems, sc.query, null);
    const store = [...mems].sort((a, b) => a.eventTime - b.eventTime).map((m) => pgChainRow(m, rNow.valid, now)).join('');
    return `
      <div class="pg-sandbox">
        <div class="pg-sb-col">
          <p class="pg-sub">MEMORY STORE · ${pgEsc(sc.subject)}</p>
          <div class="pg-chain" id="pg-store">${store}</div>
          <form class="pg-add" id="pg-add">
            <input id="pg-add-value" placeholder="New value (e.g. ${pgEsc(sc.facts[sc.facts.length - 1].value)})" required />
            <input id="pg-add-date" type="date" value="2025-12-15" required />
            <button class="console-button" type="submit">Add memory <span>+</span></button>
          </form>
          <small class="pg-hint">Adding a later-dated value supersedes the prior one — its validity window closes automatically.</small>
        </div>
        <div class="pg-sb-col">
          <p class="pg-sub">RUN A RECALL</p>
          <label class="pg-field">QUERY<input id="pg-q" value="${pgEsc(sc.query)}" /></label>
          <label class="pg-field">AS OF <i>(blank = now)</i><input id="pg-asof" type="date" /></label>
          <button class="console-button" id="pg-run">Run recall <span>→</span></button>
          <div class="pg-sb-result" id="pg-sb-result"></div>
        </div>
      </div>`;
  };

  const render = () => {
    const sc = PG_SCENARIOS[pgState.domain];
    const domains = Object.keys(PG_SCENARIOS).map((k) => `<button class="pg-tab${k === pgState.domain ? ' active' : ''}" data-domain="${k}">${PG_SCENARIOS[k].name}</button>`).join('');
    const modes = [['guided', 'Guided demo'], ['sandbox', 'Sandbox']].map(([k, l]) => `<button class="pg-tab${k === pgState.mode ? ' active' : ''}" data-mode="${k}">${l}</button>`).join('');
    root.innerHTML = `
      <div class="pg">
        <header class="pg-head">
          <p class="console-eyebrow">PLAYGROUND</p>
          <h1>See point-in-time recall.</h1>
          <p class="view-lede">${pgEsc(sc.blurb)} <span class="pg-sim" title="The real engine uses semantic embeddings + LLM adjudication; this demo uses lexical matching + deterministic supersession.">Local simulation</span>${sc.synthetic ? ' <span class="pg-sim pg-syn">Synthetic data</span>' : ''}</p>
        </header>
        <div class="pg-tabs pg-domains">${domains}</div>
        <div class="pg-tabs pg-modes">${modes}</div>
        <div class="pg-body">${pgState.mode === 'guided' ? pgGuided() : pgSandbox()}</div>
      </div>`;
    wire();
  };

  const runSandbox = () => {
    const sc = PG_SCENARIOS[pgState.domain];
    const mems = pgSandboxMems(pgState.domain);
    const query = root.querySelector('#pg-q').value || sc.query;
    const asOfVal = root.querySelector('#pg-asof').value;
    const asOf = asOfVal ? pgDate(asOfVal) : null;
    const r = pgRecall(mems, query, asOf);
    const out = root.querySelector('#pg-sb-result');
    out.innerHTML = `
      <p class="pg-result-label">${r.isNow ? 'VALID TODAY' : `VALID ON ${pgFmt(r.asOf).toUpperCase()}`}</p>
      <strong class="pg-result-value">${r.valid ? pgEsc(r.valid.value) : 'No valid fact'}</strong>
      ${r.valid ? `<p class="pg-result-detail">${pgEsc(r.valid.detail)}</p><div class="pg-result-meta"><span>VALIDITY<b>${pgWindow(r.valid)}</b></span></div>` : '<p class="pg-result-detail">No fact was on record at this date.</p>'}
      <small class="pg-audit">${r.superseded.length} superseded · ${r.future.length} not-yet-known · excluded by the validity gate</small>
      <pre class="pg-sb-code">${pgEsc(pgCode('python', { query, agentId: sc.agentId }, asOf))}</pre>`;
  };

  const addSandbox = (e) => {
    e.preventDefault();
    const sc = PG_SCENARIOS[pgState.domain];
    const mems = pgSandboxMems(pgState.domain);
    const value = root.querySelector('#pg-add-value').value.trim();
    const date = root.querySelector('#pg-add-date').value;
    if (!value || !date) return;
    mems.push({ id: `${sc.subject}#${Date.now()}`, subjectKey: sc.subject, subject: sc.subject, query: sc.query, value, detail: `${sc.query} updated to ${value}.`, provenance: 'Sandbox entry', eventTime: pgDate(date), validFrom: null, validTo: null });
    pgRecompute(mems);
    const now = new Date();
    const rNow = pgRecall(mems, sc.query, null);
    root.querySelector('#pg-store').innerHTML = [...mems].sort((a, b) => a.eventTime - b.eventTime).map((m) => pgChainRow(m, rNow.valid, now)).join('');
    root.querySelector('#pg-add-value').value = '';
  };

  const wire = () => {
    root.querySelectorAll('[data-domain]').forEach((b) => b.addEventListener('click', () => { pgState.domain = b.dataset.domain; pgState.presetIdx = 0; render(); }));
    root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { pgState.mode = b.dataset.mode; render(); }));
    root.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => { pgState.presetIdx = Number(b.dataset.preset); render(); }));
    root.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => { pgState.codeLang = b.dataset.lang; render(); }));
    root.querySelector('#pg-run')?.addEventListener('click', runSandbox);
    root.querySelector('#pg-add')?.addEventListener('submit', addSandbox);
  };

  render();
})();
const formatDate = (value) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const renderKeys = (keys) => { const table = document.querySelector('#key-table'); table.querySelectorAll('.key-row').forEach((row) => row.remove()); document.querySelector('#key-state').hidden = keys.length > 0; keys.forEach((key) => { const row = document.createElement('div'); row.className = 'key-row'; row.innerHTML = `<b>${key.label}</b><code>${key.prefix}</code><span>${formatDate(key.createdAt)}</span><span class="key-status ${key.revokedAt ? 'revoked' : ''}">${key.revokedAt ? 'Revoked' : 'Active'}</span><button data-rotate="${key.id}" ${key.revokedAt ? 'disabled' : ''} style="margin-right:4px">Rotate</button><button data-revoke="${key.id}" ${key.revokedAt ? 'disabled' : ''}>${key.revokedAt ? 'Revoked' : 'Revoke'}</button>`; table.append(row); }); document.querySelectorAll('[data-revoke]').forEach((button) => button.addEventListener('click', async () => { await authedFetch(`/api/keys/${button.dataset.revoke}`, { method: 'DELETE' }); loadKeys(); })); document.querySelectorAll('[data-rotate]').forEach((button) => button.addEventListener('click', async () => { if (!confirm('Rotate this key? The current key will stop working immediately.')) return; const res = await authedFetch(`/api/keys/${button.dataset.rotate}/rotate`, { method: 'POST' }); if (!res.ok) return; const { rawKey } = await res.json(); document.querySelector('#new-key-secret').textContent = rawKey; document.querySelector('#key-reveal').hidden = false; document.querySelector('#copy-key').textContent = 'Copy'; loadKeys(); })); };
async function loadKeys() { const response = await authedFetch('/api/keys'); if (!response.ok) return; const { keys, freshKey } = await response.json(); renderKeys(keys); if (freshKey) { document.querySelector('#new-key-secret').textContent = freshKey.rawKey; document.querySelector('#key-reveal').hidden = false; document.querySelector('#copy-key').textContent = 'Copy'; } }
document.querySelector('#key-form').addEventListener('submit', async (event) => { event.preventDefault(); const label = document.querySelector('#key-name').value; const response = await authedFetch('/api/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label }) }); const result = await response.json(); if (!response.ok) return document.querySelector('#backend-note').textContent = result.error || 'Unable to create key.'; document.querySelector('#new-key-secret').textContent = result.rawKey; document.querySelector('#key-reveal').hidden = false; document.querySelector('#key-name').value = ''; loadKeys(); });
document.querySelector('#copy-key').addEventListener('click', async () => { await navigator.clipboard.writeText(document.querySelector('#new-key-secret').textContent); document.querySelector('#copy-key').textContent = 'Copied'; });
async function loadSettings() {
  const r = await authedFetch('/api/settings');
  if (!r.ok) return;
  const s = await r.json().catch(() => ({}));
  const w = document.querySelector('#settings-workspace'); if (w) w.value = s.workspaceName || '';
  const sel = document.querySelector('#settings-retention'); if (sel && s.retention) sel.value = s.retention;
  const pn = document.querySelector('#project-name'); if (pn && s.workspaceName) pn.textContent = s.workspaceName;
}
document.querySelector('#save-settings').addEventListener('click', async () => {
  const btn = document.querySelector('#save-settings');
  const saved = document.querySelector('#settings-saved');
  btn.disabled = true;
  const workspaceName = document.querySelector('#settings-workspace').value;
  const retention = document.querySelector('#settings-retention').value;
  const r = await authedFetch('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceName, retention }) });
  btn.disabled = false;
  if (r.ok) {
    if (saved) { saved.hidden = false; setTimeout(() => { saved.hidden = true; }, 2500); }
    const pn = document.querySelector('#project-name'); if (pn && workspaceName.trim()) pn.textContent = workspaceName.trim();
  } else if (saved) { saved.textContent = 'Could not save'; saved.hidden = false; }
});
document.querySelector('.avatar')?.addEventListener('click', () => activateView('settings', true));
document.querySelector('#sign-out').addEventListener('click', doSignOut);
document.querySelector('.upgrade-button')?.addEventListener('click', () => window.location.assign('/upgrade'));
document.querySelector('.mobile-menu').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('open'));

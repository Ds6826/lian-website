const LIANS_CLIENT_BUILD = 'workflow-billing-20260630-v15';
console.info('Lians client build:', LIANS_CLIENT_BUILD);
const authPage = document.querySelector('#auth-page');
const onboardingPage = document.querySelector('#onboarding-page');
const billingPage = document.querySelector('#billing-page');
const upgradePage = document.querySelector('#upgrade-page');
const consolePage = document.querySelector('#console-page');
const show = (page) => [authPage, onboardingPage, billingPage, upgradePage, consolePage].filter(Boolean).forEach((item) => {
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
const signOutStartedAt = Number(sessionStorage.getItem('lians:signingOutAt') || 0);
const recentlySignedOut = signOutStartedAt && Date.now() - signOutStartedAt < 12000;
if (route === '/login' && !recentlySignedOut) {
  fetch('/api/session', { credentials: 'include' }).then((r) => r.ok ? r.json() : null).then((d) => {
    if (d?.authenticated) window.location.assign(d.next || '/onboarding/company');
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
  document.querySelectorAll('.choice-grid button').forEach((button) => { const saved = (answers[button.parentElement.dataset.field] || '').split(',').map((s) => s.trim()); button.classList.toggle('active', saved.includes(button.textContent.trim())); });
  const continueButton = document.querySelector(`.wizard-step[data-step="${step}"] .step-next`);
  if (continueButton) continueButton.hidden = false;
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
const VIEW_SCOPE_REQ = { webhooks: 'webhooks', exports: 'compliance' };
// Mount Clerk's maintained PricingTable (plans + full checkout drawer) into a node.
// Returns true if mounted; false → caller falls back to the legacy custom flow.
const mountClerkPricingTable = (node, redirectUrl) => {
  const clerk = window.Clerk;
  const mount = clerk?.mountPricingTable || clerk?.__experimental_mountPricingTable;
  if (typeof mount !== 'function' || !node) return false;
  try {
    node.innerHTML = '';
    node.classList.add('clerk-pricing-host');
    mount.call(clerk, node, {
      newSubscriptionRedirectUrl: redirectUrl,
      appearance: { variables: { colorPrimary: '#4169e1', colorBackground: '#0f1117', colorText: '#e8eaf1', colorTextSecondary: '#8e97aa', colorInputBackground: '#161922', colorInputText: '#e8eaf1', colorNeutral: '#e8eaf1', borderRadius: '0px' } },
    });
    return true;
  } catch (err) {
    console.error('[Lians billing] mountPricingTable failed; using fallback', err);
    node.classList.remove('clerk-pricing-host');
    return false;
  }
};
// This clerk-js build (v5) exposes no vanilla CheckoutButton mount. Instead it ships
// clerk.billing.getPlans() (real plan ids + slugs) and clerk.__internal_openCheckout()
// (the same themed drawer opener that powers <CheckoutButton>). We use those so our own
// card UI can open a working, on-theme checkout WITHOUT any plan ids configured in env.
let clerkPlansPromise = null;
const getClerkUserPlans = () => {
  if (clerkPlansPromise) return clerkPlansPromise;
  const clerk = window.Clerk;
  if (typeof clerk?.billing?.getPlans !== 'function') return Promise.resolve([]);
  clerkPlansPromise = Promise.resolve(clerk.billing.getPlans({ for: 'user' }))
    .then((res) => res?.data || (Array.isArray(res) ? res : []))
    .catch((err) => { console.error('[Lians billing] getPlans failed', err); clerkPlansPromise = null; return []; });
  return clerkPlansPromise;
};
// True when this build can open the checkout drawer programmatically + list plans.
const checkoutButtonAvailable = () =>
  typeof window.Clerk?.__internal_openCheckout === 'function' && typeof window.Clerk?.billing?.getPlans === 'function';
// Map one of our card plans (free/starter/growth/pro/enterprise) to its live Clerk plan.
const matchClerkPlan = (clerkPlans, plan) => {
  const want = plan.id.toLowerCase();
  return clerkPlans.find((p) => (p.slug || '').toLowerCase() === want)
    || clerkPlans.find((p) => (p.name || '').toLowerCase() === plan.name.toLowerCase())
    || null;
};
// Open Clerk's themed checkout drawer for a given Clerk plan id.
const openClerkCheckout = (planId, redirectUrl) => {
  const clerk = window.Clerk;
  if (typeof clerk?.__internal_openCheckout !== 'function' || !planId) return false;
  try {
    clerk.__internal_openCheckout({
      for: 'user',
      planId,
      planPeriod: 'month',
      newSubscriptionRedirectUrl: redirectUrl,
      appearance: { variables: { colorPrimary: '#4169e1', colorBackground: '#0f1117', colorText: '#e8eaf1', colorTextSecondary: '#8e97aa', colorInputBackground: '#161922', colorInputText: '#e8eaf1', colorNeutral: '#e8eaf1', borderRadius: '0px' } },
    });
    return true;
  } catch (err) { console.error('[Lians billing] openCheckout failed', err); return false; }
};
// Build our custom plan cards. Paid plans open the themed Clerk checkout drawer on click;
// free uses our select endpoint; enterprise is a contact link.
const renderPlanCards = async (gridNode, plans, redirectUrl, note) => {
  gridNode.classList.remove('clerk-pricing-host');
  const clerkPlans = await getClerkUserPlans();
  gridNode.innerHTML = plans.map((plan) => {
    const matched = plan.contact || plan.id === 'free' ? null : matchClerkPlan(clerkPlans, plan);
    const cta = plan.contact
      ? `<a class="plan-cta plan-cta-link" href="mailto:ethan.g.beirne@gmail.com?subject=Lians%20Enterprise">${plan.cta} →</a>`
      : plan.id === 'free'
        ? `<button class="plan-cta" type="button" data-plan="free">${plan.cta}</button>`
        : matched
          ? `<button class="plan-cta" type="button" data-checkout-plan="${matched.id}">${plan.cta}</button>`
          : `<button class="plan-cta" type="button" disabled>Unavailable</button>`;
    return `<div class="plan-card${plan.highlight ? ' plan-highlight' : ''}">
      <p class="plan-tier">${plan.name}</p>
      <div class="plan-price">${plan.price}${plan.period ? `<small> ${plan.period}</small>` : ''}</div>
      <p class="plan-tagline">${plan.tagline}</p>
      <ul class="plan-features">${plan.features.map((f) => `<li>${f}</li>`).join('')}</ul>
      ${cta}
    </div>`;
  }).join('');
  gridNode.querySelectorAll('.plan-cta[data-checkout-plan]').forEach((btn) => btn.addEventListener('click', () => {
    if (note) note.textContent = '';
    if (!openClerkCheckout(btn.dataset.checkoutPlan, redirectUrl) && note) note.textContent = 'Unable to open checkout. Please refresh and try again.';
  }));
  gridNode.querySelector('.plan-cta[data-plan="free"]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; if (note) note.textContent = ''; btn.disabled = true;
    const response = await authedFetch('/api/billing/select', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan: 'free' }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { btn.disabled = false; if (note) note.textContent = result.error || 'Unable to select plan.'; return; }
    // Free plan selected → show the upgrade ask before dropping into the console.
    window.location.assign('/upgrade');
  });
};
const setBillingPage = () => {
  const grid = document.querySelector('#plan-grid');
  const note = document.querySelector('#billing-note');
  if (!grid) return;

  // Handle successful return from Clerk checkout
  const params = new URLSearchParams(window.location.search);
  const completedPlan = params.get('billing_complete');
  if (completedPlan && (completedPlan === 'sync' || ['free', 'starter', 'growth', 'pro', 'enterprise'].includes(completedPlan))) {
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

  const redirectUrl = `${location.origin}/billing?billing_complete=sync`;
  // Our custom card UI, with Clerk's per-plan CheckoutButton as the CTA (opens the
  // real checkout drawer). If this clerk-js build doesn't expose CheckoutButton,
  // fall back to Clerk's full PricingTable so checkout always works.
  if (checkoutButtonAvailable()) renderPlanCards(grid, BILLING_PLANS, redirectUrl, note);
  else mountClerkPricingTable(grid, redirectUrl);
};
const doSignOut = async () => {
  sessionStorage.setItem('lians:signingOutAt', String(Date.now()));
  sessionStorage.removeItem('lians:redirectLoop');
  window.__liansRedirectingTo = null;
  runtime.token = null;
  runtime.tokenAt = 0;
  runtime.tokenPromise = null;
  try { if (window.Clerk?.signOut) await window.Clerk.signOut(); } catch (e) {}
  await fetch('/api/logout', { method: 'POST' }).catch(() => {});
  window.location.replace('/login');
};
document.querySelector('#billing-sign-out')?.addEventListener('click', doSignOut);
document.querySelector('#upgrade-sign-out')?.addEventListener('click', doSignOut);

const PLAN_ORDER = ['free', 'starter', 'growth', 'pro', 'enterprise'];
// Free users are nudged to the upgrade page on sign-in; the upgrade page has a
// "Continue to the console" link so they are never trapped.
const freeUpgradeLanding = (sessionData, base) =>
  (sessionData?.user?.onboardingComplete && sessionData?.user?.billingPlan === 'free' && base === '/console') ? '/upgrade' : base;
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
  const redirectUrl = `${location.origin}/upgrade?billing_complete=sync`;
  if (!upgradable.length) {
    grid.innerHTML = '<p class="upgrade-maxed">You\'re on our highest tier. <a href="mailto:ethan.g.beirne@gmail.com?subject=Lians%20Enterprise">Contact us</a> for custom solutions.</p>';
    return;
  }
  // Our custom cards with Clerk's per-plan CheckoutButton as the CTA; PricingTable fallback.
  // The "Continue to console" option is rendered as a final dark card so the whole row
  // reads left-to-right with no separate block below.
  if (checkoutButtonAvailable()) {
    renderPlanCards(grid, upgradable, redirectUrl, note).then(() => {
      if (!grid.querySelector('.plan-continue')) grid.appendChild(buildContinueCard());
    });
  } else {
    mountClerkPricingTable(grid, redirectUrl);
    if (!grid.parentElement.querySelector('.plan-continue')) grid.insertAdjacentElement('afterend', buildContinueCard());
  }
};
// "Skip the upgrade" card — same dark chrome as the plan cards, with a blue CTA.
const buildContinueCard = () => {
  const card = document.createElement('div');
  card.className = 'plan-card plan-continue';
  card.innerHTML = `
    <p class="plan-tier">Maybe later</p>
    <div class="plan-price plan-continue-mark">→</div>
    <p class="plan-tagline">Not ready to upgrade? Jump straight into the console — you can upgrade anytime from billing.</p>
    <ul class="plan-features"><li>Full console access on your current plan</li><li>Upgrade whenever you like</li></ul>
    <a class="plan-cta plan-cta-continue" href="/console">Continue to console <span>→</span></a>`;
  return card;
};

document.querySelectorAll('.choice-grid button').forEach((button) => button.addEventListener('click', () => {
  clearOnboardingError();
  // Multi-select: toggle this option, then collect every selected option in the group.
  button.classList.toggle('active');
  const grid = button.parentElement;
  const field = grid.dataset.field;
  const chosen = [...grid.querySelectorAll('button.active')].map((b) => b.textContent.trim());
  if (chosen.length) selectedAnswers[field] = chosen.join(', '); else delete selectedAnswers[field];
}));
document.querySelector('#context').addEventListener('input', (event) => { document.querySelector('#character-count').textContent = event.target.value.length; });
document.querySelectorAll('.step-next').forEach((button) => button.addEventListener('click', async () => {
  if (button.dataset.loading === 'true') return;
  const step = pathStep();
  const value = step === 'context' ? document.querySelector('#context').value : selectedAnswers[step];
  if (step !== 'context' && !value) { setOnboardingError('Please choose at least one option to continue.'); return; }
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
const waitForClerkReady = async ({ timeoutMs = 10000 } = {}) => {
  if (window.__liansClerkStatus?.state === 'ready' && window.Clerk) return true;
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const done = (ready) => {
      window.removeEventListener('lians:clerk-ready', onReady);
      window.removeEventListener('lians:clerk-error', onError);
      resolve(ready);
    };
    const onReady = () => done(true);
    const onError = () => done(false);
    window.addEventListener('lians:clerk-ready', onReady, { once: true });
    window.addEventListener('lians:clerk-error', onError, { once: true });
    const tick = () => {
      if (window.__liansClerkStatus?.state === 'ready' && window.Clerk) return done(true);
      if (Date.now() - startedAt >= timeoutMs) return done(false);
      window.setTimeout(tick, 150);
    };
    tick();
  });
};
const startClerkOAuth = async (provider) => {
  const redirectUrl = `${window.location.origin}/sso-callback`;
  const options = {
    strategy: `oauth_${provider}`,
    redirectUrl,
    redirectUrlComplete: redirectUrl,
    continueSignIn: true,
    continueSignUp: true,
  };
  const signIn = window.Clerk?.client?.signIn || window.Clerk?.signIn;
  if (typeof signIn?.authenticateWithRedirect === 'function') return signIn.authenticateWithRedirect(options);
  if (typeof window.Clerk?.authenticateWithRedirect === 'function') return window.Clerk.authenticateWithRedirect(options);
  if (typeof signIn?.create === 'function') return signIn.create(options);
  throw new Error('Clerk OAuth is unavailable on this page. Refresh and try again.');
};
const beginSocialSignIn = async (provider, button) => {
  if (button?.dataset.loading === 'true') return;
  button.dataset.loading = 'true';
  const originalText = button.textContent;
  button.setAttribute('aria-disabled', 'true');
  button.textContent = `Opening ${provider === 'google' ? 'Google' : 'GitHub'}…`;
  const status = window.__liansClerkStatus?.state;
  try {
    if (status === 'error') throw new Error(window.__liansClerkStatus.detail);
    const ready = await waitForClerkReady();
    if (!ready) throw new Error(window.__liansClerkStatus?.detail || 'Secure sign-in is still loading. Please refresh and try again.');
    console.info('[Lians login debug]', {
      route: window.location.pathname,
      clerkExists: Boolean(window.Clerk),
      clerkLoaded: Boolean(window.Clerk?.loaded),
      hasSession: Boolean(window.Clerk?.session),
      provider,
    });
    await startClerkOAuth(provider);
  } catch (error) {
    const clerkError = error?.errors?.[0]?.longMessage || error?.errors?.[0]?.message || error?.message;
    const message = /Origin header must be equal to or a subdomain/i.test(clerkError || '')
      ? 'This Clerk key is configured for the production domain. For local testing, use Clerk development keys or configure localhost in Clerk.'
      : clerkError;
    setAuthMessage(message || `Unable to continue with ${provider === 'google' ? 'Google' : 'GitHub'}. Check that this connection is enabled in Clerk.`);
    button.dataset.loading = 'false';
    button.setAttribute('aria-disabled', 'false');
    button.textContent = originalText;
  }
};
authButtons.forEach((button) => button.addEventListener('click', (event) => { event.preventDefault(); beginSocialSignIn(button.dataset.authProvider, button); }));
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
    const planName = PLAN_NAMES[plan] || plan;
    const planMeta = BILLING_PLANS.find((p) => p.id === plan);
    const priceLabel = planMeta ? `${planMeta.price}${planMeta.period || ''}` : '';
    const usageEl = document.querySelector('.usage');
    if (usageEl) usageEl.innerHTML = `<span>${planName} plan</span><p>Memories <b>0 / ${limits.memories}</b></p><div><i></i></div><p>Recall <b>0 / ${limits.recalls}</b></p><div><i></i></div>`;
    // Reflect the real plan in Usage & billing
    const planLine = document.querySelector('#billing-plan-line');
    if (planLine) planLine.innerHTML = `You're on the <strong>${planName}</strong> plan${priceLabel ? ` · ${priceLabel}` : ''}.`;
    const billingMetrics = document.querySelector('#console-billing-metrics');
    if (billingMetrics) billingMetrics.innerHTML = `<article><span>MEMORY WRITES</span><strong>0</strong><small>of ${limits.memories} / mo</small></article><article><span>RECALLS</span><strong>0</strong><small>of ${limits.recalls} / mo</small></article><article><span>PLAN</span><strong>${planName}</strong><small>${priceLabel || '&nbsp;'}</small></article>`;
    const billingActions = document.querySelector('#console-billing-actions');
    if (billingActions) billingActions.innerHTML = plan === 'enterprise'
      ? '<a class="plan-cta-link" href="https://github.com/Lians-ai/Lians" target="_blank" rel="noreferrer">Contact us ↗</a>'
      : `<button class="console-button" onclick="window.location.assign('/upgrade')">${plan === 'free' ? 'Upgrade your plan' : 'Change plan'} <span>→</span></button>`;
    // Top-tier users don't need the upgrade nudge in the header
    if (plan === 'enterprise') document.querySelector('.upgrade-button')?.setAttribute('hidden', '');
    renderFeatureTiers(plan);
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

// ── Projects (switch / create / rename / delete, per user — all in-page) ──────
const projectsState = { items: [], current: null, editingId: null, confirmId: null };
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const renderProjects = () => {
  const nameEl = document.querySelector('#project-name');
  const current = projectsState.items.find((p) => p.id === projectsState.current) || projectsState.items[0];
  if (nameEl && current) nameEl.textContent = current.name;
  const list = document.querySelector('#project-list');
  if (!list) return;
  list.innerHTML = projectsState.items.map((p) => {
    if (projectsState.editingId === p.id) return `
      <div class="project-item editing">
        <input class="project-rename-input" type="text" maxlength="60" data-id="${p.id}" value="${escapeHtml(p.name)}" />
        <button class="project-save" type="button" data-id="${p.id}" title="Save">✓</button>
        <button class="project-cancel" type="button" title="Cancel">✕</button>
      </div>`;
    if (projectsState.confirmId === p.id) return `
      <div class="project-item confirming">
        <span class="project-confirm-text">Delete “${escapeHtml(p.name)}”?</span>
        <button class="project-confirm-yes" type="button" data-id="${p.id}">Delete</button>
        <button class="project-confirm-no" type="button">Keep</button>
      </div>`;
    return `
      <div class="project-item${p.id === projectsState.current ? ' active' : ''}">
        <button class="project-pick" type="button" data-id="${p.id}">${escapeHtml(p.name)}</button>
        <button class="project-edit" type="button" data-id="${p.id}" title="Rename">✎</button>
        <button class="project-del" type="button" data-id="${p.id}" title="Delete"${projectsState.items.length <= 1 ? ' disabled' : ''}>✕</button>
      </div>`;
  }).join('');
  if (projectsState.editingId) { const inp = list.querySelector('.project-rename-input'); if (inp) { inp.focus(); inp.select(); } }
};
const applyProjects = (d) => { if (!d) return; projectsState.items = d.projects || projectsState.items; if (d.currentProjectId) projectsState.current = d.currentProjectId; projectsState.editingId = null; projectsState.confirmId = null; renderProjects(); };
const loadProjects = async () => {
  try { const r = await authedFetch('/api/projects'); if (!r.ok) return; applyProjects(await r.json()); } catch {}
};
const selectProject = async (id) => {
  projectsState.current = id; projectsState.editingId = null; projectsState.confirmId = null; renderProjects();
  const menu = document.querySelector('#project-menu'); if (menu) menu.hidden = true;
  try { const r = await authedFetch('/api/projects/select', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }); applyProjects(await r.json().catch(() => null)); } catch {}
};
const createProject = async () => {
  const input = document.querySelector('#project-new-name'); const name = (input?.value || '').trim();
  if (!name) return;
  try { const r = await authedFetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }); if (r.ok) { if (input) input.value = ''; applyProjects(await r.json().catch(() => null)); } } catch {}
};
const saveRename = async (id, value) => {
  const name = (value || '').trim();
  if (!name) { projectsState.editingId = null; renderProjects(); return; }
  try { const r = await authedFetch(`/api/projects/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }); applyProjects(await r.json().catch(() => null)); } catch { projectsState.editingId = null; renderProjects(); }
};
const deleteProject = async (id) => {
  try { const r = await authedFetch(`/api/projects/${id}`, { method: 'DELETE' }); applyProjects(await r.json().catch(() => null)); } catch {}
};
const startEdit = (id) => { projectsState.editingId = id; projectsState.confirmId = null; renderProjects(); };
const startDelete = (id) => { if (projectsState.items.length <= 1) return; projectsState.confirmId = id; projectsState.editingId = null; renderProjects(); };
const cancelEdits = () => { projectsState.editingId = null; projectsState.confirmId = null; renderProjects(); };

document.querySelector('#project-switcher')?.addEventListener('click', (e) => { e.stopPropagation(); const m = document.querySelector('#project-menu'); if (m) m.hidden = !m.hidden; });
document.querySelector('#project-create')?.addEventListener('click', createProject);
document.querySelector('#project-new-name')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); createProject(); } });
document.querySelector('#project-menu')?.addEventListener('click', (e) => e.stopPropagation());
document.querySelector('#project-list')?.addEventListener('click', (e) => {
  const btn = e.target.closest('button'); if (!btn) return; const id = btn.dataset.id;
  if (btn.classList.contains('project-pick')) selectProject(id);
  else if (btn.classList.contains('project-edit')) startEdit(id);
  else if (btn.classList.contains('project-del')) startDelete(id);
  else if (btn.classList.contains('project-save')) { const inp = document.querySelector(`.project-rename-input[data-id="${id}"]`); saveRename(id, inp?.value); }
  else if (btn.classList.contains('project-cancel')) cancelEdits();
  else if (btn.classList.contains('project-confirm-yes')) deleteProject(id);
  else if (btn.classList.contains('project-confirm-no')) cancelEdits();
});
document.querySelector('#project-list')?.addEventListener('keydown', (e) => {
  if (!e.target.classList?.contains('project-rename-input')) return;
  if (e.key === 'Enter') { e.preventDefault(); saveRename(e.target.dataset.id, e.target.value); }
  else if (e.key === 'Escape') { e.preventDefault(); cancelEdits(); }
});
document.addEventListener('click', (e) => { const wrap = document.querySelector('.project-wrap'); const m = document.querySelector('#project-menu'); if (m && !m.hidden && wrap && !wrap.contains(e.target)) { m.hidden = true; cancelEdits(); } });

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
    if (sessionData.authenticated) redirectOnce(freeUpgradeLanding(sessionData, sessionData.next || '/onboarding/company'), 'callback_session_ready');
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
  const complete = Boolean(sessionData.user?.onboardingComplete && sessionData.user?.completedAt);
  const destination = sessionData.next || (
    !complete ? '/onboarding/company' :
    '/console'
  );
  if (route === '/login') {
    window.location.assign(freeUpgradeLanding(sessionData, destination));
    return;
  }
  if (route.startsWith('/console') && destination !== '/console') {
    window.location.assign(destination);
    return;
  }
  if (route.startsWith('/console') && destination === '/console') {
    document.querySelector('#console-gate')?.classList.add('cleared');
    loadConsolePlan();
    loadProjects();
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
    if (upgradedPlan && (upgradedPlan === 'sync' || ['starter', 'growth', 'pro', 'enterprise'].includes(upgradedPlan))) {
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
    if (destination === '/console') {
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

const installContent = { python: [['Install the SDK', 'Install the local-first Python SDK. No Docker or account is required for the first run.', 'pip <em>install</em> lians-sdk[local]'], ['Add a memory', 'Store an event with its real-world timestamp and structured metadata.', 'mem.<em>add</em>(agent_id="desk", content="NVDA guidance raised to $40B")'], ['Recall at a point in time', 'Ask what was valid when a decision was made.', 'mem.<em>recall_at</em>(agent_id="desk", query="NVDA guidance", as_of=...)']], node: [['Install the SDK', 'Add the Node package to your existing agent application.', 'npm <em>install</em> @lians-ai/lians'], ['Create the client', 'Point the client at your local or hosted Lians endpoint.', 'import { <em>LiansClient</em> } from "@lians-ai/lians"'], ['Recall a fact', 'Request context that is valid right now or at a prior date.', 'await client.<em>recall</em>({ agent_id: "desk", query: "NVDA guidance" })']], curl: [['Write a memory', 'Send a fact, its event time, and metadata to the memory service.', 'curl -X <em>POST</em> /v1/memory'], ['Recall it', 'Use the optional as_of field for historical recall.', 'curl -X <em>POST</em> /v1/recall'], ['Reconstruct the trail', 'Reconstruct the memory state behind an agent decision.', 'curl /v1/audit/<em>reconstruct</em>']] };
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

// Theme toggle (light / dark) in the console header.
(function () {
  const root = document.documentElement;
  const isLight = () => root.getAttribute('data-theme') === 'light';
  const label = () => (isLight() ? '☾ Dark' : '☀ Light');
  const actions = document.querySelector('.header-actions');
  if (!actions) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'theme-toggle';
  btn.setAttribute('aria-label', 'Toggle light or dark mode');
  btn.textContent = label();
  btn.addEventListener('click', () => {
    const next = isLight() ? 'dark' : 'light';
    if (next === 'light') root.setAttribute('data-theme', 'light'); else root.removeAttribute('data-theme');
    try { localStorage.setItem('lians-theme', next); } catch (e) {}
    btn.textContent = label();
  });
  actions.insertBefore(btn, actions.firstChild);
})();

// Feature → tier availability, rendered in Usage & billing for the current plan.
const FEATURE_TIERS = [
  { name: 'Domain adapters (finance, healthcare, legal)', tier: 'starter' },
  { name: 'Audit log & memory lineage', tier: 'starter' },
  { name: 'Conflict detection', tier: 'growth' },
  { name: 'Webhooks', tier: 'growth' },
  { name: 'Compliance reports', tier: 'growth' },
  { name: 'Merkle audit chain', tier: 'growth' },
  { name: 'Information barriers (RLS)', tier: 'pro' },
  { name: 'HIPAA encryption', tier: 'pro' },
  { name: 'GDPR erasure certificates', tier: 'pro' },
  { name: 'Backtest contamination check', tier: 'pro' },
  { name: 'Prometheus metrics', tier: 'pro' },
  { name: 'Air-gap mode', tier: 'enterprise' },
  { name: 'Custom KMS (AWS / Azure / Vault)', tier: 'enterprise' },
];
const renderFeatureTiers = (plan) => {
  const host = document.querySelector('#feature-tiers');
  if (!host) return;
  const curIdx = PLAN_ORDER.indexOf(plan);
  host.innerHTML = `<p class="console-eyebrow ftier-head">Feature availability · what unlocks where</p>
    <ul class="ftier-list">${FEATURE_TIERS.map((f) => {
      const included = curIdx >= PLAN_ORDER.indexOf(f.tier);
      return `<li class="${included ? 'ftier-on' : 'ftier-off'}">
        <i>${included ? '✓' : '◌'}</i><span>${f.name}</span>${
          included ? '<b class="ftier-have">Included</b>' : `<b class="ftier-need">${PLAN_NAMES[f.tier]}</b>`}
      </li>`;
    }).join('')}</ul>
    ${curIdx < PLAN_ORDER.length - 1 ? '<button class="console-button" type="button" onclick="window.location.assign(\'/upgrade\')" style="width:max-content;margin-top:18px">Upgrade for more <span>→</span></button>' : ''}`;
};

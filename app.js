const LIANS_CLIENT_BUILD = 'workflow-postauth-20260625-v5';
console.info('Lians client build:', LIANS_CLIENT_BUILD);
const authPage = document.querySelector('#auth-page');
const onboardingPage = document.querySelector('#onboarding-page');
const consolePage = document.querySelector('#console-page');
const show = (page) => [authPage, onboardingPage, consolePage].forEach((item) => {
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
const workflowLog = (metadata) => console.info('[Lians workflow]', {
  pathname: window.location.pathname,
  clerkLoaded: window.__liansClerkStatus?.state === 'ready',
  signedIn: Boolean(window.Clerk?.user || window.Clerk?.session),
  ...metadata,
});
const renderShellForRoute = (pathname = window.location.pathname) => {
  if (pathname.startsWith('/onboarding')) show(onboardingPage);
  else if (pathname.startsWith('/console')) show(consolePage);
  else show(authPage);
  if (authBox && callbackBox) {
    const isCallback = pathname === '/sso-callback';
    authBox.hidden = isCallback;
    callbackBox.hidden = !isCallback;
  }
};
renderShellForRoute(route);

const clerkAuthHeaders = async () => {
  try {
    const token = await window.Clerk?.session?.getToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
};
const authedFetch = async (url, options = {}) => fetch(url, { ...options, credentials: 'include', headers: { ...(options.headers || {}), ...(await clerkAuthHeaders()) } });
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
const setWizard = async () => {
  const step = pathStep(); const response = await authedFetch('/api/onboarding'); if (!response.ok) throw new Error('Unable to load onboarding.'); const data = await response.json(); const answers = data.answers || {};
  if (data.onboardingComplete) return redirectOnce('/console', 'onboarding_already_complete');
  if (data.nextStep && data.nextStep !== step) return redirectOnce(`/onboarding/${data.nextStep}`, 'correct_onboarding_step');
  Object.assign(selectedAnswers, answers);
  document.querySelectorAll('.wizard-step').forEach((panel) => { panel.hidden = panel.dataset.step !== step; });
  document.querySelectorAll('.wizard-progress i').forEach((item, index) => item.classList.toggle('active', index <= onboardingSteps.indexOf(step)));
  document.querySelectorAll('.choice-grid button').forEach((button) => button.classList.toggle('active', answers[button.parentElement.dataset.field] === button.textContent));
  const continueButton = document.querySelector(`.wizard-step[data-step="${step}"] .step-next`);
  if (continueButton && step !== 'context') continueButton.hidden = !selectedAnswers[step];
  if (step === 'context') { document.querySelector('#context').value = answers.context || ''; document.querySelector('#character-count').textContent = (answers.context || '').length; }
  if (step === 'review') document.querySelector('#review-list').innerHTML = Object.entries(labels).map(([key, label]) => `<div><span>${label}</span><b>${answers[key] || '—'}</b></div>`).join('');
};

document.querySelectorAll('.choice-grid button').forEach((button) => button.addEventListener('click', () => {
  const field = button.parentElement.dataset.field;
  selectedAnswers[field] = button.textContent;
  button.parentElement.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
  const continueButton = button.closest('.wizard-step').querySelector('.step-next');
  if (continueButton) continueButton.hidden = false;
}));
document.querySelector('#context').addEventListener('input', (event) => { document.querySelector('#character-count').textContent = event.target.value.length; });
document.querySelectorAll('.step-next').forEach((button) => button.addEventListener('click', async () => { const step = pathStep(); const value = step === 'context' ? document.querySelector('#context').value : selectedAnswers[step]; if (step !== 'context' && !value) return; button.disabled = true; const response = await authedFetch(`/api/onboarding/${step}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value }) }); const result = await response.json(); if (!response.ok) { button.disabled = false; return alert(result.error || 'Unable to continue.'); } window.location.assign(result.next); }));
document.querySelector('.onboarding-submit').addEventListener('click', async () => { const button = document.querySelector('.onboarding-submit'); button.disabled = true; button.textContent = 'Creating workspace…'; const response = await authedFetch('/api/onboarding/complete', { method: 'POST' }); const result = await response.json(); if (!response.ok) { button.disabled = false; button.innerHTML = 'Proceed to Console <span>→</span>'; return alert(result.error || 'Unable to complete onboarding.'); } window.location.assign(result.next); });
document.querySelector('#back-to-auth').addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST' }); window.location.assign('/login'); });

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
    const friendly = /no pending/i.test(detail) ? 'Sign-in session was not found after redirect — try signing in again.' : detail || 'We could not complete secure sign-in. Please try again.';
    setCallbackMessage(friendly);
  }
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
    if (route.startsWith('/console') || route.startsWith('/onboarding')) redirectOnce('/login', 'protected_route_signed_out');
    workflowState.running = false;
    return;
  }
  const sessionData = await readSession();
  if (!sessionData.authenticated) {
    if (route === '/login' || route.startsWith('/console')) redirectOnce('/onboarding/company', 'signed_in_session_pending');
    workflowState.running = false;
    return;
  }
  const destination = sessionData.next || (sessionData.user?.onboardingComplete ? '/console' : '/onboarding/company');
  if (route === '/login') {
    redirectOnce(destination, 'login_signed_in');
    return;
  }
  if (route.startsWith('/console') && destination !== '/console') {
    redirectOnce(destination, 'console_requires_onboarding');
    return;
  }
  if (route.startsWith('/onboarding')) {
    if (destination === '/console') {
      redirectOnce('/console', 'onboarding_complete');
      return;
    }
    if (destination !== route) {
      redirectOnce(destination, 'onboarding_step_guard');
      return;
    }
    try { await setWizard(); } catch { redirectOnce('/login', 'onboarding_load_failed'); }
  }
  workflowState.running = false;
};
const onClerkReady = () => {
  setAuthButtonsDisabled(false);
  if (route === '/sso-callback') completeClerkCallback();
  else if (route === '/login' || route.startsWith('/onboarding') || route.startsWith('/console')) runWorkflowGate('clerk_ready');
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
const activateView = (view, updateUrl = false) => { if (!viewMeta[view]) view = 'get-started'; document.querySelectorAll('.nav-item[data-view]').forEach((item) => item.classList.toggle('active', item.dataset.view === view)); document.querySelectorAll('.view').forEach((item) => item.classList.toggle('active', item.id === `view-${view}`)); document.querySelector('#view-label').textContent = viewMeta[view][0]; document.querySelector('#view-title').textContent = viewMeta[view][1]; if (updateUrl) window.location.assign(`/console/${view}`); if (view === 'api-keys') loadKeys(); };
document.querySelectorAll('.nav-item[data-view]').forEach((button) => button.addEventListener('click', () => activateView(button.dataset.view, true)));
if (route.startsWith('/console')) activateView(route.split('/')[2] || 'get-started');
document.querySelector('#run-recall').addEventListener('click', async () => { const answer = document.querySelector('#playground-answer'); const result = await (await authedFetch('/api/demo/recall', { method: 'POST' })).json(); answer.querySelector('strong').textContent = result.value; answer.querySelector('p').textContent = result.content; answer.querySelector('small').textContent = `✓ ${result.audit}`; answer.hidden = false; });
const formatDate = (value) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const renderKeys = (keys) => { const table = document.querySelector('#key-table'); table.querySelectorAll('.key-row').forEach((row) => row.remove()); document.querySelector('#key-state').hidden = keys.length > 0; keys.forEach((key) => { const row = document.createElement('div'); row.className = 'key-row'; row.innerHTML = `<b>${key.label}</b><code>${key.prefix}</code><span>${formatDate(key.createdAt)}</span><span class="key-status ${key.revokedAt ? 'revoked' : ''}">${key.revokedAt ? 'Revoked' : 'Active'}</span><button data-rotate="${key.id}" ${key.revokedAt ? 'disabled' : ''} style="margin-right:4px">Rotate</button><button data-revoke="${key.id}" ${key.revokedAt ? 'disabled' : ''}>${key.revokedAt ? 'Revoked' : 'Revoke'}</button>`; table.append(row); }); document.querySelectorAll('[data-revoke]').forEach((button) => button.addEventListener('click', async () => { await authedFetch(`/api/keys/${button.dataset.revoke}`, { method: 'DELETE' }); loadKeys(); })); document.querySelectorAll('[data-rotate]').forEach((button) => button.addEventListener('click', async () => { if (!confirm('Rotate this key? The current key will stop working immediately.')) return; const res = await authedFetch(`/api/keys/${button.dataset.rotate}/rotate`, { method: 'POST' }); if (!res.ok) return; const { rawKey } = await res.json(); document.querySelector('#new-key-secret').textContent = rawKey; document.querySelector('#key-reveal').hidden = false; document.querySelector('#copy-key').textContent = 'Copy'; loadKeys(); })); };
async function loadKeys() { const response = await authedFetch('/api/keys'); if (!response.ok) return; const { keys, freshKey } = await response.json(); renderKeys(keys); if (freshKey) { document.querySelector('#new-key-secret').textContent = freshKey.rawKey; document.querySelector('#key-reveal').hidden = false; document.querySelector('#copy-key').textContent = 'Copy'; } }
document.querySelector('#key-form').addEventListener('submit', async (event) => { event.preventDefault(); const label = document.querySelector('#key-name').value; const response = await authedFetch('/api/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label }) }); const result = await response.json(); if (!response.ok) return document.querySelector('#backend-note').textContent = result.error || 'Unable to create key.'; document.querySelector('#new-key-secret').textContent = result.rawKey; document.querySelector('#key-reveal').hidden = false; document.querySelector('#key-name').value = ''; loadKeys(); });
document.querySelector('#copy-key').addEventListener('click', async () => { await navigator.clipboard.writeText(document.querySelector('#new-key-secret').textContent); document.querySelector('#copy-key').textContent = 'Copied'; });
document.querySelector('#save-settings').addEventListener('click', () => alert('Settings saved.'));
document.querySelector('#sign-out').addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST' }); window.location.assign('/login'); });
document.querySelector('.mobile-menu').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('open'));

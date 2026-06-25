const authPage = document.querySelector('#auth-page');
const onboardingPage = document.querySelector('#onboarding-page');
const consolePage = document.querySelector('#console-page');
const show = (page) => [authPage, onboardingPage, consolePage].forEach((item) => { item.hidden = item !== page; });
const onboardingSteps = ['company', 'role', 'use-case', 'tools', 'memory-needs', 'context', 'review'];
const labels = { company: 'What you are building', role: 'Your role', 'use-case': 'Memory use case', tools: 'First connection', 'memory-needs': 'Memory behavior', context: 'Additional context' };
const route = window.location.pathname;
const selectedAnswers = {};
if (route.startsWith('/onboarding')) show(onboardingPage); else if (route.startsWith('/console')) show(consolePage); else show(authPage);

const session = async () => (await fetch('/api/session')).json();
const pathStep = () => route.split('/')[2] || 'company';
const setWizard = async () => {
  const step = pathStep(); const response = await fetch('/api/onboarding'); if (!response.ok) throw new Error('Unable to load onboarding.'); const data = await response.json(); const answers = data.answers || {};
  Object.assign(selectedAnswers, answers);
  document.querySelectorAll('.wizard-step').forEach((panel) => { panel.hidden = panel.dataset.step !== step; });
  document.querySelectorAll('.wizard-progress i').forEach((item, index) => item.classList.toggle('active', index <= onboardingSteps.indexOf(step)));
  document.querySelectorAll('.choice-grid button').forEach((button) => button.classList.toggle('active', answers[button.parentElement.dataset.field] === button.textContent));
  const continueButton = document.querySelector(`.wizard-step[data-step="${step}"] .step-next`);
  if (continueButton && step !== 'context') continueButton.hidden = !selectedAnswers[step];
  if (step === 'context') { document.querySelector('#context').value = answers.context || ''; document.querySelector('#character-count').textContent = (answers.context || '').length; }
  if (step === 'review') document.querySelector('#review-list').innerHTML = Object.entries(labels).map(([key, label]) => `<div><span>${label}</span><b>${answers[key] || '—'}</b></div>`).join('');
};
if (route.startsWith('/onboarding')) setWizard().catch(() => window.location.assign('/login'));

document.querySelectorAll('.choice-grid button').forEach((button) => button.addEventListener('click', () => {
  const field = button.parentElement.dataset.field;
  selectedAnswers[field] = button.textContent;
  button.parentElement.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item === button));
  const continueButton = button.closest('.wizard-step').querySelector('.step-next');
  if (continueButton) continueButton.hidden = false;
}));
document.querySelector('#context').addEventListener('input', (event) => { document.querySelector('#character-count').textContent = event.target.value.length; });
document.querySelectorAll('.step-next').forEach((button) => button.addEventListener('click', async () => { const step = pathStep(); const value = step === 'context' ? document.querySelector('#context').value : selectedAnswers[step]; if (step !== 'context' && !value) return; button.disabled = true; const response = await fetch(`/api/onboarding/${step}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value }) }); const result = await response.json(); if (!response.ok) { button.disabled = false; return alert(result.error || 'Unable to continue.'); } window.location.assign(result.next); }));
document.querySelector('.onboarding-submit').addEventListener('click', async () => { const button = document.querySelector('.onboarding-submit'); button.disabled = true; button.textContent = 'Creating workspace…'; const response = await fetch('/api/onboarding/complete', { method: 'POST' }); const result = await response.json(); if (!response.ok) { button.disabled = false; button.innerHTML = 'Proceed to Console <span>→</span>'; return alert(result.error || 'Unable to complete onboarding.'); } window.location.assign(result.next); });
document.querySelector('#back-to-auth').addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST' }); window.location.assign('/login'); });

const authButtons = document.querySelectorAll('[data-auth-provider]');
const authNote = document.querySelector('.auth-note');
const setAuthMessage = (message) => { if (authNote) authNote.textContent = message; };
const setAuthButtonsDisabled = (disabled) => authButtons.forEach((button) => {
  button.setAttribute('aria-disabled', String(disabled));
  button.tabIndex = disabled ? -1 : 0;
});
const beginSocialSignIn = async (provider) => {
  const status = window.__lianClerkStatus?.state;
  if (status === 'error') return setAuthMessage(window.__lianClerkStatus.detail);
  if (!window.Clerk || status !== 'ready') return setAuthMessage('Secure sign-in is loading. Please wait a moment.');
  try {
    await window.Clerk.client.signIn.authenticateWithRedirect({
      strategy: `oauth_${provider}`,
      redirectUrl: `${window.location.origin}/sso-callback`,
      redirectUrlComplete: `${window.location.origin}/onboarding/company`,
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
const handleClerkError = (message) => { setAuthButtonsDisabled(true); setAuthMessage(message); };
const completeClerkCallback = async () => {
  if (route !== '/sso-callback') return;
  try { await window.Clerk.handleRedirectCallback({ signInForceRedirectUrl: '/onboarding/company', signUpForceRedirectUrl: '/onboarding/company' }); }
  catch { setAuthMessage('We could not complete secure sign-in. Please try again.'); }
};
window.addEventListener('lian:clerk-error', (event) => handleClerkError(event.detail));
window.addEventListener('lian:clerk-loading', () => setAuthButtonsDisabled(true));
window.addEventListener('lian:clerk-ready', () => { setAuthButtonsDisabled(false); completeClerkCallback(); });
if (window.__lianClerkStatus?.state === 'error') handleClerkError(window.__lianClerkStatus.detail);
if (window.__lianClerkStatus?.state === 'loading') setAuthButtonsDisabled(true);
if (window.__lianClerkStatus?.state === 'ready') { setAuthButtonsDisabled(false); completeClerkCallback(); }

const installContent = { python: [['Install the SDK', 'Install the local-first Python SDK. No Docker or account is required for the first run.', 'pip <em>install</em> lian-sdk[local]'], ['Add a memory', 'Store an event with its real-world timestamp and structured metadata.', 'mem.<em>add</em>(agent_id="analyst-1", content="NVDA guidance raised to $40B")'], ['Recall at a point in time', 'Ask what was valid when a decision was made.', 'mem.<em>recall_at</em>(agent_id="analyst-1", query="NVDA guidance", as_of=...)']], node: [['Install the SDK', 'Add the Node package to your existing agent application.', 'npm <em>install</em> lian'], ['Create the client', 'Use your local or hosted Lian endpoint.', 'import { <em>LianClient</em> } from "lian"'], ['Recall a fact', 'Request context that is valid right now or at a prior date.', 'await client.<em>recall</em>({ query: "NVDA guidance" })']], curl: [['Write a memory', 'Send a fact, its event time, and metadata to the memory service.', 'curl -X <em>POST</em> /v1/memories'], ['Recall it', 'Use the optional as_of field for historical recall.', 'curl -X <em>POST</em> /v1/recall'], ['Verify the trail', 'Reconstruct the memory state behind an agent decision.', 'curl /v1/audit/<em>reconstruct</em>']] };
const renderSteps = (language) => { document.querySelector('#install-steps').innerHTML = installContent[language].map((step, index) => `<article class="install-step"><span class="step-number">${index + 1}</span><div><h3>${step[0]}</h3><p>${step[1]}</p></div><div class="code-block"><header>${language}</header><pre>${step[2]}</pre></div></article>`).join(''); };
renderSteps('python');
document.querySelectorAll('.language-tabs button').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('.language-tabs button').forEach((item) => item.classList.remove('active')); button.classList.add('active'); renderSteps(button.dataset.language); }));
document.querySelectorAll('.path-card').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('.path-card').forEach((item) => item.classList.remove('active')); button.classList.add('active'); }));

const viewMeta = { 'get-started': ['SETUP', 'Get started'], playground: ['SETUP', 'Playground'], 'api-keys': ['SETUP', 'API keys'], dashboard: ['ACTIVITY', 'Dashboard'], requests: ['ACTIVITY', 'Requests'], entities: ['ACTIVITY', 'Entities'], memories: ['ACTIVITY', 'Memories'], graph: ['ACTIVITY', 'Graph'], webhooks: ['ACTIVITY', 'Webhooks'], exports: ['ACTIVITY', 'Memory exports'], settings: ['ACCOUNT', 'Settings'], billing: ['ACCOUNT', 'Usage & billing'] };
const activateView = (view, updateUrl = false) => { if (!viewMeta[view]) view = 'get-started'; document.querySelectorAll('.nav-item[data-view]').forEach((item) => item.classList.toggle('active', item.dataset.view === view)); document.querySelectorAll('.view').forEach((item) => item.classList.toggle('active', item.id === `view-${view}`)); document.querySelector('#view-label').textContent = viewMeta[view][0]; document.querySelector('#view-title').textContent = viewMeta[view][1]; if (updateUrl) window.location.assign(`/console/${view}`); if (view === 'api-keys') loadKeys(); };
document.querySelectorAll('.nav-item[data-view]').forEach((button) => button.addEventListener('click', () => activateView(button.dataset.view, true)));
if (route.startsWith('/console')) activateView(route.split('/')[2] || 'get-started');
document.querySelector('#run-recall').addEventListener('click', async () => { const answer = document.querySelector('#playground-answer'); const result = await (await fetch('/api/demo/recall', { method: 'POST' })).json(); answer.querySelector('strong').textContent = result.value; answer.querySelector('p').textContent = result.content; answer.querySelector('small').textContent = `✓ ${result.audit}`; answer.hidden = false; });
const formatDate = (value) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const renderKeys = (keys) => { const table = document.querySelector('#key-table'); table.querySelectorAll('.key-row').forEach((row) => row.remove()); document.querySelector('#key-state').hidden = keys.length > 0; keys.forEach((key) => { const row = document.createElement('div'); row.className = 'key-row'; row.innerHTML = `<b>${key.label}</b><code>${key.prefix}</code><span>${formatDate(key.createdAt)}</span><span class="key-status ${key.revokedAt ? 'revoked' : ''}">${key.revokedAt ? 'Revoked' : 'Active'}</span><button data-revoke="${key.id}" ${key.revokedAt ? 'disabled' : ''}>${key.revokedAt ? 'Revoked' : 'Revoke'}</button>`; table.append(row); }); document.querySelectorAll('[data-revoke]').forEach((button) => button.addEventListener('click', async () => { await fetch(`/api/keys/${button.dataset.revoke}`, { method: 'DELETE' }); loadKeys(); })); };
async function loadKeys() { const response = await fetch('/api/keys'); if (!response.ok) return; const { keys } = await response.json(); renderKeys(keys); }
document.querySelector('#key-form').addEventListener('submit', async (event) => { event.preventDefault(); const label = document.querySelector('#key-name').value; const response = await fetch('/api/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label }) }); const result = await response.json(); if (!response.ok) return document.querySelector('#backend-note').textContent = result.error || 'Unable to create key.'; document.querySelector('#new-key-secret').textContent = result.rawKey; document.querySelector('#key-reveal').hidden = false; document.querySelector('#key-name').value = ''; loadKeys(); });
document.querySelector('#copy-key').addEventListener('click', async () => { await navigator.clipboard.writeText(document.querySelector('#new-key-secret').textContent); document.querySelector('#copy-key').textContent = 'Copied'; });
document.querySelector('#save-settings').addEventListener('click', () => alert('Settings saved.'));
document.querySelector('#sign-out').addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST' }); window.location.assign('/login'); });
document.querySelector('.mobile-menu').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('open'));

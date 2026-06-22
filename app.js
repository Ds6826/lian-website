const appState = JSON.parse(localStorage.getItem('lian-console-state') || '{}');
const authPage = document.querySelector('#auth-page');
const onboardingPage = document.querySelector('#onboarding-page');
const consolePage = document.querySelector('#console-page');
const show = (page) => { [authPage, onboardingPage, consolePage].forEach((item) => { item.hidden = item !== page; }); };
const persist = () => localStorage.setItem('lian-console-state', JSON.stringify(appState));

const initialRoute = window.location.pathname;
if (initialRoute === '/onboarding' || initialRoute.startsWith('/onboarding/')) show(onboardingPage);
else if (initialRoute.startsWith('/console/')) show(consolePage);
else show(authPage);
if (appState.workspace) { document.querySelector('#project-name').textContent = appState.workspace; document.querySelector('#settings-workspace').value = appState.workspace; }

const beginOnboarding = (provider) => {
  appState.provider = provider;
  persist();
  show(onboardingPage);
};
document.querySelector('#back-to-auth').addEventListener('click', () => show(authPage));

const onboardingData = JSON.parse(sessionStorage.getItem('lian-onboarding') || '{"workspace":"","usecase":"","source":"","context":""}');
const onboardingRoute = () => window.location.pathname.match(/^\/onboarding\/([\w-]+)/)?.[1] || 'company';
const renderOnboardingStep = () => {
  const step = onboardingRoute();
  document.querySelectorAll('.wizard-step').forEach((panel) => { panel.hidden = panel.dataset.step !== step; });
  document.querySelectorAll('.wizard-progress i').forEach((item, index) => item.classList.toggle('active', index <= ['company', 'usecase', 'source', 'context'].indexOf(step)));
  document.querySelector('#workspace').value = onboardingData.workspace || '';
  document.querySelector('#context').value = onboardingData.context || '';
  document.querySelector('#character-count').textContent = (onboardingData.context || '').length;
  document.querySelectorAll('.choice-grid button').forEach((button) => button.classList.toggle('active', onboardingData[button.parentElement.dataset.field] === button.textContent));
  const next = document.querySelector(`.wizard-step[data-step="${step}"] .step-next`);
  if (next) next.hidden = step === 'company' ? !onboardingData.workspace : !onboardingData[step];
};
if (initialRoute === '/onboarding' || initialRoute.startsWith('/onboarding/')) renderOnboardingStep();
document.querySelectorAll('.choice-grid button').forEach((button) => button.addEventListener('click', () => {
  const group = button.parentElement;
  group.querySelectorAll('button').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  onboardingData[group.dataset.field] = button.textContent;
  sessionStorage.setItem('lian-onboarding', JSON.stringify(onboardingData));
  renderOnboardingStep();
}));
document.querySelector('#workspace').addEventListener('input', (event) => { onboardingData.workspace = event.target.value; sessionStorage.setItem('lian-onboarding', JSON.stringify(onboardingData)); renderOnboardingStep(); });
document.querySelectorAll('.step-next').forEach((button) => button.addEventListener('click', () => window.location.assign(`/onboarding/${button.dataset.next}`)));
document.querySelector('.onboarding-submit').addEventListener('click', async () => {
  const workspace = onboardingData.workspace.trim();
  if (!workspace) return window.location.assign('/onboarding/company');
  const submit = document.querySelector('.onboarding-submit');
  submit.disabled = true; submit.textContent = 'Creating workspace…';
  try { const response = await fetch('/api/onboarding', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...onboardingData, workspace }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); appState.workspace = result.workspace; persist(); sessionStorage.removeItem('lian-onboarding'); window.location.assign('/console/get-started'); } catch (error) { submit.disabled = false; submit.innerHTML = 'Open Lian Console <span>→</span>'; alert(error.message || 'Unable to create your workspace.'); }
});
document.querySelector('#context').addEventListener('input', (event) => { onboardingData.context = event.target.value; sessionStorage.setItem('lian-onboarding', JSON.stringify(onboardingData)); document.querySelector('#character-count').textContent = event.target.value.length; });

const installContent = {
  python: [['Install the SDK', 'Install the local-first Python SDK. No Docker or account is required for the first run.', 'pip <em>install</em> lian-sdk[local]'], ['Add a memory', 'Store an event with its real-world timestamp and structured financial metadata.', 'mem.<em>add</em>(agent_id="analyst-1", content="NVDA guidance raised to $40B")'], ['Recall at a point in time', 'Ask what was valid when a decision was made.', 'mem.<em>recall_at</em>(agent_id="analyst-1", query="NVDA guidance", as_of=...)']],
  node: [['Install the SDK', 'Add the Node package to your existing agent application.', 'npm <em>install</em> lian'], ['Create the client', 'Use your local or hosted Lian endpoint.', 'import { <em>LianClient</em> } from "lian"'], ['Recall a fact', 'Request context that is valid right now or at a prior date.', 'await client.<em>recall</em>({ query: "NVDA guidance" })']],
  curl: [['Write a memory', 'Send a fact, its event time, and metadata to the memory service.', 'curl -X <em>POST</em> /v1/memories'], ['Recall it', 'Use the optional as_of field for historical recall.', 'curl -X <em>POST</em> /v1/recall'], ['Verify the trail', 'Reconstruct the memory state behind an agent decision.', 'curl /v1/audit/<em>reconstruct</em>']],
};
const renderSteps = (language) => { document.querySelector('#install-steps').innerHTML = installContent[language].map((step, index) => `<article class="install-step"><span class="step-number">${index + 1}</span><div><h3>${step[0]}</h3><p>${step[1]}</p></div><div class="code-block"><header>${language}</header><pre>${step[2]}</pre></div></article>`).join(''); };
renderSteps('python');
document.querySelectorAll('.language-tabs button').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('.language-tabs button').forEach((item) => item.classList.remove('active')); button.classList.add('active'); renderSteps(button.dataset.language); }));
document.querySelectorAll('.path-card').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('.path-card').forEach((item) => item.classList.remove('active')); button.classList.add('active'); }));

const viewMeta = { 'get-started': ['SETUP', 'Get started'], playground: ['SETUP', 'Playground'], 'api-keys': ['SETUP', 'API keys'], dashboard: ['ACTIVITY', 'Dashboard'], requests: ['ACTIVITY', 'Requests'], entities: ['ACTIVITY', 'Entities'], recalls: ['ACTIVITY', 'Recalls'], memories: ['ACTIVITY', 'Memories'], audit: ['ACTIVITY', 'Audit trail'], graph: ['ACTIVITY', 'Graph'], webhooks: ['ACTIVITY', 'Webhooks'], exports: ['ACTIVITY', 'Memory exports'], settings: ['ACCOUNT', 'Settings'], billing: ['ACCOUNT', 'Usage & billing'] };
const activateView = (view, updateUrl = false) => {
  if (!viewMeta[view]) view = 'get-started';
  document.querySelectorAll('.nav-item[data-view]').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  document.querySelectorAll('.view').forEach((item) => item.classList.toggle('active', item.id === `view-${view}`));
  document.querySelector('#view-label').textContent = viewMeta[view][0];
  document.querySelector('#view-title').textContent = viewMeta[view][1];
  document.querySelector('.sidebar').classList.remove('open');
  if (updateUrl && window.location.protocol.startsWith('http')) window.history.pushState({}, '', `/console/${view}`);
  if (view === 'api-keys') loadKeys();
};
document.querySelectorAll('.nav-item[data-view]').forEach((button) => button.addEventListener('click', () => activateView(button.dataset.view, true)));
const initialPath = window.location.pathname.match(/^\/console\/([\w-]+)/)?.[1];
if (initialPath) activateView(initialPath, false);
window.addEventListener('popstate', () => activateView(window.location.pathname.match(/^\/console\/([\w-]+)/)?.[1] || 'get-started', false));
document.querySelector('#run-recall').addEventListener('click', async () => { const answer = document.querySelector('#playground-answer'); try { const response = await fetch('/api/demo/recall', { method: 'POST' }); const result = await response.json(); answer.querySelector('strong').textContent = result.value; answer.querySelector('p').textContent = result.content; answer.querySelector('small').textContent = `✓ ${result.audit}`; } catch { answer.querySelector('small').textContent = 'Demo result shown locally. Start node server.js to log this request.'; } answer.hidden = false; });

const displayDate = (value) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const keyTable = document.querySelector('#key-table');
const backendNote = document.querySelector('#backend-note');
const renderKeys = (keys) => {
  const existing = keyTable.querySelectorAll('.key-row'); existing.forEach((row) => row.remove());
  const empty = document.querySelector('#key-state'); empty.hidden = keys.length > 0;
  keys.forEach((key) => { const row = document.createElement('div'); row.className = 'key-row'; row.innerHTML = `<b>${key.name}</b><code>${key.prefix}</code><span>${displayDate(key.createdAt)}</span><span class="key-status ${key.revokedAt ? 'revoked' : ''}">${key.revokedAt ? 'Revoked' : 'Active'}</span><button type="button" data-revoke="${key.id}" ${key.revokedAt ? 'disabled' : ''}>${key.revokedAt ? 'Revoked' : 'Revoke'}</button>`; keyTable.append(row); });
  document.querySelectorAll('[data-revoke]').forEach((button) => button.addEventListener('click', async () => { await fetch(`/api/keys/${button.dataset.revoke}`, { method: 'DELETE' }); loadKeys(); }));
};
async function loadKeys() { try { const response = await fetch('/api/keys'); if (!response.ok) throw new Error(); const { keys } = await response.json(); renderKeys(keys); backendNote.textContent = 'Keys are stored by the local Lian Console server. Secrets are hashed before storage.'; } catch { backendNote.textContent = 'Start the server with node server.js to create and manage persistent local API keys.'; } }
document.querySelector('#key-form').addEventListener('submit', async (event) => { event.preventDefault(); const name = document.querySelector('#key-name').value; try { const response = await fetch('/api/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); document.querySelector('#new-key-secret').textContent = result.secret; document.querySelector('#key-reveal').hidden = false; document.querySelector('#key-name').value = ''; loadKeys(); } catch (error) { backendNote.textContent = error.message || 'Unable to create a key. Start node server.js and try again.'; } });
document.querySelector('#copy-key').addEventListener('click', async () => { const button = document.querySelector('#copy-key'); await navigator.clipboard.writeText(document.querySelector('#new-key-secret').textContent); button.textContent = 'Copied'; setTimeout(() => { button.textContent = 'Copy'; }, 1600); });
document.querySelector('#save-settings').addEventListener('click', () => { appState.workspace = document.querySelector('#settings-workspace').value || 'default-project'; document.querySelector('#project-name').textContent = appState.workspace; persist(); });
document.querySelector('#sign-out').addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST' }); localStorage.removeItem('lian-console-state'); window.location.assign('/login'); });
document.querySelector('.mobile-menu').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('open'));

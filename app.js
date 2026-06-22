const appState = JSON.parse(localStorage.getItem('lian-console-state') || '{}');
const authPage = document.querySelector('#auth-page');
const onboardingPage = document.querySelector('#onboarding-page');
const consolePage = document.querySelector('#console-page');
const show = (page) => { [authPage, onboardingPage, consolePage].forEach((item) => { item.hidden = item !== page; }); };
const persist = () => localStorage.setItem('lian-console-state', JSON.stringify(appState));

if (appState.ready) show(consolePage);

const beginOnboarding = (provider) => {
  appState.provider = provider;
  persist();
  show(onboardingPage);
};
document.querySelectorAll('.oauth-button').forEach((button) => button.addEventListener('click', () => beginOnboarding(button.dataset.provider)));
document.querySelector('#email-form').addEventListener('submit', (event) => { event.preventDefault(); beginOnboarding(document.querySelector('#email').value); });
document.querySelector('#back-to-auth').addEventListener('click', () => show(authPage));

let onboardingStep = 1;
const onboardingData = { team: '', usecase: '' };
const stepContent = { 1: { title: 'Tell us about<br />your workspace.', copy: 'This helps Lian tailor a sensible starting point. You can change it anytime.', button: 'Continue' }, 2: { title: 'Where will Lian<br />power memory?', copy: 'Choose the job your first agent needs to do. This only changes the starter guide we show you.', button: 'Continue' }, 3: { title: 'Your workspace<br />is ready.', copy: '', button: 'Open Lian Console' } };
const setOnboardingStep = (step) => {
  onboardingStep = step;
  const content = stepContent[step];
  document.querySelector('#onboarding-step').textContent = `STEP ${step} OF 3`;
  document.querySelector('#onboarding-title').innerHTML = content.title;
  document.querySelector('#onboarding-copy').textContent = content.copy;
  document.querySelector('#submit-text').textContent = content.button;
  document.querySelectorAll('.onboarding-step').forEach((section) => { section.hidden = Number(section.dataset.step) !== step; });
  document.querySelectorAll('.progress i').forEach((item, index) => item.classList.toggle('active', index < step));
};
document.querySelectorAll('.choice-grid button').forEach((button) => button.addEventListener('click', () => {
  const group = button.parentElement;
  group.querySelectorAll('button').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  onboardingData[group.dataset.field] = button.textContent;
}));
document.querySelector('#onboarding-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (onboardingStep === 1 && !document.querySelector('#workspace').value.trim()) { document.querySelector('#workspace').focus(); return; }
  if (onboardingStep < 3) { setOnboardingStep(onboardingStep + 1); return; }
  appState.ready = true;
  appState.workspace = document.querySelector('#workspace').value.trim() || 'default-project';
  persist();
  document.querySelector('#project-name').textContent = appState.workspace;
  document.querySelector('#settings-workspace').value = appState.workspace;
  show(consolePage);
});

const installContent = {
  python: [['Install the SDK', 'Install the local-first Python SDK. No Docker or account is required for the first run.', 'pip <em>install</em> lian-sdk[local]'], ['Add a memory', 'Store an event with its real-world timestamp and structured financial metadata.', 'mem.<em>add</em>(agent_id="analyst-1", content="NVDA guidance raised to $40B")'], ['Recall at a point in time', 'Ask what was valid when a decision was made.', 'mem.<em>recall_at</em>(agent_id="analyst-1", query="NVDA guidance", as_of=...)']],
  node: [['Install the SDK', 'Add the Node package to your existing agent application.', 'npm <em>install</em> lian'], ['Create the client', 'Use your local or hosted Lian endpoint.', 'import { <em>LianClient</em> } from "lian"'], ['Recall a fact', 'Request context that is valid right now or at a prior date.', 'await client.<em>recall</em>({ query: "NVDA guidance" })']],
  curl: [['Write a memory', 'Send a fact, its event time, and metadata to the memory service.', 'curl -X <em>POST</em> /v1/memories'], ['Recall it', 'Use the optional as_of field for historical recall.', 'curl -X <em>POST</em> /v1/recall'], ['Verify the trail', 'Reconstruct the memory state behind an agent decision.', 'curl /v1/audit/<em>reconstruct</em>']],
};
const renderSteps = (language) => { document.querySelector('#install-steps').innerHTML = installContent[language].map((step, index) => `<article class="install-step"><span class="step-number">${index + 1}</span><div><h3>${step[0]}</h3><p>${step[1]}</p></div><div class="code-block"><header>${language}</header><pre>${step[2]}</pre></div></article>`).join(''); };
renderSteps('python');
document.querySelectorAll('.language-tabs button').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('.language-tabs button').forEach((item) => item.classList.remove('active')); button.classList.add('active'); renderSteps(button.dataset.language); }));
document.querySelectorAll('.path-card').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('.path-card').forEach((item) => item.classList.remove('active')); button.classList.add('active'); }));

const viewMeta = { 'get-started': ['SETUP', 'Get started'], playground: ['SETUP', 'Playground'], 'api-keys': ['SETUP', 'API keys'], dashboard: ['ACTIVITY', 'Dashboard'], recalls: ['ACTIVITY', 'Recalls'], memories: ['ACTIVITY', 'Memories'], audit: ['ACTIVITY', 'Audit trail'], settings: ['ACCOUNT', 'Settings'] };
document.querySelectorAll('.nav-item[data-view]').forEach((button) => button.addEventListener('click', () => { const view = button.dataset.view; document.querySelectorAll('.nav-item[data-view]').forEach((item) => item.classList.remove('active')); button.classList.add('active'); document.querySelectorAll('.view').forEach((item) => item.classList.toggle('active', item.id === `view-${view}`)); document.querySelector('#view-label').textContent = viewMeta[view][0]; document.querySelector('#view-title').textContent = viewMeta[view][1]; document.querySelector('.sidebar').classList.remove('open'); }));
document.querySelector('#run-recall').addEventListener('click', () => { document.querySelector('#playground-answer').hidden = false; });
document.querySelector('#create-key').addEventListener('click', () => { document.querySelector('#key-state').innerHTML = '<i>✓</i><h3>Demo API key created</h3><p>This static prototype does not generate a real secret. Connect a Lian backend before issuing production credentials.</p>'; });
document.querySelector('#save-settings').addEventListener('click', () => { appState.workspace = document.querySelector('#settings-workspace').value || 'default-project'; document.querySelector('#project-name').textContent = appState.workspace; persist(); });
document.querySelector('#sign-out').addEventListener('click', () => { localStorage.removeItem('lian-console-state'); window.location.reload(); });
document.querySelector('.mobile-menu').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('open'));

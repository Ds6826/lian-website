const menuButton = document.querySelector('.menu-button');
const nav = document.querySelector('.nav-links');
menuButton?.addEventListener('click', () => {
  const open = nav.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.textContent = open ? 'Close' : 'Menu';
});
document.querySelectorAll('.nav-links a').forEach((link) => link.addEventListener('click', () => {
  nav.classList.remove('open');
  menuButton?.setAttribute('aria-expanded', 'false');
  if (menuButton) menuButton.textContent = 'Menu';
}));

const nodes = document.querySelectorAll('.memory-node');
const date = document.querySelector('#selected-date');
const value = document.querySelector('#selected-value');
const label = document.querySelector('#selected-label');
nodes.forEach((node) => node.addEventListener('click', () => {
  nodes.forEach((item) => item.classList.remove('active'));
  node.classList.add('active');
  date.textContent = node.dataset.date;
  value.textContent = node.dataset.value;
  label.textContent = node.dataset.label;
}));

const recallStates = {
  now: { label: 'VALID TODAY', value: '$40B', copy: 'The most recent guidance is active. Four prior revisions are excluded from agent context.', event: 'Nov 19, 2025', validity: 'Open · current', source: 'Earnings update' },
  march: { label: 'VALID ON MAR 1, 2025', value: '$32B', copy: 'The February revision was the active guidance at this moment. Later revisions do not exist yet in the reconstructed context.', event: 'Feb 20, 2025', validity: 'Feb 20 → May 22', source: 'Earnings update' },
  june: { label: 'VALID ON JUN 1, 2025', value: '$36B', copy: 'The May revision was current on this date. Earlier guidance is superseded; later guidance had not been issued.', event: 'May 22, 2025', validity: 'May 22 → Aug 27', source: 'Earnings update' },
};
const recallTabs = document.querySelectorAll('.recall-tab');
const setRecallState = (key) => {
  const state = recallStates[key];
  document.querySelector('#result-label').textContent = state.label;
  document.querySelector('#result-value').textContent = state.value;
  document.querySelector('#result-copy').textContent = state.copy;
  document.querySelector('#result-event').textContent = state.event;
  document.querySelector('#result-validity').textContent = state.validity;
  document.querySelector('#result-source').textContent = state.source;
  recallTabs.forEach((tab) => {
    const active = tab.dataset.recall === key;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
};
recallTabs.forEach((tab) => tab.addEventListener('click', () => setRecallState(tab.dataset.recall)));

const auditToggle = document.querySelector('.audit-toggle');
const auditDrawer = document.querySelector('.audit-drawer');
auditToggle?.addEventListener('click', () => {
  const open = auditToggle.getAttribute('aria-expanded') === 'true';
  auditToggle.setAttribute('aria-expanded', String(!open));
  auditToggle.innerHTML = `${open ? 'Show' : 'Hide'} the decision trail <span>${open ? '+' : '−'}</span>`;
  auditDrawer.hidden = open;
});

const operationStates = {
  remember: { step: '01 / REMEMBER', title: 'A fact enters with context.', copy: 'Record the event timestamp separately from the moment it was ingested. That distinction makes later point-in-time recall possible.', code: 'POST /v1/memories' },
  classify: { step: '02 / CLASSIFY', title: 'The relationship gets a name.', copy: 'Lians uses structured keys and deterministic rules before escalating ambiguous updates to an LLM adjudicator.', code: 'SUPERSEDES · CONFIRMS · ADDS · CONTRADICTS' },
  recall: { step: '03 / RECALL', title: 'Validity comes before ranking.', copy: 'The engine filters for eligible facts at the requested moment, then ranks with semantic, lexical, recency, and importance signals.', code: 'POST /v1/recall?as_of=…' },
  reconstruct: { step: '04 / RECONSTRUCT', title: 'A past decision becomes inspectable.', copy: 'Rebuild the memory set behind an agent response and follow its append-only event trail, including the records that changed it.', code: 'GET /v1/audit/reconstruct' },
};
const operationCards = document.querySelectorAll('.operation-card');
operationCards.forEach((card) => card.addEventListener('click', () => {
  const state = operationStates[card.dataset.operation];
  operationCards.forEach((item) => {
    const active = item === card;
    item.classList.toggle('active', active);
    item.setAttribute('aria-selected', String(active));
  });
  document.querySelector('#operation-step').textContent = state.step;
  document.querySelector('#operation-title').textContent = state.title;
  document.querySelector('#operation-copy').textContent = state.copy;
  document.querySelector('#operation-code').textContent = state.code;
}));

document.querySelectorAll('.relation-row').forEach((row) => row.addEventListener('click', () => {
  const opening = !row.classList.contains('active');
  document.querySelectorAll('.relation-row').forEach((item) => {
    item.classList.remove('active');
    item.setAttribute('aria-expanded', 'false');
  });
  if (opening) {
    row.classList.add('active');
    row.setAttribute('aria-expanded', 'true');
  }
}));

const sdkInstallContent = {
  python: [
    ['Install the SDK', 'Install the local-first Python SDK. No Docker or account is required for the first run.', 'python', 'pip <em>install</em> Lians-sdk[local]'],
    ['Add a memory', 'Store an event with its real-world timestamp and structured metadata.', 'python', 'mem.<em>add</em>(agent_id="analyst-1", content="NVDA guidance raised to $40B")'],
    ['Recall at a point in time', 'Ask what was valid when a decision was made.', 'python', 'mem.<em>recall_at</em>(agent_id="analyst-1", query="NVDA guidance", as_of=...)'],
  ],
  node: [
    ['Install the SDK', 'Add the Node package to your existing agent application.', 'node', 'npm <em>install</em> Lians'],
    ['Create the client', 'Use your local or hosted Lians endpoint.', 'node', 'import { <em>LianClient</em> } from "Lians"'],
    ['Recall a fact', 'Request context that is valid right now or at a prior date.', 'node', 'await client.<em>recall</em>({ query: "NVDA guidance" })'],
  ],
  curl: [
    ['Write a memory', 'Send a fact, its event time, and metadata to the memory service.', 'curl', 'curl -X <em>POST</em> /v1/memories'],
    ['Recall it', 'Use the optional as_of field for historical recall.', 'curl', 'curl -X <em>POST</em> /v1/recall'],
    ['Verify the trail', 'Reconstruct the memory state behind an agent decision.', 'curl', 'curl /v1/audit/<em>reconstruct</em>'],
  ],
};

const renderSdkSteps = (lang) => {
  const container = document.querySelector('#sdk-steps');
  if (!container) return;
  container.innerHTML = sdkInstallContent[lang].map((step, i) => `
    <article class="sdk-step">
      <span class="sdk-step-num">${i + 1}</span>
      <div class="sdk-step-text">
        <h3>${step[0]}</h3>
        <p>${step[1]}</p>
      </div>
      <div class="sdk-code-block">
        <header>${step[2]}</header>
        <pre>${step[3]}</pre>
      </div>
    </article>
  `).join('');
};

renderSdkSteps('python');

document.querySelectorAll('.sdk-lang-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.sdk-lang-tab').forEach((t) => {
      t.classList.toggle('active', t === tab);
      t.setAttribute('aria-selected', String(t === tab));
    });
    renderSdkSteps(tab.dataset.lang);
  });
});

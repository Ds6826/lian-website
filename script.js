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

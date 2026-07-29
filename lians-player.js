(() => {
  const host = document.getElementById('memory-player');
  if (!host) return;

  const steps = [
    {
      label: '01',
      title: 'A fact arrives',
      summary: 'The agent records the fact and its source before it can influence a decision.',
      nodes: [
        ['Agent', 'observes guidance'],
        ['Record', '$32B · source v1'],
        ['Evidence', 'event 2025-02-20']
      ],
      note: 'Nothing enters the evidence record without provenance.'
    },
    {
      label: '02',
      title: 'Policy checks it',
      summary: 'Admission controls screen the record for sensitive data, source trust, injection, and ambiguity.',
      nodes: [
        ['Record', '$32B · source v1'],
        ['Policy', '4 checks passed'],
        ['Admitted', 'policy receipt']
      ],
      note: 'Checks are explicit, inspectable, and attached to the record.'
    },
    {
      label: '03',
      title: 'Two clocks preserve it',
      summary: 'Lians stores when the fact was true and when the system learned it.',
      nodes: [
        ['Event time', '2025-02-20'],
        ['System time', '2025-02-20'],
        ['Evidence', 'valid · open']
      ],
      note: 'That distinction makes point-in-time reconstruction possible.'
    },
    {
      label: '04',
      title: 'The world changes',
      summary: 'A newer source revises the guidance. The old record is closed, not deleted.',
      nodes: [
        ['Previous', '$32B · retained'],
        ['Revision', '$40B · source v2'],
        ['History', 'supersession linked']
      ],
      note: 'The complete change history remains available for review.'
    },
    {
      label: '05',
      title: 'Recall now or then',
      summary: 'Current recall returns $40B. A reconstruction as of March returns only the $32B fact known then.',
      nodes: [
        ['Question', 'What was known?'],
        ['As of Mar 1', '$32B'],
        ['Today', '$40B']
      ],
      note: 'Future information cannot leak into the historical answer.'
    },
    {
      label: '06',
      title: 'Verify the decision',
      summary: 'The record, policy checks, revisions, and recall are bound into a verifiable receipt.',
      nodes: [
        ['Decision', 'context fixed'],
        ['Receipt', 'hash chain valid'],
        ['Proof', 'exportable']
      ],
      note: 'A reviewer can verify what the AI knew without trusting a screenshot.'
    }
  ];

  host.className = 'walkthrough';
  host.innerHTML = `
    <div class="walkthrough-stage" aria-live="polite">
      <div class="walkthrough-copy">
        <span class="walkthrough-index"></span>
        <div>
          <h3 class="walkthrough-title"></h3>
          <p class="walkthrough-summary"></p>
        </div>
      </div>
      <div class="walkthrough-flow"></div>
      <p class="walkthrough-note"></p>
    </div>
    <div class="walkthrough-nav" aria-label="Product walkthrough steps"></div>
  `;

  const index = host.querySelector('.walkthrough-index');
  const title = host.querySelector('.walkthrough-title');
  const summary = host.querySelector('.walkthrough-summary');
  const flow = host.querySelector('.walkthrough-flow');
  const note = host.querySelector('.walkthrough-note');
  const nav = host.querySelector('.walkthrough-nav');
  let active = 0;
  let hasRendered = false;
  let rotationTimer = null;
  const rotationDelay = 5200;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const stopRotation = () => {
    if (rotationTimer) window.clearTimeout(rotationTimer);
    rotationTimer = null;
  };

  const scheduleRotation = () => {
    stopRotation();
    if (
      reducedMotion.matches ||
      document.hidden ||
      host.matches(':hover') ||
      host.contains(document.activeElement)
    ) return;
    rotationTimer = window.setTimeout(() => {
      render((active + 1) % steps.length);
    }, rotationDelay);
  };

  const buttons = steps.map((step, stepIndex) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML = `<span>${step.label}</span>${step.title}`;
    button.addEventListener('click', () => render(stepIndex, true));
    nav.appendChild(button);
    return button;
  });

  function render(stepIndex, userInitiated = false) {
    active = stepIndex;
    const step = steps[active];
    index.textContent = step.label;
    title.textContent = step.title;
    summary.textContent = step.summary;
    note.textContent = step.note;
    flow.innerHTML = step.nodes.map(([name, value], nodeIndex) => `
      ${nodeIndex ? '<i aria-hidden="true">→</i>' : ''}
      <div class="walkthrough-node">
        <small>${name}</small>
        <strong>${value}</strong>
      </div>
    `).join('');
    buttons.forEach((button, buttonIndex) => {
      const selected = buttonIndex === active;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    if (!userInitiated && hasRendered) {
      const activeButton = buttons[active];
      const left = activeButton.offsetLeft - (nav.clientWidth - activeButton.offsetWidth) / 2;
      nav.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
    }
    hasRendered = true;
    scheduleRotation();
  }

  host.addEventListener('mouseenter', stopRotation);
  host.addEventListener('mouseleave', scheduleRotation);
  host.addEventListener('focusin', stopRotation);
  host.addEventListener('focusout', (event) => {
    if (!host.contains(event.relatedTarget)) scheduleRotation();
  });
  document.addEventListener('visibilitychange', scheduleRotation);
  reducedMotion.addEventListener?.('change', scheduleRotation);

  render(0);
})();

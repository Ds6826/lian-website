const governorStates = {
  1: { input: '“NVDA FY2026 revenue guidance is $28B.”', badge: 'ADD', badgeClass: 'badge-add', title: 'Store $28B guidance', proposal: 'A new financial fact is proposed with a timestamp, source, and structured key.', status: 'APPROVED', commit: '$28B becomes the active fact', current: 'NVDA FY2026 revenue guidance is $28B.', suppressed: [], audit: 'Hash-chain verified' },
  2: { input: '“NVDA FY2026 revenue guidance was raised to $32B.”', badge: 'SUPERSEDE', badgeClass: 'badge-supersede', title: 'Replace $28B with $32B', proposal: 'Lians detects the same entity and metric, then proposes a supersession instead of an overwrite.', status: 'APPROVED', commit: '$32B activates; $28B validity closes', current: 'NVDA FY2026 revenue guidance is $32B.', suppressed: ['$28B → superseded by $32B'], audit: 'Hash-chain verified · Evidence linked' },
  3: { input: '“NVDA FY2026 revenue guidance was raised again to $40B.”', badge: 'SUPERSEDE', badgeClass: 'badge-supersede', title: 'Replace $32B with $40B', proposal: 'A second governed proposal preserves the revision chain and closes the prior validity window.', status: 'APPROVED', commit: '$40B activates; $32B validity closes', current: 'NVDA FY2026 revenue guidance is $40B.', suppressed: ['$28B → superseded by $32B', '$32B → superseded by $40B'], audit: 'Hash-chain verified · Evidence linked' },
};
const stepButtons = document.querySelectorAll('.demo-step');
const updateGovernor = (step, recall = false) => {
  const state = governorStates[step];
  document.querySelector('#governor-input').textContent = state.input;
  const badge = document.querySelector('#proposal-badge'); badge.textContent = state.badge; badge.className = state.badgeClass;
  document.querySelector('#proposal-title').textContent = state.title;
  document.querySelector('#proposal-copy').textContent = state.proposal;
  document.querySelector('#proposal-status').textContent = state.status;
  document.querySelector('#commit-copy').textContent = state.commit;
  document.querySelector('#recall-current').textContent = recall ? 'NVDA FY2026 revenue guidance is $40B.' : state.current;
  document.querySelector('#suppressed-list').innerHTML = recall ? '<p>$28B → superseded by $32B</p><p>$32B → superseded by $40B</p>' : (state.suppressed.length ? state.suppressed.map((item) => `<p>${item}</p>`).join('') : '<p>No suppressed memories yet.</p>');
  document.querySelector('#recall-audit').textContent = recall ? 'Hash-chain verified · Evidence linked · Recall explainable' : state.audit;
  document.querySelector('#recall-state').textContent = recall ? 'CURRENT' : state.status;
};
stepButtons.forEach((button) => button.addEventListener('click', () => { const value = button.dataset.governorStep; stepButtons.forEach((item) => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-selected', String(active)); }); updateGovernor(value === 'recall' ? 3 : Number(value), value === 'recall'); }));

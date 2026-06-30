// Minimal interactions for the Lians site: mobile nav + terminal language tabs.
const menuBtn = document.querySelector('.menu-btn');
const navLinks = document.querySelector('.nav .links');
menuBtn?.addEventListener('click', () => {
  const open = navLinks.classList.toggle('open');
  menuBtn.setAttribute('aria-expanded', String(open));
  menuBtn.textContent = open ? 'Close' : 'Menu';
});

const termTabs = document.querySelectorAll('.term-tab');
const termBodies = document.querySelectorAll('.term-body[data-term]');
termTabs.forEach((tab) => tab.addEventListener('click', () => {
  const lang = tab.dataset.lang;
  termTabs.forEach((t) => {
    const on = t === tab;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', String(on));
  });
  termBodies.forEach((b) => { b.hidden = b.dataset.term !== lang; });
}));

// Theme toggle (light / dark), persisted in localStorage. Injected into the nav.
(function () {
  const root = document.documentElement;
  const isLight = () => root.getAttribute('data-theme') === 'light';
  const label = () => (isLight() ? '☾ Dark' : '☀ Light');
  const links = document.querySelector('.nav .links');
  if (!links) return;
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
  links.insertBefore(btn, links.querySelector('.cta') || null);
})();

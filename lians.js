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

// Arrow keys move between terminal tabs, per the tablist pattern.
document.querySelector('.term-tabs')?.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const tabs = [...termTabs];
  const i = tabs.findIndex((t) => t.classList.contains('active'));
  if (i < 0) return;
  e.preventDefault();
  const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
  next.click();
  next.focus();
});

// Copy the active tab's install command.
const termCopy = document.querySelector('.term-copy');
termCopy?.addEventListener('click', async () => {
  const cmd = document.querySelector('.term-tab.active')?.dataset.install;
  if (!cmd) return;
  try {
    await navigator.clipboard.writeText(cmd);
    termCopy.classList.add('copied');
    termCopy.textContent = 'copied';
    setTimeout(() => { termCopy.classList.remove('copied'); termCopy.textContent = 'copy'; }, 1400);
  } catch (e) {}
});

// GitHub stars badge: live count from the public API, cached 1h in localStorage.
(function () {
  const el = document.querySelector('[data-gh-stars]');
  if (!el) return;
  const wrap = el.closest('.gh-stars-wrap');
  const show = (n) => {
    if (n < 5) return; // a visible zero is a worse signal than no badge
    el.textContent = n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n);
    if (wrap) wrap.hidden = false;
  };
  try {
    const c = JSON.parse(localStorage.getItem('lians-gh-stars') || 'null');
    if (c && Date.now() - c.t < 3600e3) { show(c.n); return; }
  } catch (e) {}
  fetch('https://api.github.com/repos/Lians-ai/Lians')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('gh'))))
    .then((d) => {
      if (typeof d.stargazers_count !== 'number') return;
      try { localStorage.setItem('lians-gh-stars', JSON.stringify({ n: d.stargazers_count, t: Date.now() })); } catch (e) {}
      show(d.stargazers_count);
    })
    .catch(() => {}); // badge stays hidden - never break the page over a star count
})();

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

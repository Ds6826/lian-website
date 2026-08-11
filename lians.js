// Minimal interactions for the Lians site: mobile nav + terminal language tabs.
const menuBtn = document.querySelector('.menu-btn');
const navLinks = document.querySelector('.nav .links');
if (navLinks) {
  navLinks.innerHTML = `<a href="/product">Product</a><a href="/docs">Docs</a><a href="/pricing">Pricing</a><a class="muted" href="https://github.com/Lians-ai/Lians" target="_blank" rel="noreferrer" data-track="github_clicked">GitHub ↗</a><a class="muted" href="/login" data-sign-in-link>Sign in</a><a class="cta" href="/design-partners">Talk to us</a>`;
}
// Keep legacy legal-page CTAs aligned with the current implementation offer.
document.querySelectorAll('a.btn[href="/design-partners"], a.btn-primary[href="/design-partners"]').forEach((cta) => {
  cta.href = '/design-partners';
  cta.textContent = 'Plan your implementation →';
});
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

// Landing-page visitors with a live Clerk session are already signed in, so
// remove the redundant header sign-in action once the same-origin session
// endpoint confirms it. Anonymous visitors continue to see the link.
(function () {
  const signInLink = document.querySelector('[data-sign-in-link]');
  if (!signInLink) return;
  fetch('/api/session', { credentials: 'same-origin' })
    .then((response) => (response.ok ? response.json() : null))
    .then((session) => {
      if (session?.authenticated) signInLink.remove();
    })
    .catch(() => {});
})();

const trackFunnel = (name, detail = {}) => {
  const payload = { event: name, ...detail };
  window.dataLayer?.push(payload);
  window.dispatchEvent(new CustomEvent('lians:funnel', { detail: payload }));
};
document.querySelectorAll('[data-track]').forEach((el) => el.addEventListener('click', () => trackFunnel(el.dataset.track)));
if (location.pathname === '/design-partners') trackFunnel('partner_page_viewed');

const demo = document.querySelector('#watch');
if (demo) {
  let started = false;
  new IntersectionObserver(([entry], observer) => {
    if (!entry?.isIntersecting || started) return;
    started = true;
    trackFunnel('changing_facts_demo_started');
    observer.disconnect();
  }, { threshold: 0.45 }).observe(demo);
  document.addEventListener('lians:demo-completed', () => trackFunnel('changing_facts_demo_completed'), { once: true });
}

const partnerForm = document.querySelector('#partner-application');
if (partnerForm) {
  if (!partnerForm.elements.namedItem('website')) {
    const trap = document.createElement('label');
    trap.className = 'form-trap';
    trap.setAttribute('aria-hidden', 'true');
    trap.innerHTML = 'Website<input name="website" tabindex="-1" autocomplete="off">';
    partnerForm.prepend(trap);
  }
  const status = document.querySelector('#partner-form-status');
  partnerForm.addEventListener('input', () => trackFunnel('partner_application_started'), { once: true });
  const params = new URLSearchParams(location.search);
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach((key) => {
    partnerForm.elements.namedItem(key).value = params.get(key) || '';
  });
  partnerForm.elements.namedItem('landing_page').value = location.href;
  partnerForm.elements.namedItem('referring_url').value = document.referrer;
  partnerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = partnerForm.querySelector('[type="submit"]');
    button.disabled = true;
    status.textContent = 'Submitting…';
    try {
      const formData = new FormData(partnerForm);
      const file = formData.get('architecture_file');
      formData.delete('architecture_file');
      const body = Object.fromEntries(formData);
      if (file?.size) {
        if (file.size > 180_000) throw new Error('Keep the optional upload under 180 KB.');
        body.architecture_file = { name: file.name, type: file.type, data_url: await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); }) };
      }
      const response = await fetch('/api/partner-applications', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to submit your application.');
      trackFunnel('partner_application_submitted', { preferred_track: body.preferred_track, current_stage: body.current_stage });
      partnerForm.hidden = true;
      document.querySelector('#partner-form-success').hidden = false;
      const booking = document.querySelector('#partner-booking-link');
      if (result.schedulingUrl && booking) {
        booking.href = result.schedulingUrl;
        booking.hidden = false;
        booking.addEventListener('click', () => trackFunnel('partner_call_booked'), { once: true });
      }
    } catch (error) {
      status.textContent = error.message;
      button.disabled = false;
    }
  });
}

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

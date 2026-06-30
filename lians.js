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

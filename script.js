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

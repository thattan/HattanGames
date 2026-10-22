// Tiny DOM helpers shared by the game clients.

export const $ = (id) => document.getElementById(id);

export function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children) node.append(c);
  return node;
}

export function chip(color) {
  const c = el('span', { className: 'chip' });
  c.style.background = color;
  return c;
}

let toastTimer;
export function toast(message) {
  const node = $('toast');
  if (!node) return;
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 2200);
}

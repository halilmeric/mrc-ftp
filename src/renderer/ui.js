'use strict';
// Küçük DOM yardımcıları; tüm arayüz dosyaları bunları kullanır.
function el(tag, props, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid);
  return node;
}

let openMenu = null;
function closeMenu() {
  if (openMenu) openMenu.remove();
  openMenu = null;
}
function showMenu(x, y, items) {
  closeMenu();
  openMenu = el('div', { class: 'menu', role: 'menu' }, items.map((it) =>
    el('button', { type: 'button', role: 'menuitem', class: it.danger ? 'd' : '', onclick: () => { closeMenu(); it.run(); } }, it.label)));
  document.body.append(openMenu);
  const box = openMenu.getBoundingClientRect();
  openMenu.style.left = Math.min(x, innerWidth - box.width - 6) + 'px';
  openMenu.style.top = Math.min(y, innerHeight - box.height - 6) + 'px';
}
addEventListener('click', closeMenu);
addEventListener('blur', closeMenu);
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

function notify(message) {
  const box = document.getElementById('notice');
  box.textContent = message || '';
  box.hidden = !message;
}

const joinPath = (dir, name) => (dir.endsWith('/') ? dir + name : dir + '/' + name);

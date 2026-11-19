'use strict';
// Ayrılan terminal penceresi: ana süreçteki oturumun ikinci görünümü.
(async function main() {
  const $ = (id) => document.getElementById(id);
  const view = createTermView($('term-body'));
  const status = bindTermStatus({ view, note: $('term-note'), restart: $('term-restart') });
  $('term-dock').addEventListener('click', () => mrc.term.dock());
  $('term-restart').addEventListener('click', () => { view.clear(); mrc.term.start(view.size()); });
  status.show(await view.replay(), true); // önceki çıktı ekrana geri yazılır
  view.refit();
  view.focus();
})();

'use strict';
// "Toplu yeniden adlandır" penceresi: eski → yeni adları önceden gösterir; sorun varsa uygulamaz.
function initBatch() {
  const $ = (id) => document.getElementById(id);
  let current = null; // { dir, names, taken, done }
  let rows = [];

  function preview() {
    rows = batchNames(current.names, $('b-find').value, $('b-replace').value, current.taken);
    $('b-list').replaceChildren(...rows.map((r) => el('div', { class: 'brow' + (r.error ? ' bad' : r.to === r.from ? ' same' : '') },
      el('span', { title: r.from }, r.from), el('i', {}, '→'), el('span', { title: r.to }, r.to || '(boş)'), r.error && el('small', {}, r.error))));
    const changed = rows.filter((r) => r.to !== r.from).length;
    $('b-apply').disabled = changed === 0 || rows.some((r) => r.error);
    $('b-err').hidden = true;
  }
  $('b-find').addEventListener('input', preview);
  $('b-replace').addEventListener('input', preview);
  $('b-cancel').addEventListener('click', () => $('dlg-batch').close());
  $('batch-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if ($('b-apply').disabled) return;
    $('b-apply').disabled = true;
    try {
      for (const r of rows) if (r.to !== r.from) await mrc.remote.rename(joinPath(current.dir, r.from), joinPath(current.dir, r.to));
      $('dlg-batch').close();
    } catch (err) {
      $('b-err').textContent = `${err.message} Kalan adlar değiştirilmedi.`;
      $('b-err').hidden = false;
    }
    current.done();
  });

  return {
    open(dir, entries, taken, done) {
      current = { dir, names: entries.map((e) => e.name), taken, done };
      $('batch-title').textContent = `${entries.length} öğeyi yeniden adlandır`;
      $('b-find').value = '';
      $('b-replace').value = '';
      preview();
      $('dlg-batch').showModal();
    },
  };
}

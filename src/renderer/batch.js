'use strict';
// "Toplu yeniden adlandır" penceresi: eski → yeni adları önceden gösterir; sorun varsa uygulamaz.
function initBatch() {
  const $ = (id) => document.getElementById(id);
  let current = null; // { dir, names, taken, done }
  let rows = [];

  let busy = false;

  function preview() {
    rows = batchNames(current.names, $('b-find').value, $('b-replace').value, current.taken);
    $('b-list').replaceChildren(...rows.map((r) => el('div', { class: 'brow' + (r.error ? ' bad' : r.to === r.from ? ' same' : '') },
      el('span', { title: r.from }, r.from), el('i', {}, '→'), el('span', { title: r.to }, r.to || t('(boş)')), r.error && el('small', {}, r.error))));
    const changed = rows.filter((r) => r.to !== r.from).length;
    $('b-apply').disabled = busy || changed === 0 || rows.some((r) => r.error);
  }
  const setBusy = (on) => {
    busy = on;
    $('b-find').disabled = on;
    $('b-replace').disabled = on;
    $('b-apply').disabled = on;
  };
  const onInput = () => { $('b-err').hidden = true; preview(); };
  $('b-find').addEventListener('input', onInput);
  $('b-replace').addEventListener('input', onInput);
  $('b-cancel').addEventListener('click', () => $('dlg-batch').close());
  $('batch-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy || $('b-apply').disabled) return;
    const { dir, names, done } = current;
    setBusy(true);
    let failed = null;
    try {
      // Önizleme panelin eski listesine göre yapıldı; sunucudaki taşıma var olan dosyanın üzerine sessizce yazar.
      // Bu yüzden uygulamadan hemen önce klasör yeniden okunur ve adlar ona göre bir kez daha denetlenir.
      const fresh = (await mrc.remote.list(dir)).map((entry) => entry.name);
      if (names.some((n) => !fresh.includes(n))) throw new Error(t('Seçili öğelerden biri artık klasörde yok.'));
      current.taken = fresh;
      const plan = batchNames(names, $('b-find').value, $('b-replace').value, fresh);
      if (plan.some((r) => r.error)) {
        $('b-err').textContent = t('Klasör bu arada değişti; işaretli adları düzelt.');
        $('b-err').hidden = false;
        return;
      }
      for (const r of plan) if (r.to !== r.from) await mrc.remote.rename(joinPath(dir, r.from), joinPath(dir, r.to));
    } catch (err) {
      failed = err;
    } finally {
      setBusy(false);
      if ($('b-err').hidden) $('dlg-batch').close(); // yarıda kaldıysa da kapanır: eski liste üzerinden yeniden denenmesin
      else preview();
      done();
    }
    if (failed) notify(t`Toplu ad değiştirme yarıda kaldı: ${failed.message} Kalan adlar değiştirilmedi.`);
  });

  return {
    open(dir, entries, taken, done) {
      current = { dir, names: entries.map((e) => e.name), taken, done };
      $('batch-title').textContent = t`${entries.length} öğeyi yeniden adlandır`;
      $('b-find').value = '';
      $('b-replace').value = '';
      $('b-err').hidden = true;
      preview();
      $('dlg-batch').showModal();
    },
  };
}

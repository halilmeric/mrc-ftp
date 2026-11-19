'use strict';
// "Bilgi ve izinler" penceresi: dokuz onay kutusu ile üç haneli sayı birbirini günceller.
function initInfo() {
  const $ = (id) => document.getElementById(id);
  const WHO = ['Sahip', 'Grup', 'Herkes'];
  const WHAT = ['Oku', 'Yaz', 'Çalıştır'];
  const boxes = [];
  let current = null;

  $('info-perm').append(
    el('tr', {}, el('th', {}), WHAT.map((w) => el('th', {}, w))),
    ...WHO.map((who, row) => el('tr', {}, el('th', {}, who), WHAT.map((what, col) => {
      const box = el('input', { type: 'checkbox', 'aria-label': `${who}: ${what}` });
      boxes[row * 3 + col] = box;
      box.addEventListener('change', () => { $('info-mode').value = modeToText(readBoxes()); });
      return el('td', {}, box);
    }))));

  // Kutu sırası sekizli bitlerle aynı: sahip-oku en yüksek bit (0o400), herkes-çalıştır en düşük (0o001).
  const readBoxes = () => boxes.reduce((mode, box, i) => mode | (box.checked ? 1 << (8 - i) : 0), 0);
  const writeBoxes = (mode) => boxes.forEach((box, i) => { box.checked = Boolean(mode & (1 << (8 - i))); });

  $('info-mode').addEventListener('input', () => {
    const mode = textToMode($('info-mode').value);
    if (mode != null) writeBoxes(mode);
  });
  $('info-cancel').addEventListener('click', () => $('dlg-info').close());
  $('info-apply').addEventListener('click', async () => {
    const mode = textToMode($('info-mode').value);
    $('info-err').hidden = mode != null;
    $('info-err').textContent = 'Üç haneli bir izin yaz, örneğin 644.';
    if (mode == null) return;
    try {
      await mrc.remote.chmod(current.path, mode);
      $('dlg-info').close();
      current.onDone();
    } catch (err) {
      $('info-err').textContent = err.message || 'İzin değiştirilemedi.';
      $('info-err').hidden = false;
    }
  });

  return {
    open(dir, entry, onDone) {
      current = { path: joinPath(dir, entry.name), onDone };
      $('info-name').textContent = entry.name;
      $('info-meta').textContent = [current.path, entry.isDir ? 'klasör' : formatSize(entry.size), formatDate(entry.modified)].join(' · ');
      $('info-note').hidden = entry.mode != null;
      $('info-err').hidden = true;
      writeBoxes(entry.mode || 0);
      $('info-mode').value = entry.mode != null ? modeToText(entry.mode) : '';
      $('dlg-info').showModal();
    },
  };
}

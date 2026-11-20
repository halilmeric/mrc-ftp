'use strict';
// Ayarlar: kullanılmayan özellikler kapatılır, düğmeleri ve menü maddeleri görünmez olur.
// Tüm sekmelerde ortaktır (localStorage); başka sekmedeki değişiklik `storage` olayıyla gelir.
const FEATURE_LIST = [
  ['terminal', 'Terminal', 'SFTP sitelerinde sunucunun komut satırı'],
  ['favorites', 'Sık kullanılan klasörler', ''],
  ['parallel', 'Eşzamanlı aktarım', 'Kapalıyken dosyalar tek tek aktarılır. Bir sonraki bağlantıda geçerli olur.'],
  ['edit', 'Sunucudaki dosyayı düzenleme', ''],
  ['batch', 'Toplu yeniden adlandırma', ''],
  ['preview', 'Hızlı Bakış', 'Boşluk tuşuyla önizleme'],
];
function feat() {
  try {
    return features(localStorage.getItem('mrc.features'));
  } catch {
    return features(null);
  }
}
function initSettings(onChange) {
  const dlg = document.getElementById('dlg-settings');
  const list = document.getElementById('set-list');
  const boxes = FEATURE_LIST.map(([key, title, hint]) => {
    const box = el('input', { type: 'checkbox' });
    box.addEventListener('change', () => {
      const off = boxes.filter((b) => !b.box.checked).map((b) => b.key);
      try { localStorage.setItem('mrc.features', JSON.stringify(off)); } catch { /* yalnızca hatırlanmaz */ }
      onChange();
    });
    list.append(el('label', { class: 'sw' }, box, el('span', {}, el('b', {}, title), hint ? el('small', {}, hint) : '')));
    return { key, box };
  });
  const fill = () => { const f = feat(); for (const b of boxes) b.box.checked = f[b.key]; };
  fill();
  document.getElementById('set-close').addEventListener('click', () => dlg.close());
  addEventListener('storage', (e) => { if (e.key === 'mrc.features') { fill(); onChange(); } });
  mrc.onSettings(() => { fill(); if (!dlg.open) dlg.showModal(); });
}

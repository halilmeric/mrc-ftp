'use strict';
// Ayarlar: kullanılmayan özellikler kapatılır, düğmeleri ve menü maddeleri görünmez olur.
// Tüm sekmelerde ortaktır (localStorage); başka sekmedeki değişiklik `storage` olayıyla gelir.
const FEATURE_LIST = [
  ['terminal', 'Terminal', t('SFTP sitelerinde sunucunun komut satırı')],
  ['favorites', t('Sık kullanılan klasörler'), ''],
  ['parallel', t('Eşzamanlı aktarım'), t('Kapalıyken dosyalar tek tek aktarılır. Bir sonraki bağlantıda geçerli olur.')],
  ['edit', t('Sunucudaki dosyayı düzenleme'), ''],
  ['batch', t('Toplu yeniden adlandırma'), ''],
  ['preview', t('Hızlı Bakış'), t('Boşluk tuşuyla önizleme')],
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
  // Dil: menüler ve hata metinleri ana süreçte üretildiği için değişiklik yeniden başlatınca geçerli olur.
  const pick = el('select', {}, [['', t('Sistem dili')], ['tr', 'Türkçe'], ['en', 'English']].map(([v, text]) => el('option', { value: v }, text)));
  pick.value = mrc.lang.chosen;
  const again = el('p', { class: 'muted', hidden: true }, t('Dil değişikliği uygulama yeniden başlayınca geçerli olur.'), ' ',
    el('button', { class: 'link', type: 'button', onclick: () => mrc.relaunch() }, t('Şimdi yeniden başlat')));
  pick.addEventListener('change', async () => { await mrc.setLang(pick.value); again.hidden = false; });
  list.before(el('label', { class: 'langrow' }, t('Dil'), pick), again);
  const fill = () => { const f = feat(); for (const b of boxes) b.box.checked = f[b.key]; };
  fill();
  document.getElementById('set-close').addEventListener('click', () => dlg.close());
  addEventListener('storage', (e) => { if (e.key === 'mrc.features') { fill(); onChange(); } });
  mrc.onSettings(() => { fill(); if (!dlg.open) dlg.showModal(); });
}

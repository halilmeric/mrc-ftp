const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const i18n = require('../i18n');

// Dil tercihi: 'tr', 'en' ya da boş (sistem dili). Menüler ve hata metinleri açılışta bu dille kurulur,
// bu yüzden değişiklik uygulama yeniden başlayınca geçerli olur.
const file = () => path.join(app.getPath('userData'), 'lang');
let chosen = '';

function load() {
  try {
    chosen = fs.readFileSync(file(), 'utf8').trim();
  } catch {
    // tercih yok: sistem dili
  }
  if (chosen !== 'tr' && chosen !== 'en') chosen = '';
  i18n.setLang(chosen || (app.getLocale().toLowerCase().startsWith('tr') ? 'tr' : 'en'));
}
function setLang(value) {
  chosen = value === 'tr' || value === 'en' ? value : '';
  fs.writeFileSync(file(), chosen);
}
const state = () => ({ current: i18n.getLang(), chosen });

module.exports = { load, setLang, state };

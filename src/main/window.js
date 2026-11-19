const path = require('node:path');

// Tüm pencereler aynı kısıtlarla açılır: yalıtılmış arayüz, uzak içerik yok.
const webPreferences = {
  preload: path.join(__dirname, '..', 'preload.js'),
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
};
const page = (name) => path.join(__dirname, '..', 'renderer', name);

// Gezinme ve yeni pencere reddedilir (terminaldeki bir bağlantı da buna dahil).
function lock(win) {
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  return win;
}

module.exports = { webPreferences, page, lock };

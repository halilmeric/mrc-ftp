const { app, BrowserWindow, Menu } = require('electron');
const { attach, confirmQuit } = require('./ipc');
const { webPreferences, page, lock } = require('./window');

const TABS = 'mrc-ftp'; // aynı kimlikli pencereler macOS'te sekme olarak birleşebilir
const mainWindows = new Set();

// Her pencere bir sitedir. `tabOf` verilirse yeni pencere o pencereye sekme olarak eklenir;
// `siteId` verilirse açılır açılmaz o siteye bağlanır.
function createWindow({ siteId = null, tabOf = null } = {}) {
  // Sekme çubuğu gizli başlık çubuğunda arayüzün üstünü örttüğü için standart başlık çubuğu kullanılır.
  const win = lock(new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 900,
    minHeight: 520,
    title: 'MRC FTP',
    tabbingIdentifier: TABS,
    webPreferences,
  }));
  mainWindows.add(win);
  win.on('closed', () => mainWindows.delete(win));
  attach(win, { openTab: (id) => createWindow({ siteId: id, tabOf: win }) });
  win.loadFile(page('index.html'), siteId ? { query: { site: siteId } } : undefined);
  if (tabOf && !tabOf.isDestroyed()) tabOf.addTabbedWindow(win);
  return win;
}

// Yeni sekme: öndeki ana pencerenin yanına; ana pencere yoksa yeni pencere.
function newTab() {
  const front = BrowserWindow.getFocusedWindow();
  const host = mainWindows.has(front) ? front : [...mainWindows].pop();
  createWindow({ tabOf: host || null });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { label: 'Dosya', submenu: [{ label: 'Yeni Sekme', accelerator: 'CmdOrCtrl+T', click: newTab }, { type: 'separator' }, { role: 'close' }] },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    {
      role: 'window',
      label: 'Pencere',
      submenu: [
        { role: 'minimize' }, { role: 'zoom' }, { type: 'separator' },
        { role: 'selectPreviousTab', accelerator: 'Cmd+Shift+[' }, { role: 'selectNextTab', accelerator: 'Cmd+Shift+]' },
        { role: 'moveTabToNewWindow' }, { role: 'mergeAllWindows' }, { type: 'separator' }, { role: 'front' },
      ],
    },
  ]));
  createWindow();
  app.on('new-window-for-tab', newTab); // sekme çubuğundaki "+"
  app.on('activate', () => {
    if (mainWindows.size === 0) createWindow();
  });
});

// ⌘Q: önce tüm sekmelere sorulur; yüklenmemiş düzenleme için "Vazgeç" denirse sekmelerin hiçbiri kapanmaz.
let quitting = false;
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  confirmQuit().then((ok) => {
    if (!ok) return;
    quitting = true;
    app.quit();
  });
});

app.on('window-all-closed', () => app.quit());

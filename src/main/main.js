const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const { t } = require('../i18n');
const prefs = require('./prefs');
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
    vibrancy: 'under-window', // Liquid Glass: pencerenin arkası sistemin bulanık malzemesi
    visualEffectState: 'followWindow',
    webPreferences,
  }));
  mainWindows.add(win);
  win.on('closed', () => mainWindows.delete(win));
  ipc.attach(win, { openTab: (id) => createWindow({ siteId: id, tabOf: win }) });
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

// Ayarlar öndeki sekmede açılır; anahtarlar tüm sekmelerde ortaktır.
function openSettings() {
  const front = BrowserWindow.getFocusedWindow();
  const host = mainWindows.has(front) ? front : [...mainWindows].pop();
  if (!host) return;
  host.focus();
  host.webContents.send('settings:open');
}

let ipc = null; // dil belli olduktan sonra yüklenir: modüllerdeki sabit metinler doğru dille kurulsun

app.whenReady().then(() => {
  prefs.load();
  // Paketlenmemiş (npm start) çalışmada Dock'ta Electron'un simgesi yerine bizimki görünsün.
  if (!app.isPackaged && app.dock) app.dock.setIcon(require('node:path').join(__dirname, '..', '..', 'build', 'icon.png'));
  ipc = require('./ipc');
  ipcMain.on('lang:get', (event) => { event.returnValue = prefs.state(); });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about', label: t('MRC FTP Hakkında') }, { type: 'separator' },
        { label: t('Ayarlar…'), accelerator: 'Cmd+,', click: openSettings }, { type: 'separator' },
        { role: 'services', label: t('Servisler') }, { type: 'separator' },
        { role: 'hide', label: t('MRC FTP\'yi Gizle') }, { role: 'hideOthers', label: t('Diğerlerini Gizle') }, { role: 'unhide', label: t('Tümünü Göster') }, { type: 'separator' },
        { role: 'quit', label: t('MRC FTP\'den Çık') },
      ],
    },
    { label: t('Dosya'), submenu: [{ label: t('Yeni Sekme'), accelerator: 'CmdOrCtrl+T', click: newTab }, { type: 'separator' }, { role: 'close', label: t('Pencereyi Kapat') }] },
    // Hazır menülerin maddeleri yalnızca İngilizce geldiği için tek tek adlandırılır.
    {
      label: t('Düzen'),
      submenu: [
        { role: 'undo', label: t('Geri Al') }, { role: 'redo', label: t('Yinele') }, { type: 'separator' },
        { role: 'cut', label: t('Kes') }, { role: 'copy', label: t('Kopyala') }, { role: 'paste', label: t('Yapıştır') }, { role: 'selectAll', label: t('Tümünü Seç') },
      ],
    },
    {
      label: t('Görünüm'),
      submenu: [
        { role: 'resetZoom', label: t('Gerçek Boyut') }, { role: 'zoomIn', label: t('Yakınlaştır') }, { role: 'zoomOut', label: t('Uzaklaştır') }, { type: 'separator' },
        { role: 'togglefullscreen', label: t('Tam Ekran') }, { type: 'separator' },
        { role: 'toggleDevTools', label: t('Geliştirici Araçları') },
      ],
    },
    {
      role: 'window',
      label: t('Pencere'),
      submenu: [
        { role: 'minimize', label: t('Simge Durumuna Küçült') }, { role: 'zoom', label: t('Büyüt/Küçült') }, { type: 'separator' },
        // Bu rollerin hazır adı boş geliyor; ad elle verilir.
        { role: 'selectPreviousTab', label: t('Önceki Sekme'), accelerator: 'Cmd+Shift+[' }, { role: 'selectNextTab', label: t('Sonraki Sekme'), accelerator: 'Cmd+Shift+]' },
        { role: 'moveTabToNewWindow', label: t('Sekmeyi Yeni Pencereye Taşı') }, { role: 'mergeAllWindows', label: t('Tüm Pencereleri Birleştir') }, { type: 'separator' }, { role: 'front', label: t('Tümünü Öne Getir') },
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
  if (quitting || !ipc) return;
  event.preventDefault();
  ipc.confirmQuit().then((ok) => {
    if (!ok) return;
    quitting = true;
    app.quit();
  });
});

app.on('window-all-closed', () => app.quit());

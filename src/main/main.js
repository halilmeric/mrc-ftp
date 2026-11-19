const { app, BrowserWindow } = require('electron');
const { registerIpc } = require('./ipc');
const { webPreferences, page, lock } = require('./window');

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 900,
    minHeight: 520,
    titleBarStyle: 'hiddenInset',
    webPreferences,
  });
  lock(win);
  registerIpc(win);
  win.loadFile(page('index.html'));
  return win;
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());

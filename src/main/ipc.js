const path = require('node:path');
const { app, ipcMain, safeStorage } = require('electron');
const { createSiteStore } = require('./sites');
const { openSession, FtpError } = require('./ftp');
const { createQueue } = require('./transfers');
const localfs = require('./localfs');

// Arayüzün ana sürece açılan tek kapısı. Hatalar { code, message, cert } olarak taşınır; şifre hiçbir yanıtta yer almaz.
function registerIpc(win) {
  const store = createSiteStore({
    file: path.join(app.getPath('userData'), 'sites.json'),
    encrypt: (text) => (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text).toString('base64') : null),
    decrypt: (blob) => safeStorage.decryptString(Buffer.from(blob, 'base64')),
  });
  let active = null; // { siteId, session, queue }

  const disconnect = () => {
    if (!active) return;
    active.queue.close();
    active.session.close();
    active = null;
  };
  const need = () => {
    if (!active) throw new FtpError('NET', 'Önce bir siteye bağlan.');
    return active;
  };

  const handlers = {
    'sites:list': () => store.list(),
    'sites:save': (input) => store.save(input),
    'sites:remove': (id) => {
      if (active && active.siteId === id) disconnect();
      store.remove(id);
    },
    'connect': async (siteId, password) => {
      const site = store.get(siteId);
      if (!site) throw new FtpError('NET', 'Site bulunamadı.');
      const pass = password || site.password;
      if (!pass) throw new FtpError('NEED_PASSWORD', 'Şifre gerekli.');
      const cfg = { host: site.host, port: site.port, user: site.user, password: pass, secure: site.secure, fingerprint: site.fingerprint };
      const session = await openSession(cfg);
      disconnect();
      const queue = createQueue({
        openSession: () => openSession(cfg),
        onChange: (jobs) => { if (!win.isDestroyed()) win.webContents.send('transfers:change', jobs); },
      });
      active = { siteId, session, queue };
      return { startDir: site.startDir };
    },
    'trust': (siteId, fingerprint) => store.trust(siteId, fingerprint),
    'disconnect': () => disconnect(),
    'remote:list': (p) => need().session.list(p),
    'remote:mkdir': (p) => need().session.mkdir(p),
    'remote:rename': (from, to) => need().session.rename(from, to),
    'remote:remove': (p, isDir) => need().session.remove(p, isDir),
    'local:home': () => localfs.home(),
    'local:list': (p) => localfs.list(p),
    'transfers:add': (job) => need().queue.add(job),
    'transfers:cancel': (id) => need().queue.cancel(id),
    'transfers:retry': (id) => need().queue.retry(id),
    'transfers:answer': (id, choice, applyAll) => need().queue.answer(id, choice, applyAll),
    'transfers:clearFinished': () => need().queue.clearFinished(),
  };

  for (const [channel, fn] of Object.entries(handlers)) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return { ok: true, value: await fn(...args) };
      } catch (err) {
        const known = err instanceof FtpError;
        return { ok: false, error: { code: known ? err.code : 'NET', message: known ? err.message : 'Beklenmeyen bir hata oluştu.', cert: err.cert } };
      }
    });
  }
  win.on('closed', disconnect);
}

module.exports = { registerIpc };

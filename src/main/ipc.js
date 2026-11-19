const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require('electron');
const { createSiteStore } = require('./sites');
const { openSession, FtpError } = require('./ftp');
const { openSftpSession, connectSsh } = require('./sftp');
const { createTerminal } = require('./terminal');
const { webPreferences, page, lock } = require('./window');
const { createQueue } = require('./transfers');
const localfs = require('./localfs');
const { createEdits } = require('./edits');

const MAX_PREVIEW = 50 * 1024 * 1024;

// Arayüzün ana sürece açılan tek kapısı. Hatalar { code, message, cert } olarak taşınır; şifre hiçbir yanıtta yer almaz.
function registerIpc(win) {
  const store = createSiteStore({
    file: path.join(app.getPath('userData'), 'sites.json'),
    encrypt: (text) => (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text).toString('base64') : null),
    decrypt: (blob) => safeStorage.decryptString(Buffer.from(blob, 'base64')),
  });
  let active = null; // { siteId, session, queue, edits }
  // Düzenleme ve önizleme kopyaları burada durur; bağlantı kesilince ve açılışta silinir.
  const tmp = path.join(app.getPath('temp'), 'mrc-ftp');
  fs.rmSync(tmp, { recursive: true, force: true });
  const send = (channel, value) => { if (!win.isDestroyed()) win.webContents.send(channel, value); };

  // Terminal alttaki panelden ayrılınca bu pencerede görünür; oturum aynı kalır.
  let termWin = null;
  const sendTerm = (channel, value) => {
    send(channel, value);
    if (termWin && !termWin.isDestroyed()) termWin.webContents.send(channel, value);
  };
  const detachTerm = () => {
    if (termWin) { termWin.focus(); return; }
    termWin = lock(new BrowserWindow({ width: 760, height: 460, minWidth: 380, minHeight: 200, backgroundColor: '#14171e', titleBarStyle: 'hiddenInset', webPreferences }));
    termWin.loadFile(page('terminal.html'));
    termWin.on('closed', () => { termWin = null; send('term:docked', true); });
    send('term:docked', false);
  };
  const termOf = () => {
    const a = need();
    if (!a.term) throw new FtpError('LOCAL', 'Terminal yalnızca SFTP sitelerinde kullanılabilir.');
    return a.term;
  };

  const disconnect = () => {
    if (!active) return;
    if (active.term) active.term.close();
    if (termWin) termWin.close();
    active.edits.stopAll();
    active.queue.close();
    active.session.close();
    active = null;
    fs.rmSync(tmp, { recursive: true, force: true });
  };
  // Düzenlenip sunucuya gitmemiş dosya varken bağlantı kesilirse geçici kopyalarla birlikte kaybolur:
  // önce sıradaki yüklemeler beklenir, yine de kalan varsa kullanıcıya sorulur. true = devam edilebilir.
  async function confirmLeave() {
    if (!active) return true;
    active.edits.flush();
    const left = await active.queue.drainEdits(15000);
    if (left === 0) return true;
    const res = await dialog.showMessageBox(win, {
      type: 'warning',
      message: 'Yüklenmemiş düzenlemeler var',
      detail: `${left} dosyadaki son değişiklik sunucuya gitmedi. Devam edersen bu değişiklikler kaybolur.`,
      buttons: ['Vazgeç', 'Yine de devam et'],
      defaultId: 0,
      cancelId: 0,
    });
    return res.response === 1;
  }
  const leaveOrThrow = async () => {
    if (!(await confirmLeave())) throw new FtpError('CANCELLED', '');
  };

  const need = () => {
    if (!active) throw new FtpError('NET', 'Önce bir siteye bağlan.');
    return active;
  };

  const handlers = {
    'sites:list': () => store.list(),
    'sites:save': (input) => store.save(input),
    'sites:remove': async (id) => {
      if (active && active.siteId === id) { await leaveOrThrow(); disconnect(); }
      store.remove(id);
    },
    'connect': async (siteId, password) => {
      await leaveOrThrow();
      const site = store.get(siteId);
      if (!site) throw new FtpError('NET', 'Site bulunamadı.');
      const pass = password || site.password;
      const sftp = site.protocol === 'sftp';
      const byKey = sftp && site.auth === 'key';
      if (!pass && !byKey) throw new FtpError('NEED_PASSWORD', 'Şifre gerekli.'); // parolasız anahtar şifre istemez
      const cfg = { host: site.host, port: site.port, user: site.user, fingerprint: site.fingerprint,
        ...(byKey ? { keyPath: site.keyPath, passphrase: pass } : { password: pass }), secure: site.secure };
      const open = sftp ? openSftpSession : openSession;
      const session = await open(cfg);
      disconnect();
      let edits = null;
      const queue = createQueue({
        openSession: () => open(cfg),
        onChange: (jobs) => send('transfers:change', jobs),
        onUploaded: (remotePath, baseline) => edits.updateBaseline(remotePath, baseline),
      });
      edits = createEdits({
        dir: path.join(tmp, 'edit'),
        getSession: async () => session,
        enqueue: (spec) => queue.add(spec),
        open: async (file) => {
          if (await shell.openPath(file)) throw new FtpError('LOCAL', 'Bu dosyayı açacak bir uygulama bulunamadı.');
        },
        onChange: (count) => send('edits:change', count),
      });
      const term = sftp ? createTerminal({
        connect: () => connectSsh(cfg),
        onData: (data) => sendTerm('term:data', data),
        onState: (state) => sendTerm('term:state', state),
      }) : null;
      active = { siteId, session, queue, edits, term, cwd: '/' };
      return { startDir: site.startDir, terminal: sftp };
    },
    'trust': (siteId, fingerprint) => store.trust(siteId, fingerprint),
    'disconnect': async () => { await leaveOrThrow(); disconnect(); },
    'remote:list': (p) => need().session.list(p),
    'remote:mkdir': (p) => need().session.mkdir(p),
    'remote:rename': (from, to) => need().session.rename(from, to),
    'remote:remove': (p, isDir) => need().session.remove(p, isDir),
    'remote:chmod': (p, mode) => {
      if (!Number.isInteger(mode) || mode < 0 || mode > 0o777) throw new FtpError('LOCAL', 'Geçersiz izin.');
      return need().session.chmod(p, mode);
    },
    'local:home': () => localfs.home(),
    'local:list': (p) => localfs.list(p),
    'local:downloads': () => ({ path: app.getPath('downloads') }),
    'local:pickDir': async () => {
      const res = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], buttonLabel: 'Buraya indir' });
      return res.canceled ? null : { path: res.filePaths[0] };
    },
    'local:pickKey': async () => {
      const res = await dialog.showOpenDialog(win, {
        defaultPath: path.join(os.homedir(), '.ssh'), properties: ['openFile', 'showHiddenFiles'],
        buttonLabel: 'Anahtarı seç', message: 'SSH özel anahtar dosyasını seç (.pub olmayan)',
      });
      return res.canceled ? null : { path: res.filePaths[0] };
    },
    'edit:open': (remotePath, entry) => need().edits.start(String(remotePath), { size: Number(entry.size), modified: entry.modified }),
    'edit:stopAll': () => need().edits.stopAll(),
    'preview:local': (file) => { win.previewFile(String(file)); },
    'preview:remote': async (remotePath, size) => {
      const name = path.posix.basename(String(remotePath));
      if (String(remotePath).split('/').includes('..') || !name || /[\\/]/.test(name)) throw new FtpError('LOCAL', 'Bu dosya önizlenemiyor.');
      if (Number(size) > MAX_PREVIEW) throw new FtpError('LOCAL', 'Önizlemek için çok büyük.');
      const file = path.join(tmp, 'preview', name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      await need().session.fetch(String(remotePath), file);
      win.previewFile(file);
    },
    'term:start': ({ cols, rows, cwd }) => {
      const term = termOf();
      if (cwd) active.cwd = String(cwd); // ayrılan pencere klasörü bilmez: son bilinen kullanılır
      return term.start({ cols: Number(cols) || 80, rows: Number(rows) || 24, cwd: active.cwd });
    },
    'term:resize': (cols, rows) => { if (active && active.term) active.term.resize(Number(cols), Number(rows)); },
    'term:snapshot': () => termOf().snapshot(),
    'term:detach': () => { termOf(); detachTerm(); },
    'term:dock': () => { if (termWin) termWin.close(); },
    'transfers:add': (job) => need().queue.add(job),
    'transfers:cancel': (id) => need().queue.cancel(id),
    'transfers:retry': (id) => need().queue.retry(id),
    'transfers:answer': (id, choice, applyAll) => need().queue.answer(id, choice, applyAll),
    'transfers:clearFinished': () => need().queue.clearFinished(),
    'transfers:dismiss': (id) => need().queue.dismiss(id),
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
  ipcMain.removeAllListeners('term:input');
  ipcMain.on('term:input', (_event, data) => { if (active && active.term) active.term.write(String(data)); });
  // Pencere kapanırken de aynı soru: yüklenmemiş düzenleme yoksa hemen kapanır.
  let leaving = false;
  win.on('close', (event) => {
    if (leaving || !active) return;
    event.preventDefault();
    confirmLeave().then((ok) => {
      if (!ok) return;
      leaving = true;
      win.close();
    });
  });
  win.on('closed', disconnect);
}

module.exports = { registerIpc };

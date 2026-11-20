const fs = require('node:fs');
const { t } = require('../i18n');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Client, utils } = require('ssh2');
const { FtpError, sanitizeEntries, sortEntries } = require('./ftp');

const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;
const kind = (attrs) => attrs.mode & S_IFMT;

// `ssh-keygen -lf` ile aynı biçim; kullanıcı hosting panelindeki değerle karşılaştırabilir.
const fingerprintOf = (key) => 'SHA256:' + crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/, '');

// Anahtar bağlanmadan önce burada çözülür: eksik ya da yanlış parola sunucuya hiç gitmeden anlaşılır.
function loadKey({ keyPath, passphrase }) {
  if (!keyPath) return {};
  let data;
  try {
    data = fs.readFileSync(keyPath);
  } catch {
    throw new FtpError('LOCAL', t('Anahtar dosyası okunamadı: ') + keyPath);
  }
  let parsed = utils.parseKey(data, passphrase || undefined);
  if (parsed instanceof Error && passphrase && !(utils.parseKey(data) instanceof Error)) {
    parsed = null; // anahtar parolasız, verilen parola gereksiz
    passphrase = null;
  }
  if (parsed instanceof Error) {
    if (/no passphrase given/i.test(parsed.message)) throw new FtpError('NEED_PASSWORD', t('Anahtar parolası gerekli.'));
    if (passphrase && /passphrase|decrypt|integrity/i.test(parsed.message)) throw new FtpError('AUTH', t('Anahtar parolası yanlış.'));
    throw new FtpError('LOCAL', t('Bu dosya bir SSH özel anahtarı değil ya da biçimi desteklenmiyor.'));
  }
  return { privateKey: data, passphrase: passphrase || undefined };
}

// Sıra önemli: sunucu anahtarı kayıtlı parmak iziyle eşleşmeden kimlik doğrulamaya geçilmez,
// yani şifre de anahtar imzası da tanınmayan bir sunucuya gitmez.
async function connectSsh(cfg) {
  const { privateKey, passphrase } = loadKey(cfg);
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let seen = null;
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      conn.destroy();
      if (seen && seen !== cfg.fingerprint) {
        reject(new FtpError('CERT', cfg.fingerprint ? t('Sunucunun anahtarı değişmiş.') : t('Sunucunun kimliği henüz onaylanmadı.'), {
          cert: { reason: cfg.fingerprint ? 'ssh-changed' : 'ssh-new', fingerprint: seen, subject: '', issuer: '', validTo: '' },
        }));
      } else if (err && err.level === 'client-authentication') {
        reject(new FtpError('AUTH', privateKey ? t('Sunucu bu anahtarı kabul etmedi.') : t('Kullanıcı adı ya da şifre yanlış.')));
      } else {
        reject(new FtpError('NET', t('Sunucuya ulaşılamadı. Adresi, portu ve interneti kontrol et.')));
      }
    };
    conn.on('error', fail); // bağlandıktan sonra da dinler: sahipsiz hata olayı uygulamayı düşürmesin
    conn.once('close', () => fail());
    conn.once('ready', () => { settled = true; resolve(conn); });
    // Bazı sunucular şifreyi yalnızca "keyboard-interactive" ile kabul eder.
    conn.on('keyboard-interactive', (name, instructions, lang, prompts, finish) => finish(prompts.map(() => cfg.password || '')));
    try {
      conn.connect({
        host: cfg.host, port: cfg.port, username: cfg.user,
        password: privateKey ? undefined : cfg.password || undefined,
        privateKey, passphrase,
        tryKeyboard: !privateKey,
        readyTimeout: 15000, keepaliveInterval: 30000,
        hostVerifier: (key) => { seen = fingerprintOf(key); return seen === cfg.fingerprint; },
      });
    } catch {
      fail();
    }
  });
}

const STATUS_TEXT = { 2: t('Dosya ya da klasör bulunamadı.'), 3: t('Bu işlem için iznin yok.') };
const isStatus = (err) => err && typeof err.code === 'number';
const isLocal = (err) => err && err.syscall && err.path;
function mapError(err) {
  if (err instanceof FtpError) return err;
  if (isStatus(err)) return new FtpError('FTP', STATUS_TEXT[err.code] || t('Sunucu işlemi reddetti.'));
  if (isLocal(err)) return new FtpError('LOCAL', t('Mac\'teki dosya okunamadı ya da yazılamadı.'));
  return new FtpError('NET', t('Sunucuyla bağlantı koptu.'));
}

const call = (sftp, method, ...args) => new Promise((resolve, reject) => {
  sftp[method](...args, (err, value) => (err ? reject(err) : resolve(value)));
});

// Bağları izlemez: klasöre giden bir bağ silinirken hedefin içine girilmez.
async function removeTree(sftp, target) {
  if (kind(await call(sftp, 'lstat', target)) !== S_IFDIR) return call(sftp, 'unlink', target);
  for (const row of await call(sftp, 'readdir', target)) {
    if (row.filename !== '.' && row.filename !== '..') await removeTree(sftp, path.posix.join(target, row.filename));
  }
  return call(sftp, 'rmdir', target);
}

// ponytail: aktarım sıralı akışla yapılır (istek başına bir parça). Yarım dosyada boşluk kalmadığı için
// sürdürme güvenlidir, ama gecikmesi yüksek hatlarda yavaştır; hız gerekirse sıralı ama boru hatlı okuma/yazma.
async function copyDown(sftp, remote, local, offset, onProgress, signal, limiter) {
  const src = sftp.createReadStream(remote, { start: offset });
  let bytes = 0;
  if (onProgress) src.on('data', (chunk) => { bytes += chunk.length; onProgress(bytes); });
  const dst = fs.createWriteStream(local, offset ? { flags: 'r+', start: offset } : {});
  await pipeline(...(limiter ? [src, limiter.stream(), dst] : [src, dst]), { signal });
}
async function copyUp(sftp, local, remote, offset, onProgress, signal, limiter) {
  const src = fs.createReadStream(local, { start: offset });
  let bytes = 0;
  if (onProgress) src.on('data', (chunk) => { bytes += chunk.length; onProgress(bytes); });
  const dst = sftp.createWriteStream(remote, offset ? { flags: 'r+', start: offset } : {});
  await pipeline(...(limiter ? [src, limiter.stream(), dst] : [src, dst]), { signal });
}

// ftp.js'teki oturumla aynı arayüz; kuyruk, düzenleme ve önizleme ikisini ayırt etmez.
async function openSftpSession(cfg) {
  let conn = null;
  let sftp = null;
  let chain = Promise.resolve();
  let dead = false; // close() sonrası: süren işlem yeniden bağlanıp devam etmesin
  // ssh2 bağlantı kapanınca süren akışı her zaman hatayla bitirmez; aktarım askıda kalmasın diye biz keseriz.
  const live = new Set();
  const stopLive = () => { for (const ctl of live) ctl.abort(); };
  const streaming = async (fn) => {
    const ctl = new AbortController();
    live.add(ctl);
    try {
      return await fn(ctl.signal);
    } finally {
      live.delete(ctl);
    }
  };

  const dial = async () => {
    if (dead) throw new FtpError('NET', t('Bağlantı kapatıldı.'));
    const c = await connectSsh(cfg);
    if (dead) { c.destroy(); throw new FtpError('NET', t('Bağlantı kapatıldı.')); }
    c.once('close', () => { if (conn === c) { sftp = null; stopLive(); } });
    conn = c;
    try {
      sftp = await new Promise((resolve, reject) => c.sftp((err, s) => (err ? reject(err) : resolve(s))));
    } catch {
      c.destroy();
      throw new FtpError('NET', t('Sunucu SFTP\'yi desteklemiyor ya da bu hesaba kapalı.'));
    }
  };
  await dial();

  const queue = (fn) => {
    const next = chain.then(async () => {
      if (!sftp) await dial();
      return fn(sftp);
    });
    chain = next.catch(() => {});
    return next;
  };
  // Bağlantı koptuysa bir kez yeniden bağlanıp dener; sunucunun reddettiği işlem yinelenmez.
  const run = (fn) => queue(async (s) => {
    try {
      return await fn(s);
    } catch (err) {
      await new Promise(setImmediate); // kapanma olayı hatadan sonra gelebilir
      if (sftp || isStatus(err) || isLocal(err) || err instanceof FtpError) throw mapError(err);
      await dial();
      try {
        return await fn(sftp);
      } catch (again) {
        throw mapError(again);
      }
    }
  });
  const hangUp = () => {
    const c = conn;
    sftp = null;
    stopLive();
    if (c) c.destroy();
  };

  return {
    list: (dir) => run(async (s) => {
      const rows = sanitizeEntries((await call(s, 'readdir', dir)).map((r) => ({ name: r.filename, attrs: r.attrs })));
      const out = [];
      for (const row of rows) {
        let { attrs } = row;
        const link = kind(attrs) === S_IFLNK;
        if (link) {
          try {
            attrs = await call(s, 'stat', path.posix.join(dir, row.name));
          } catch {
            // kopuk bağ: dosya gibi gösterilir
          }
        }
        out.push({ name: row.name, size: attrs.size, isDir: kind(attrs) === S_IFDIR, modified: new Date(attrs.mtime * 1000).toISOString(), mode: attrs.mode & 0o777, ...(link && { link: true }) });
      }
      return sortEntries(out);
    }),
    mkdir: (dir) => run((s) => call(s, 'mkdir', dir)),
    // OpenSSH'nin posix-rename uzantısı var olan hedefin üzerine tek adımda taşır; yoksa düz taşıma.
    rename: (from, to) => run((s) => new Promise((resolve, reject) => {
      const done = (err) => (err ? reject(err) : resolve());
      try {
        s.ext_openssh_rename(from, to, done);
      } catch {
        s.rename(from, to, done);
      }
    })),
    chmod: (target, mode) => run((s) => call(s, 'chmod', target, mode & 0o777)),
    // Dosya diye silinmesi istenen şey klasör çıkarsa içi silinmez (FTP'deki DELE gibi reddedilir).
    remove: (target, isDir) => run((s) => (isDir === false ? call(s, 'unlink', target) : removeTree(s, target))),
    fetch: (remote, local) => run((s) => streaming((signal) => copyDown(s, remote, local, 0, null, signal))),
    download: (remote, local, { offset = 0, onProgress } = {}) => queue((s) => streaming((signal) => copyDown(s, remote, local, offset, onProgress, signal, cfg.limiter))),
    upload: (local, remote, { offset = 0, onProgress } = {}) => queue((s) => streaming((signal) => copyUp(s, local, remote, offset, onProgress, signal, cfg.limiter))),
    size: (target) => run((s) => call(s, 'stat', target)).then((attrs) => attrs.size, () => null),
    abort: hangUp,
    close: () => { dead = true; hangUp(); },
    get closed() { return !sftp; },
  };
}

module.exports = { openSftpSession, connectSsh, fingerprintOf };

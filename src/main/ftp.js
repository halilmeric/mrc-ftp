const net = require('node:net');
const { Client, FTPError } = require('basic-ftp');

class FtpError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

const CERT_REASONS = {
  DEPTH_ZERO_SELF_SIGNED_CERT: 'self-signed',
  SELF_SIGNED_CERT_IN_CHAIN: 'self-signed',
  ERR_TLS_CERT_ALTNAME_INVALID: 'mismatch',
  CERT_HAS_EXPIRED: 'expired',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'untrusted',
  UNABLE_TO_GET_ISSUER_CERT: 'untrusted',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'untrusted',
  CERT_UNTRUSTED: 'untrusted',
};

function mapError(err) {
  if (err instanceof FtpError) return err;
  if (err instanceof FTPError) {
    if (err.code === 530 || err.code === 430) return new FtpError('AUTH', 'Kullanıcı adı ya da şifre yanlış.');
    return new FtpError('FTP', 'Sunucu işlemi reddetti: ' + String(err.message).replace(/^\d+[ -]/, ''));
  }
  return new FtpError('NET', 'Sunucuya ulaşılamadı. Adresi ve interneti kontrol et.');
}

// Sunucudan gelen adlar güvenilmez: yol ayırıcı ya da "." / ".." içeren girdi hedef klasörün dışına yazdırabilir.
function sanitizeEntries(entries) {
  return entries.filter((e) => e.name && e.name !== '.' && e.name !== '..' && !/[\\/]/.test(e.name));
}

const certInfo = (cert, reason) => ({
  reason,
  subject: (cert.subject && cert.subject.CN) || '',
  issuer: (cert.issuer && (cert.issuer.O || cert.issuer.CN)) || '',
  validTo: cert.valid_to || '',
  fingerprint: cert.fingerprint256 || '',
});

// rejectUnauthorized kapalıyken Node veri bağlantısının sertifikasına bakmaz; aynı parmak izini orada da ararız.
function pinDataSockets(client, fingerprint) {
  let inner = client.prepareTransfer;
  const guarded = async (ftp) => {
    const res = await inner(ftp);
    const sock = ftp.dataSocket;
    if (sock && typeof sock.getPeerCertificate === 'function') {
      const check = () => {
        if ((sock.getPeerCertificate() || {}).fingerprint256 !== fingerprint) {
          sock.destroy(new Error('Veri bağlantısının sertifikası tanınmıyor.'));
        }
      };
      sock.once('secureConnect', check);
    }
    return res;
  };
  // basic-ftp çalışan stratejiyi bulunca prepareTransfer'ı yeniden atar; korumayı düşürmesin.
  Object.defineProperty(client, 'prepareTransfer', { configurable: true, get: () => guarded, set: (fn) => { if (fn !== guarded) inner = fn; } });
}

async function probeCertificate(host, port) {
  const probe = new Client(15000);
  try {
    await probe.connect(host, port);
    await probe.useTLS({ rejectUnauthorized: false });
    return probe.ftp.socket.getPeerCertificate();
  } finally {
    probe.close();
  }
}

// Sıra önemli: şifre ancak sertifika doğrulandıktan ya da kayıtlı parmak iziyle eşleştikten sonra gider.
async function dial({ host, port, user, password, secure, fingerprint }) {
  const client = new Client(15000);
  try {
    await client.connect(host, port);
    if (secure) {
      const servername = net.isIP(host) ? undefined : host;
      if (fingerprint) {
        await client.useTLS({ rejectUnauthorized: false, servername });
        const cert = client.ftp.socket.getPeerCertificate();
        if (cert.fingerprint256 !== fingerprint) {
          throw new FtpError('CERT', 'Sunucunun sertifikası değişmiş.', { cert: certInfo(cert, 'changed') });
        }
        pinDataSockets(client, fingerprint);
      } else {
        try {
          await client.useTLS({ servername });
        } catch (err) {
          const reason = CERT_REASONS[err.code] || (/CERT/.test(String(err.code)) ? 'untrusted' : null);
          if (!reason) {
            if (err instanceof FTPError) throw new FtpError('NET', 'Sunucu şifreli bağlantıyı desteklemiyor.');
            throw err;
          }
          client.close();
          const cert = await probeCertificate(host, port);
          throw new FtpError('CERT', 'Sunucunun kimliği doğrulanamadı.', { cert: certInfo(cert, reason) });
        }
      }
    }
    await client.login(user, password);
    await client.useDefaultSettings();
    return client;
  } catch (err) {
    client.close();
    throw mapError(err);
  }
}

// LIST biçimi yakın tarihli dosyalarda yılı yazmaz ("Nov 19 12:34"); yıl eksikse bu yıl, o da gelecekteyse geçen yıl.
function parseListDate(raw, now = new Date()) {
  if (!/^[A-Za-z]{3}\s+\d{1,2}\s+(\d{1,2}:\d{2}|\d{4})$/.test(String(raw || '').trim())) return null;
  const hasYear = /\b(19|20)\d\d\b/.test(raw);
  const d = new Date(hasYear ? raw : `${raw} ${now.getFullYear()}`);
  if (Number.isNaN(d.getTime())) return null;
  if (!hasYear && d.getTime() - now.getTime() > 86400000) d.setFullYear(d.getFullYear() - 1);
  return d.toISOString();
}

const toIso = (info) => (info.modifiedAt ? info.modifiedAt.toISOString() : parseListDate(info.rawModifiedAt));

// basic-ftp izinleri {user, group, world} olarak verir; tek sayıya (ör. 0o644) çevrilir.
const toMode = (p) => (p ? (p.user << 6) | (p.group << 3) | p.world : null);

const sortEntries = (list) => list.sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name, 'tr'));

async function openSession(cfg) {
  let client = await dial(cfg);
  let chain = Promise.resolve();

  // basic-ftp aynı anda tek komut taşır: işlemler sıraya girer. Bağlantı koptuysa bir kez yeniden bağlanıp dener.
  const run = (fn) => {
    const next = chain.then(async () => {
      if (client.closed) client = await dial(cfg);
      try {
        return await fn(client);
      } catch (err) {
        if (!client.closed) throw mapError(err);
        client = await dial(cfg);
        try {
          return await fn(client);
        } catch (again) {
          throw mapError(again);
        }
      }
    });
    chain = next.catch(() => {});
    return next;
  };

  return {
    run,
    get client() { return client; },
    list: (path) => run(async (c) => sortEntries(sanitizeEntries(await c.list(path)).map((f) => ({
      name: f.name, size: f.size, isDir: f.isDirectory, modified: toIso(f), mode: toMode(f.permissions),
    })))),
    mkdir: (path) => run((c) => c.send('MKD ' + path)),
    rename: (from, to) => run((c) => c.rename(from, to)),
    chmod: (path, mode) => run((c) => c.send(`SITE CHMOD ${(mode & 0o777).toString(8).padStart(3, '0')} ${path}`)),
    remove: (path, isDir) => run((c) => (isDir ? c.removeDir(path) : c.remove(path))),
    close: () => client.close(),
  };
}

module.exports = { openSession, FtpError, sanitizeEntries, pinDataSockets, sortEntries, parseListDate };

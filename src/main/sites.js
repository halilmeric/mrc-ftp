const fs = require('node:fs');
const crypto = require('node:crypto');

// Site listesi tek bir JSON dosyasında durur; şifre yalnızca encrypt() çıktısı olarak yazılır.
function createSiteStore({ file, encrypt, decrypt }) {
  const read = () => {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  };
  const write = (rows) => {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(rows, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  };
  // Sürüm 3 öncesi kayıtlarda protokol alanı yoktur: FTP sayılır.
  const pub = ({ secret, ...row }) => ({ protocol: 'ftp', auth: 'password', keyPath: null, ...row, hasPassword: Boolean(secret) });

  return {
    list: () => read().map(pub),
    get(id) {
      const row = read().find((r) => r.id === id);
      if (!row) return null;
      // Keychain anahtarı değişmişse (ör. yedekten dönüş) şifre çözülemez; site şifresiz sayılır ve şifre sorulur.
      let password = null;
      try {
        if (row.secret) password = decrypt(row.secret);
      } catch {
        password = null;
      }
      return { ...pub(row), password };
    },
    save(input) {
      const rows = read();
      const old = rows.find((r) => r.id === input.id);
      const protocol = input.protocol === 'sftp' ? 'sftp' : 'ftp';
      const auth = protocol === 'sftp' && input.auth === 'key' ? 'key' : 'password';
      const row = {
        id: old ? old.id : crypto.randomUUID(),
        name: String(input.name || input.host).trim(),
        host: String(input.host).trim(),
        port: Number(input.port) || (protocol === 'sftp' ? 22 : 21),
        user: String(input.user).trim(),
        protocol,
        auth,
        keyPath: auth === 'key' ? String(input.keyPath || '') : null, // anahtarın yalnızca yolu saklanır
        secure: protocol === 'sftp' || input.secure !== false,
        startDir: input.startDir || '/',
        fingerprint: old ? old.fingerprint : null,
        secret: old ? old.secret : null,
      };
      // Sunucu değiştiyse eski güven kararı geçersizdir.
      if (old && (old.host !== row.host || old.port !== row.port || (old.protocol || 'ftp') !== protocol)) row.fingerprint = null;
      // Saklanan sır giriş türüne aittir (şifre ya da anahtar parolası); tür değiştiyse eskisi geçersizdir.
      if (old && (old.auth || 'password') !== auth) row.secret = null;
      if (input.password) row.secret = encrypt(input.password);
      write(old ? rows.map((r) => (r.id === row.id ? row : r)) : [...rows, row]);
      return pub(row);
    },
    remove(id) {
      write(read().filter((r) => r.id !== id));
    },
    trust(id, fingerprint) {
      write(read().map((r) => (r.id === id ? { ...r, fingerprint } : r)));
    },
  };
}

module.exports = { createSiteStore };

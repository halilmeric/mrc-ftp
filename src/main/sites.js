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
  const pub = ({ secret, ...row }) => ({ ...row, hasPassword: Boolean(secret) });

  return {
    list: () => read().map(pub),
    get(id) {
      const row = read().find((r) => r.id === id);
      if (!row) return null;
      return { ...pub(row), password: row.secret ? decrypt(row.secret) : null };
    },
    save(input) {
      const rows = read();
      const old = rows.find((r) => r.id === input.id);
      const row = {
        id: old ? old.id : crypto.randomUUID(),
        name: String(input.name || input.host).trim(),
        host: String(input.host).trim(),
        port: Number(input.port) || 21,
        user: String(input.user).trim(),
        secure: input.secure !== false,
        startDir: input.startDir || '/',
        fingerprint: old ? old.fingerprint : null,
        secret: old ? old.secret : null,
      };
      // Sunucu değiştiyse eski güven kararı geçersizdir.
      if (old && (old.host !== row.host || old.port !== row.port)) row.fingerprint = null;
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

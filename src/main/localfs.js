const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { FtpError, sortEntries } = require('./ftp');

// Mac panelinin listesi; biçim uzak listeyle aynıdır.
async function list(dir) {
  try {
    const names = (await fs.readdir(dir)).filter((n) => !n.startsWith('.'));
    const entries = await Promise.all(names.map(async (name) => {
      try {
        const st = await fs.stat(path.join(dir, name));
        return { name, size: st.isDirectory() ? 0 : st.size, isDir: st.isDirectory(), modified: st.mtime.toISOString() };
      } catch {
        return null; // kırık kısayol
      }
    }));
    return sortEntries(entries.filter(Boolean));
  } catch {
    throw new FtpError('LOCAL', 'Klasör açılamadı.');
  }
}

const home = () => ({ path: os.homedir() });

module.exports = { list, home };

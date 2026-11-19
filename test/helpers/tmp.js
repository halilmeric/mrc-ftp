// Testlerin geçici klasörleri: süreç biterken silinir (büyük test dosyaları diskte birikmesin).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const made = [];
process.on('exit', () => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
}

module.exports = { tmpDir };

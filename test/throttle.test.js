const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLimiter } = require('../src/main/throttle');
const { openSession } = require('../src/main/ftp');
const { openSftpSession } = require('../src/main/sftp');
const { startServer } = require('./helpers/server');
const { startSshServer } = require('./helpers/ssh-server');
const { tmpDir } = require('./helpers/tmp');

const SIZE = 300 * 1024;
const data = Buffer.alloc(SIZE, 7).map((_, i) => i % 251);
const tmp = () => tmpDir('mrc-limit-');

test('sınırlayıcı: sınır yokken beklemez, varken toplam hızı tutar', () => {
  const lim = createLimiter();
  assert.strictEqual(lim.delay(1e6), 0);
  lim.set(1000);
  assert.strictEqual(lim.delay(500), 0);
  const second = lim.delay(500);
  assert.ok(second > 400 && second <= 500, String(second));
  lim.set(0);
  assert.strictEqual(lim.delay(1e6), 0);
  lim.set(-5);
  assert.strictEqual(lim.rate, 0);
});

async function roundTrip(open, root) {
  const lim = createLimiter();
  lim.set(200 * 1024);
  const ses = await open(lim);
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'u.bin'), data);
  const t0 = Date.now();
  await ses.upload(path.join(dir, 'u.bin'), '/u.bin');
  const up = Date.now() - t0;
  assert.ok(fs.readFileSync(path.join(root, 'u.bin')).equals(data));
  assert.ok(up > 700, `yükleme ${up} ms sürdü, sınır uygulanmadı`);
  const t1 = Date.now();
  await ses.download('/u.bin', path.join(dir, 'd.bin'));
  assert.ok(Date.now() - t1 > 700, 'indirme sınırlanmadı');
  assert.ok(fs.readFileSync(path.join(dir, 'd.bin')).equals(data));
  // Yarıdan sürdürme sınırlıyken de doğru yere yazar.
  fs.writeFileSync(path.join(dir, 'r.bin'), data.subarray(0, 100000));
  lim.set(0);
  await ses.download('/u.bin', path.join(dir, 'r.bin'), { offset: 100000 });
  assert.ok(fs.readFileSync(path.join(dir, 'r.bin')).equals(data));
  await assert.rejects(ses.upload(path.join(dir, 'yok.bin'), '/y.bin'), (err) => Boolean(err.syscall && err.path));
  ses.close();
}

test('FTP aktarımı hız sınırına uyar', async () => {
  const s = await startServer({});
  try {
    await roundTrip((limiter) => openSession({ host: '127.0.0.1', port: s.port, user: s.user, password: s.password, secure: false, limiter }), s.root);
  } finally { await s.stop(); }
});

test('SFTP aktarımı hız sınırına uyar', async () => {
  const s = await startSshServer({});
  try {
    await roundTrip((limiter) => openSftpSession({ host: '127.0.0.1', port: s.port, user: s.user, password: s.password, fingerprint: s.fingerprint, limiter }), s.root);
  } finally { await s.stop(); }
});

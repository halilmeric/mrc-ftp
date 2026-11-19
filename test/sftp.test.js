const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openSftpSession } = require('../src/main/sftp');
const { createQueue } = require('../src/main/transfers');
const { startSshServer } = require('./helpers/ssh-server');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mrc-sftp-local-'));
const cfg = (s, extra = {}) => ({ host: '127.0.0.1', port: s.port, user: s.user, password: s.password, fingerprint: s.fingerprint, ...extra });
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('zaman aşımı: ' + fn);
    await new Promise((r) => setTimeout(r, 15));
  }
};
async function withServer(opts, fn) {
  const s = await startSshServer(opts);
  try { await fn(s, (p) => path.join(s.root, p)); } finally { await s.stop(); }
}
async function withQueue(opts, fn) {
  await withServer(opts, async (s, r) => {
    let hook = null;
    const seen = [];
    const q = createQueue({ openSession: () => openSftpSession(cfg(s)), onChange: (jobs) => { seen.push(jobs); if (hook) hook(jobs); } });
    const local = tmp();
    try {
      await fn({ s, q, r, seen, l: (p) => path.join(local, p), onChange: (h) => { hook = h; } });
    } finally {
      q.close();
    }
  });
}
const SIZE = 6 * 1024 * 1024;
const pattern = (seed) => { const b = Buffer.alloc(SIZE); for (let i = 0; i < SIZE; i++) b[i] = (i * 7 + seed) % 251; return b; };
const dropOnce = (onChange, s) => {
  let done = false;
  onChange((jobs) => { if (!done && jobs.some((j) => j.state === 'active' && j.bytes > 0)) { done = true; s.drop(); } });
};
const noParts = (dir) => assert.deepStrictEqual(fs.readdirSync(dir, { recursive: true }).filter((n) => String(n).endsWith('.mrcftp-part')), []);

test('SFTP: liste dosya, klasör, bağ, izin ve tarih verir', () => withServer({ files: { 'a.txt': 'merhaba', 'klasör/ic.txt': 'x', '.htaccess': 'y' } }, async (s, r) => {
  fs.chmodSync(r('a.txt'), 0o640);
  fs.symlinkSync(r('klasör'), r('www'));
  const ses = await openSftpSession(cfg(s));
  const list = await ses.list('/');
  assert.deepStrictEqual(list.map((e) => [e.name, e.isDir]), [['klasör', true], ['www', true], ['.htaccess', false], ['a.txt', false]]);
  const a = list.find((e) => e.name === 'a.txt');
  assert.strictEqual(a.size, 7);
  assert.strictEqual(a.mode, 0o640);
  assert.ok(Math.abs(new Date(a.modified).getTime() - Date.now()) < 60000);
  assert.strictEqual(list.find((e) => e.name === 'www').link, true);
  ses.close();
}));

test('SFTP: mkdir, rename, chmod, remove sunucuda gözlenir', () => withServer({ files: { 'a.txt': 'x', 'dolu/alt/ic.txt': 'y' } }, async (s, r) => {
  const ses = await openSftpSession(cfg(s));
  await ses.mkdir('/yeni klasör');
  assert.ok(fs.statSync(r('yeni klasör')).isDirectory());
  await assert.rejects(ses.mkdir('/yeni klasör'), { code: 'FTP' });
  await ses.rename('/a.txt', '/b.txt');
  await ses.chmod('/b.txt', 0o600);
  assert.strictEqual(fs.statSync(r('b.txt')).mode & 0o777, 0o600);
  await ses.remove('/b.txt', false);
  await ses.remove('/dolu', true);
  assert.deepStrictEqual(fs.readdirSync(s.root), ['yeni klasör']);
  ses.close();
}));

test('SFTP: klasöre giden bağı silmek hedefin içini silmez', () => withServer({ files: { 'public_html/index.html': 'x' } }, async (s, r) => {
  fs.symlinkSync(r('public_html'), r('www'));
  const ses = await openSftpSession(cfg(s));
  await ses.remove('/www', true);
  assert.ok(!fs.existsSync(r('www')));
  assert.ok(fs.existsSync(r('public_html/index.html')));
  ses.close();
}));

test('SFTP: tanınmayan sunucu anahtarı: CERT ssh-new, giriş denemesi yok', () => withServer({}, async (s) => {
  await assert.rejects(openSftpSession(cfg(s, { fingerprint: null })), (err) => {
    assert.strictEqual(err.code, 'CERT');
    assert.strictEqual(err.cert.reason, 'ssh-new');
    assert.strictEqual(err.cert.fingerprint, s.fingerprint);
    return true;
  });
  assert.strictEqual(s.auths, 0);
}));

test('SFTP: değişmiş sunucu anahtarı: CERT ssh-changed, giriş denemesi yok', () => withServer({}, async (s) => {
  await assert.rejects(openSftpSession(cfg(s, { fingerprint: 'SHA256:baska' })), (err) => err.code === 'CERT' && err.cert.reason === 'ssh-changed' && err.cert.fingerprint === s.fingerprint);
  assert.strictEqual(s.auths, 0);
}));

test('SFTP: yanlış şifre AUTH, kapalı port NET', () => withServer({}, async (s) => {
  await assert.rejects(openSftpSession(cfg(s, { password: 'yanlis' })), { code: 'AUTH' });
  await assert.rejects(openSftpSession(cfg(s, { port: 1 })), { code: 'NET' });
}));

test('SFTP: anahtarla giriş; parolalı anahtar parola ister', () => withServer({ files: { 'a.txt': 'x' } }, async (s) => {
  const key = await openSftpSession(cfg(s, { password: null, keyPath: s.clientKey }));
  assert.strictEqual((await key.list('/')).length, 1);
  key.close();
  // Parolasız anahtara parola verilmişse yine bağlanır.
  const extra = await openSftpSession(cfg(s, { password: null, keyPath: s.clientKey, passphrase: 'gereksiz' }));
  extra.close();
  await assert.rejects(openSftpSession(cfg(s, { password: null, keyPath: s.lockedKey })), { code: 'NEED_PASSWORD' });
  await assert.rejects(openSftpSession(cfg(s, { password: null, keyPath: s.lockedKey, passphrase: 'yanlis' })), { code: 'AUTH' });
  const locked = await openSftpSession(cfg(s, { password: null, keyPath: s.lockedKey, passphrase: s.passphrase }));
  assert.strictEqual((await locked.list('/')).length, 1);
  locked.close();
  await assert.rejects(openSftpSession(cfg(s, { password: null, keyPath: path.join(s.root, 'yok') })), { code: 'LOCAL' });
  await assert.rejects(openSftpSession(cfg(s, { password: null, keyPath: path.join(s.root, 'a.txt') })), { code: 'LOCAL' });
}));

test('SFTP: kopan bağlantıdan sonra list yeniden bağlanır; fetch indirir', () => withServer({ files: { 'a.txt': 'merhaba' } }, async (s) => {
  const ses = await openSftpSession(cfg(s));
  await ses.list('/');
  s.drop();
  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual((await ses.list('/')).length, 1);
  const file = path.join(tmp(), 'a.txt');
  await ses.fetch('/a.txt', file);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'merhaba');
  await assert.rejects(ses.fetch('/yok.txt', file), { code: 'FTP' });
  ses.close();
}));

test('SFTP kuyruk: klasör yükleme, indirme, var olanın üzerine yazma', () => withQueue({ files: { 'site/index.html': 'eski', 'site/img/a.png': 'resim' } }, async ({ q, r, l }) => {
  fs.mkdirSync(l('yerel/alt'), { recursive: true });
  fs.writeFileSync(l('yerel/alt/b.txt'), 'bbb');
  fs.writeFileSync(l('index.html'), 'yeni içerik');
  await q.add({ direction: 'up', localPath: l('yerel'), remotePath: '/yerel', isDir: true });
  await q.add({ direction: 'down', localPath: l('site'), remotePath: '/site', isDir: true });
  await q.add({ direction: 'up', localPath: l('index.html'), remotePath: '/site/index.html', isDir: false });
  await until(() => q.jobs().some((j) => j.state === 'asking'));
  q.answer(q.jobs().find((j) => j.state === 'asking').id, 'overwrite', false);
  await until(() => q.jobs().every((j) => j.state === 'done'));
  assert.strictEqual(fs.readFileSync(r('yerel/alt/b.txt'), 'utf8'), 'bbb');
  assert.strictEqual(fs.readFileSync(l('site/img/a.png'), 'utf8'), 'resim');
  assert.strictEqual(fs.readFileSync(r('site/index.html'), 'utf8'), 'yeni içerik');
  noParts(r('.'));
}));

test('SFTP kuyruk: indirirken klasöre giden bağların içine girilmez', () => withQueue({ files: { 'ev/public_html/a.txt': 'x' } }, async ({ q, r, l }) => {
  fs.symlinkSync(r('ev'), r('ev/dongu'));
  await q.add({ direction: 'down', localPath: l('ev'), remotePath: '/ev', isDir: true });
  await until(() => q.jobs().length > 0 && q.jobs().every((j) => j.state === 'done'));
  assert.deepStrictEqual(fs.readdirSync(l('ev')), ['public_html']);
}));

for (const direction of ['up', 'down']) {
  test(`SFTP kuyruk: kopan ${direction === 'up' ? 'yükleme' : 'indirme'} kaldığı yerden sürer`, () => withQueue({ slow: 3 }, async ({ q, s, r, l, seen, onChange }) => {
    const data = pattern(direction === 'up' ? 1 : 2);
    fs.writeFileSync(direction === 'up' ? l('b.bin') : r('b.bin'), data);
    dropOnce(onChange, s);
    await q.add({ direction, localPath: l('b.bin'), remotePath: '/b.bin', isDir: false, size: SIZE });
    await until(() => q.jobs()[0].state === 'error', 20000);
    const part = (direction === 'up' ? r : l)('b.bin.mrcftp-part');
    const kept = fs.statSync(part).size;
    assert.ok(kept > 0 && kept < SIZE);
    const from = seen.length;
    q.retry(q.jobs()[0].id);
    await until(() => q.jobs()[0].state === 'done', 60000);
    const resumed = seen.slice(from).find((jobs) => jobs[0].state === 'active');
    assert.ok(resumed[0].bytes > 0, 'sıfırdan başlamamalı');
    assert.ok(fs.readFileSync((direction === 'up' ? r : l)('b.bin')).equals(data));
    noParts(direction === 'up' ? s.root : path.dirname(l('x')));
  }));
}

test('SFTP kuyruk: iptal geçici dosyayı siler', () => withQueue({ slow: 3 }, async ({ q, s, l }) => {
  fs.writeFileSync(l('c.bin'), pattern(3));
  await q.add({ direction: 'up', localPath: l('c.bin'), remotePath: '/c.bin', isDir: false });
  await until(() => q.jobs()[0].state === 'active' && q.jobs()[0].bytes > 0, 20000);
  q.cancel(q.jobs()[0].id);
  await until(() => q.jobs()[0].state === 'cancelled', 20000);
  await until(() => fs.readdirSync(s.root).length === 0, 5000);
}));

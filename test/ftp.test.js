const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { openSession, sanitizeEntries, pinDataSockets } = require('../src/main/ftp');
const { startServer } = require('./helpers/server');

const cfg = (s, extra = {}) => ({ host: '127.0.0.1', port: s.port, user: s.user, password: s.password, secure: false, fingerprint: null, ...extra });
async function withServer(opts, fn) {
  const s = await startServer(opts);
  try { await fn(s); } finally { await s.stop(); }
}

test('düz FTP: klasörler önce listelenir', () => withServer({ files: { 'a.txt': 'merhaba', 'klasör/': null } }, async (s) => {
  const ses = await openSession(cfg(s));
  const list = await ses.list('/');
  assert.deepStrictEqual(list.map((e) => [e.name, e.isDir]), [['klasör', true], ['a.txt', false]]);
  assert.strictEqual(list[1].size, 7);
  ses.close();
}));

test('mkdir, rename, remove sunucuda gözlenir', () => withServer({ files: { 'a.txt': 'x', 'dolu/ic.txt': 'y' } }, async (s) => {
  const ses = await openSession(cfg(s));
  await ses.mkdir('/yeni klasör');
  assert.ok(fs.statSync(path.join(s.root, 'yeni klasör')).isDirectory());
  await ses.rename('/a.txt', '/b.txt');
  assert.ok(fs.existsSync(path.join(s.root, 'b.txt')));
  await ses.remove('/b.txt', false);
  await ses.remove('/dolu', true);
  assert.deepStrictEqual(fs.readdirSync(s.root), ['yeni klasör']);
  assert.deepStrictEqual((await ses.list('/')).map((e) => e.name), ['yeni klasör']);
  ses.close();
}));

test('Türkçe karakterli ve boşluklu ad aynen gelir', () => withServer({ files: { 'görseller/İş planı ş.txt': 'x' } }, async (s) => {
  const ses = await openSession(cfg(s));
  assert.strictEqual((await ses.list('/görseller'))[0].name, 'İş planı ş.txt');
  ses.close();
}));

test('kötü adlar listeden atılır', () => {
  const out = sanitizeEntries([{ name: '..' }, { name: '.' }, { name: 'a/b' }, { name: 'a\\b' }, { name: '' }, { name: 'ok' }]);
  assert.deepStrictEqual(out.map((e) => e.name), ['ok']);
});

test('yanlış şifre: tek deneme, AUTH', () => withServer({}, async (s) => {
  await assert.rejects(openSession(cfg(s, { password: 'yanlis' })), (e) => {
    assert.strictEqual(e.code, 'AUTH');
    assert.strictEqual(e.message, 'Kullanıcı adı ya da şifre yanlış.');
    return true;
  });
  assert.strictEqual(s.logins, 1);
}));

test('kapalı port: NET', async () => {
  await assert.rejects(openSession({ host: '127.0.0.1', port: 1, user: 'a', password: 'b', secure: false }), (e) => e.code === 'NET');
});

test('TLS, parmak izi yok: CERT ve giriş denemesi yok', () => withServer({ tls: true }, async (s) => {
  await assert.rejects(openSession(cfg(s, { secure: true })), (e) => {
    assert.strictEqual(e.code, 'CERT');
    assert.strictEqual(e.cert.fingerprint, s.fingerprint);
    assert.ok(['self-signed', 'mismatch'].includes(e.cert.reason));
    assert.strictEqual(e.cert.subject, 'baska-ad.test');
    return true;
  });
  assert.strictEqual(s.logins, 0);
}));

test('TLS, doğru parmak izi: bağlanır ve listeler', () => withServer({ tls: true, files: { 'a.txt': 'x' } }, async (s) => {
  const ses = await openSession(cfg(s, { secure: true, fingerprint: s.fingerprint }));
  assert.deepStrictEqual((await ses.list('/')).map((e) => e.name), ['a.txt']);
  ses.close();
}));

test('TLS, yanlış parmak izi: CERT changed, giriş yok', () => withServer({ tls: true }, async (s) => {
  await assert.rejects(openSession(cfg(s, { secure: true, fingerprint: 'AA:BB' })), (e) => e.code === 'CERT' && e.cert.reason === 'changed');
  assert.strictEqual(s.logins, 0);
}));

test('kopan bağlantıdan sonra list kendiliğinden yeniden bağlanır', () => withServer({ files: { 'a.txt': 'x' } }, async (s) => {
  const ses = await openSession(cfg(s));
  await ses.list('/');
  s.drop();
  assert.deepStrictEqual((await ses.list('/')).map((e) => e.name), ['a.txt']);
  ses.close();
}));

test('veri bağlantısı da parmak izine bağlanır', async () => {
  const sock = Object.assign(new EventEmitter(), { destroyed: null, getPeerCertificate: () => ({ fingerprint256: 'KÖTÜ' }), destroy(e) { this.destroyed = e; } });
  const client = { prepareTransfer: async (ftp) => { ftp.dataSocket = sock; } };
  pinDataSockets(client, 'İYİ');
  client.prepareTransfer = async (ftp) => { ftp.dataSocket = sock; }; // kütüphane stratejiyi yeniden atar; koruma kalmalı
  const ftp = {};
  await client.prepareTransfer(ftp);
  sock.emit('secureConnect');
  assert.ok(sock.destroyed instanceof Error);
});

test('yılsız liste tarihi bu yıla, gelecekteyse geçen yıla yorulur', () => {
  const { parseListDate } = require('../src/main/ftp');
  const now = new Date(2026, 10, 19, 15, 0);
  assert.strictEqual(new Date(parseListDate('Nov 19 12:34', now)).getFullYear(), 2026);
  assert.strictEqual(new Date(parseListDate('Dec 25 10:00', now)).getFullYear(), 2025);
  assert.strictEqual(new Date(parseListDate('Nov  3  2024', now)).getFullYear(), 2024);
  assert.strictEqual(parseListDate('anlamsız', now), null);
  assert.strictEqual(parseListDate('', now), null);
});

test('liste izinleri verir, chmod değiştirir', () => withServer({ files: { 'a.txt': 'x' } }, async (s) => {
  fs.chmodSync(path.join(s.root, 'a.txt'), 0o644);
  const ses = await openSession(cfg(s));
  assert.strictEqual((await ses.list('/'))[0].mode, 0o644);
  await ses.chmod('/a.txt', 0o600);
  assert.strictEqual(fs.statSync(path.join(s.root, 'a.txt')).mode & 0o777, 0o600);
  assert.strictEqual((await ses.list('/'))[0].mode, 0o600);
  ses.close();
}));

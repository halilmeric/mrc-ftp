const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSiteStore } = require('../src/main/sites');
const { tmpDir } = require('./helpers/tmp');

const enc = (s) => 'ENC:' + s;
const dec = (s) => s.slice(4);
const tmpFile = () => path.join(tmpDir('mrc-sites-'), 'sites.json');
const input = { name: 'Örnek', host: 'ftp.ornek.com', user: 'ali', password: 'gizli-123' };

test('kaydedilen site listede şifresiz görünür', () => {
  const store = createSiteStore({ file: tmpFile(), encrypt: enc, decrypt: dec });
  const saved = store.save(input);
  const [site] = store.list();
  assert.strictEqual(site.id, saved.id);
  assert.strictEqual(site.hasPassword, true);
  assert.ok(!('password' in site));
  assert.deepStrictEqual([site.port, site.secure, site.startDir, site.fingerprint], [21, true, '/', null]);
});

test('diskte düz şifre yok', () => {
  const file = tmpFile();
  createSiteStore({ file, encrypt: enc, decrypt: dec }).save(input);
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes('"gizli-123"'));
  assert.ok(raw.includes('ENC:'));
});

test('get şifreyi çözer', () => {
  const store = createSiteStore({ file: tmpFile(), encrypt: enc, decrypt: dec });
  const { id } = store.save(input);
  assert.strictEqual(store.get(id).password, 'gizli-123');
  assert.strictEqual(store.get('yok'), null);
});

test('şifreleme yoksa şifre saklanmaz', () => {
  const file = tmpFile();
  const store = createSiteStore({ file, encrypt: () => null, decrypt: dec });
  const { id } = store.save(input);
  assert.ok(!fs.readFileSync(file, 'utf8').includes('gizli-123'));
  assert.strictEqual(store.list()[0].hasPassword, false);
  assert.strictEqual(store.get(id).password, null);
});

test('şifre verilmeden kaydedince eski şifre durur', () => {
  const store = createSiteStore({ file: tmpFile(), encrypt: enc, decrypt: dec });
  const { id } = store.save(input);
  store.save({ id, name: 'Yeni ad', host: 'ftp.ornek.com', user: 'ali' });
  assert.strictEqual(store.get(id).password, 'gizli-123');
  assert.strictEqual(store.get(id).name, 'Yeni ad');
});

test('trust parmak izini saklar, sunucu değişince siler', () => {
  const store = createSiteStore({ file: tmpFile(), encrypt: enc, decrypt: dec });
  const { id } = store.save(input);
  store.trust(id, 'AA:BB');
  assert.strictEqual(store.get(id).fingerprint, 'AA:BB');
  store.save({ id, name: 'Örnek', host: 'baska.ornek.com', user: 'ali' });
  assert.strictEqual(store.get(id).fingerprint, null);
});

test('remove siler; bozuk dosya boş liste verir', () => {
  const file = tmpFile();
  const store = createSiteStore({ file, encrypt: enc, decrypt: dec });
  const { id } = store.save(input);
  store.remove(id);
  assert.deepStrictEqual(store.list(), []);
  fs.writeFileSync(file, '{bozuk');
  assert.deepStrictEqual(createSiteStore({ file, encrypt: enc, decrypt: dec }).list(), []);
});

test('şifre çözülemezse site şifresiz sayılır', () => {
  const file = tmpFile();
  const { id } = createSiteStore({ file, encrypt: enc, decrypt: dec }).save(input);
  const broken = createSiteStore({ file, encrypt: enc, decrypt: () => { throw new Error('anahtar yok'); } });
  assert.strictEqual(broken.get(id).password, null);
});

test('SFTP sitesi: alanlar saklanır, varsayılan port 22, anahtar parolası şifreli durur', () => {
  const file = tmpFile();
  const store = createSiteStore({ file, encrypt: enc, decrypt: dec });
  const saved = store.save({ host: 'ornek.com', user: 'ali', protocol: 'sftp', auth: 'key', keyPath: '/Users/ali/.ssh/id_ed25519', password: 'anahtar-parolasi' });
  assert.deepStrictEqual([saved.protocol, saved.auth, saved.keyPath, saved.port, saved.secure], ['sftp', 'key', '/Users/ali/.ssh/id_ed25519', 22, true]);
  const [row] = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(row.secret, 'ENC:anahtar-parolasi'); // yalnızca şifrelenmiş hali yazılır
  assert.ok(!('password' in row) && !('passphrase' in row));
  assert.strictEqual(store.get(saved.id).password, 'anahtar-parolasi');
  const plainKey = store.save({ host: 'b.com', user: 'ali', protocol: 'sftp', auth: 'key', keyPath: '/k' });
  assert.strictEqual(plainKey.hasPassword, false);
});

test('eski kayıt ftp sayılır; protokol değişince parmak izi sıfırlanır', () => {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify([{ id: 'eski', name: 'Eski', host: 'a.com', port: 21, user: 'u', secure: true, startDir: '/', fingerprint: 'AA', secret: null }]));
  const store = createSiteStore({ file, encrypt: enc, decrypt: dec });
  assert.deepStrictEqual([store.get('eski').protocol, store.get('eski').auth], ['ftp', 'password']);
  const same = store.save({ id: 'eski', host: 'a.com', port: 21, user: 'u' });
  assert.strictEqual(same.fingerprint, 'AA');
  const moved = store.save({ id: 'eski', host: 'a.com', port: 21, user: 'u', protocol: 'sftp' });
  assert.strictEqual(moved.fingerprint, null);
});

test('sık kullanılan klasörler siteyle saklanır, düzenlemede korunur', () => {
  const store = createSiteStore({ file: tmpFile(), encrypt: enc, decrypt: dec });
  const site = store.save(input);
  assert.deepStrictEqual(site.favorites, []);
  assert.deepStrictEqual(store.setFavorites(site.id, ['/public_html', '/public_html', 'göreli', 5, '/logs']), ['/public_html', '/logs']);
  assert.deepStrictEqual(store.save({ ...input, id: site.id, name: 'Yeni ad' }).favorites, ['/public_html', '/logs']);
  assert.deepStrictEqual(store.get(site.id).favorites, ['/public_html', '/logs']);
});

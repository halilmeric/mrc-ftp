const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSiteStore } = require('../src/main/sites');

const enc = (s) => 'ENC:' + s;
const dec = (s) => s.slice(4);
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mrc-sites-')), 'sites.json');
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

const test = require('node:test');
const assert = require('node:assert');
const { formatSize, formatDate, formatEta } = require('../src/renderer/format');

test('formatSize', () => {
  assert.strictEqual(formatSize(0), '0 B');
  assert.strictEqual(formatSize(512), '512 B');
  assert.strictEqual(formatSize(1536), '1,5 KB');
  assert.strictEqual(formatSize(4096), '4 KB');
  assert.strictEqual(formatSize(50331648), '48 MB');
  assert.strictEqual(formatSize(2.4 * 1024 * 1024), '2,4 MB');
  assert.strictEqual(formatSize(3 * 1024 ** 3), '3 GB');
});

test('formatDate', () => {
  const now = new Date(2026, 10, 19, 15, 0);
  assert.strictEqual(formatDate(new Date(2026, 10, 19, 9, 0).toISOString(), now), 'bugün');
  assert.strictEqual(formatDate(new Date(2026, 10, 18, 23, 0).toISOString(), now), 'dün');
  assert.strictEqual(formatDate(new Date(2026, 10, 3, 12, 0).toISOString(), now), '3 Kas');
  assert.strictEqual(formatDate(new Date(2025, 10, 3, 12, 0).toISOString(), now), '3 Kas 2025');
  assert.strictEqual(formatDate(null, now), '—');
});

test('formatEta', () => {
  assert.strictEqual(formatEta(7), '7 sn');
  assert.strictEqual(formatEta(59), '59 sn');
  assert.strictEqual(formatEta(150), '3 dk');
  assert.strictEqual(formatEta(0), '1 sn');
});

test('izin metni ve sayısı', () => {
  const { modeToText, textToMode } = require('../src/renderer/format');
  assert.strictEqual(modeToText(0o644), '644');
  assert.strictEqual(modeToText(0o7), '007');
  assert.strictEqual(textToMode('755'), 0o755);
  for (const bad of ['9x', '7777', '', '64', '648']) assert.strictEqual(textToMode(bad), null);
});

const { batchNames } = require('../src/renderer/format');

test('toplu ad: bul-değiştir, kalıp, numara ve uzantı', () => {
  assert.deepStrictEqual(batchNames(['IMG_1.jpg', 'IMG_2.jpg'], 'IMG_', 'foto-', []).map((r) => r.to), ['foto-1.jpg', 'foto-2.jpg']);
  assert.deepStrictEqual(batchNames(['b.png', 'a.tar.gz', 'LICENSE'], '', 'dosya-{n}', []).map((r) => r.to), ['dosya-1.png', 'dosya-2.gz', 'dosya-3']);
  const many = batchNames(Array.from({ length: 12 }, (_, i) => `x${i}.txt`), '', 'y{n}', []);
  assert.deepStrictEqual([many[0].to, many[11].to], ['y01.txt', 'y12.txt']);
  assert.ok(batchNames(['a.txt'], '', '', []).every((r) => r.to === r.from && !r.error), 'boş kalıp adı değiştirmez');
});

test('toplu ad: çakışma, boş ve geçersiz adlar işaretlenir', () => {
  const err = (rows) => rows.map((r) => Boolean(r.error));
  assert.deepStrictEqual(err(batchNames(['a1.txt', 'a2.txt'], '1', '2', [])), [true, false], 'seçili başka bir öğenin adı');
  assert.deepStrictEqual(err(batchNames(['a.txt', 'b.txt'], '', 'ayni', [])), [true, true], 'iki öğe aynı ada');
  assert.deepStrictEqual(err(batchNames(['a.txt'], 'a', 'var', ['a.txt', 'var.txt'])), [true], 'klasörde zaten var');
  assert.deepStrictEqual(err(batchNames(['a'], 'a', '', [])), [true], 'boş ad');
  assert.deepStrictEqual(err(batchNames(['a.txt'], 'a', 'x/y', [])), [true], 'yol ayırıcı');
  assert.deepStrictEqual(err(batchNames(['a.txt'], 'a', '..', [])).length, 1);
  assert.deepStrictEqual(err(batchNames(['a.txt', 'b.txt'], 'a', 'c', ['a.txt', 'b.txt'])), [false, false]);
});

test('toplu ad: {n} yalnızca kalıpta sayılır; harf büyüklüğü farkı çakışma sayılır', () => {
  assert.ok(batchNames(['a{n}.txt'], '', '', []).every((r) => r.to === r.from));
  assert.strictEqual(batchNames(['a{n}.txt'], 'a', 'b', [])[0].to, 'b{n}.txt');
  assert.ok(batchNames(['foo.txt'], 'foo', 'barx', ['foo.txt', 'barX.txt'])[0].error);
  assert.ok(!batchNames(['foo.txt'], 'foo', 'Foo', ['foo.txt'])[0].error, 'kendi adının harfini değiştirmek serbest');
});

test('features: kapalı listesinde olmayan her özellik açıktır', () => {
  const { features } = require('../src/renderer/format');
  const all = { terminal: true, favorites: true, parallel: true, edit: true, batch: true, preview: true };
  assert.deepStrictEqual(features(null), all);
  assert.deepStrictEqual(features('bozuk{'), all);
  assert.deepStrictEqual(features('{"terminal":false}'), all); // liste değilse yok sayılır
  assert.deepStrictEqual(features('["terminal","yok",7]'), { ...all, terminal: false });
  assert.deepStrictEqual(features('["edit","batch"]'), { ...all, edit: false, batch: false });
});

test('fileKind: uzantıya göre simge türü', () => {
  const { fileKind } = require('../src/renderer/format');
  assert.strictEqual(fileKind('index.HTML'), 'code');
  assert.strictEqual(fileKind('next.config.ts'), 'code');
  assert.strictEqual(fileKind('foto.jpeg'), 'image');
  assert.strictEqual(fileKind('yedek.tar.gz'), 'archive');
  assert.strictEqual(fileKind('README.md'), 'doc');
  assert.strictEqual(fileKind('film.mp4'), 'media');
  assert.strictEqual(fileKind('kur.exe'), 'file');
  assert.strictEqual(fileKind('Makefile'), 'file');
  assert.strictEqual(fileKind('.htaccess'), 'file'); // noktayla başlayan adın uzantısı yoktur
});

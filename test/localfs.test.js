const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const localfs = require('../src/main/localfs');
const { tmpDir } = require('./helpers/tmp');

test('yerel liste: klasörler önce, gizli dosya yok', async () => {
  const dir = tmpDir('mrc-lfs-');
  fs.writeFileSync(path.join(dir, 'b.txt'), '12345');
  fs.writeFileSync(path.join(dir, '.gizli'), 'x');
  fs.mkdirSync(path.join(dir, 'klasör'));
  const list = await localfs.list(dir);
  assert.deepStrictEqual(list.map((e) => [e.name, e.isDir, e.size]), [['klasör', true, 0], ['b.txt', false, 5]]);
  assert.ok(!Number.isNaN(Date.parse(list[1].modified)));
});

test('olmayan klasör LOCAL hatası verir', async () => {
  await assert.rejects(localfs.list('/yok/boyle/bir/yer'), (e) => e.code === 'LOCAL' && e.message === 'Klasör açılamadı.');
});

test('home bir yol döndürür', () => {
  assert.strictEqual(localfs.home().path, os.homedir());
});

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openSession } = require('../src/main/ftp');
const { createQueue } = require('../src/main/transfers');
const { startServer } = require('./helpers/server');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mrc-local-'));
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('zaman aşımı: ' + fn);
    await new Promise((r) => setTimeout(r, 15));
  }
};

async function setup(files, fn, opts = {}) {
  const s = await startServer({ files, ...opts });
  const seen = [];
  let hook = null;
  const q = createQueue({
    openSession: () => openSession({ host: '127.0.0.1', port: s.port, user: s.user, password: s.password, secure: false }),
    onChange: (jobs) => { seen.push(jobs); if (hook) hook(jobs); },
  });
  const local = tmp();
  const settled = () => until(() => q.jobs().length > 0 && q.jobs().every((j) => !['queued', 'active'].includes(j.state)));
  try {
    await fn({ s, q, local, seen, settled, onChange: (h) => { hook = h; }, r: (p) => path.join(s.root, p), l: (p) => path.join(local, p) });
  } finally {
    q.close();
    await s.stop();
  }
}
const noParts = (dir) => assert.deepStrictEqual(fs.readdirSync(dir, { recursive: true }).filter((n) => String(n).endsWith('.mrcftp-part')), []);

test('tek dosya yükleme', () => setup({}, async ({ q, s, l, r, settled }) => {
  fs.writeFileSync(l('a.txt'), 'merhaba');
  await q.add({ direction: 'up', localPath: l('a.txt'), remotePath: '/a.txt', isDir: false });
  await settled();
  const [job] = q.jobs();
  assert.deepStrictEqual([job.state, job.bytes, job.total, job.name], ['done', 7, 7, 'a.txt']);
  assert.strictEqual(fs.readFileSync(r('a.txt'), 'utf8'), 'merhaba');
  noParts(s.root);
}));

test('tek dosya indirme', () => setup({ 'b.txt': 'dünya' }, async ({ q, l, local, settled }) => {
  await q.add({ direction: 'down', localPath: l('b.txt'), remotePath: '/b.txt', isDir: false });
  await settled();
  assert.strictEqual(q.jobs()[0].state, 'done');
  assert.strictEqual(fs.readFileSync(l('b.txt'), 'utf8'), 'dünya');
  noParts(local);
}));

test('klasör yükleme yapıyı korur', () => setup({}, async ({ q, l, r, settled }) => {
  fs.mkdirSync(l('a/b'), { recursive: true });
  fs.mkdirSync(l('a/bos'));
  fs.writeFileSync(l('a/b/c.txt'), 'c');
  fs.writeFileSync(l('a/d.txt'), 'd');
  await q.add({ direction: 'up', localPath: l('a'), remotePath: '/a', isDir: true });
  await settled();
  assert.strictEqual(q.jobs().length, 2);
  assert.strictEqual(fs.readFileSync(r('a/b/c.txt'), 'utf8'), 'c');
  assert.strictEqual(fs.readFileSync(r('a/d.txt'), 'utf8'), 'd');
  assert.ok(fs.statSync(r('a/bos')).isDirectory());
}));

test('klasör indirme yapıyı korur', () => setup({ 'k/x/y.txt': 'y', 'k/bos/': null }, async ({ q, l, settled }) => {
  await q.add({ direction: 'down', localPath: l('k'), remotePath: '/k', isDir: true });
  await settled();
  assert.strictEqual(fs.readFileSync(l('k/x/y.txt'), 'utf8'), 'y');
  assert.ok(fs.statSync(l('k/bos')).isDirectory());
}));

test('Türkçe adlı dosya gidip gelir', () => setup({}, async ({ q, l, r, settled }) => {
  const name = 'İş planı ş.txt';
  fs.writeFileSync(l(name), 'içerik');
  await q.add({ direction: 'up', localPath: l(name), remotePath: '/' + name, isDir: false });
  await settled();
  assert.ok(fs.readdirSync(r('')).includes(name));
  await q.add({ direction: 'down', localPath: l('geri.txt'), remotePath: '/' + name, isDir: false });
  await until(() => q.jobs().length === 2 && q.jobs()[1].state === 'done');
  assert.strictEqual(fs.readFileSync(l('geri.txt'), 'utf8'), 'içerik');
}));

test('çakışma sorar, kuyruk sürer; atla ve üzerine yaz', () => setup({ 'a.txt': 'eski', 'b.txt': 'eski' }, async ({ q, l, r }) => {
  for (const n of ['a.txt', 'b.txt', 'c.txt']) fs.writeFileSync(l(n), 'yeni');
  for (const n of ['a.txt', 'b.txt', 'c.txt']) await q.add({ direction: 'up', localPath: l(n), remotePath: '/' + n, isDir: false });
  await until(() => q.jobs()[2].state === 'done');
  const [a, b] = q.jobs();
  assert.deepStrictEqual([a.state, b.state], ['asking', 'asking']);
  q.answer(a.id, 'skip', false);
  q.answer(b.id, 'overwrite', false);
  await until(() => q.jobs()[1].state === 'done');
  assert.strictEqual(q.jobs()[0].state, 'skipped');
  assert.strictEqual(fs.readFileSync(r('a.txt'), 'utf8'), 'eski');
  assert.strictEqual(fs.readFileSync(r('b.txt'), 'utf8'), 'yeni');
}));

test('hepsine uygula bekleyen soruları da yanıtlar', () => setup({ '1.txt': 'e', '2.txt': 'e', '3.txt': 'e' }, async ({ q, l, r }) => {
  for (const n of ['1.txt', '2.txt', '3.txt']) {
    fs.writeFileSync(l(n), 'yeni');
    await q.add({ direction: 'up', localPath: l(n), remotePath: '/' + n, isDir: false });
  }
  await until(() => q.jobs().every((j) => j.state === 'asking'));
  q.answer(q.jobs()[0].id, 'overwrite', true);
  await until(() => q.jobs().every((j) => j.state === 'done'));
  for (const n of ['1.txt', '2.txt', '3.txt']) assert.strictEqual(fs.readFileSync(r(n), 'utf8'), 'yeni');
}));

test('iptal: geçici dosya kalmaz, sıradaki başlar', () => setup({}, async ({ q, s, l, r, onChange }) => {
  fs.writeFileSync(l('buyuk.bin'), Buffer.alloc(24 * 1024 * 1024, 1));
  fs.writeFileSync(l('kucuk.txt'), 'k');
  let cancelled = false;
  onChange((jobs) => {
    const active = jobs.find((j) => j.state === 'active' && j.bytes > 0);
    if (active && !cancelled) { cancelled = true; q.cancel(active.id); }
  });
  await q.add({ direction: 'up', localPath: l('buyuk.bin'), remotePath: '/buyuk.bin', isDir: false });
  await q.add({ direction: 'up', localPath: l('kucuk.txt'), remotePath: '/kucuk.txt', isDir: false });
  await until(() => q.jobs()[1].state === 'done', 20000);
  assert.strictEqual(q.jobs()[0].state, 'cancelled');
  assert.ok(!fs.existsSync(r('buyuk.bin')));
  noParts(s.root);
}, { slow: 4 }));

test('yarıda kopan üzerine yazma asıl dosyayı bozmaz; yeniden dene bitirir', () => setup({ 'site.bin': 'eski' }, async ({ q, s, l, r, onChange, seen }) => {
  fs.writeFileSync(l('site.bin'), Buffer.alloc(24 * 1024 * 1024, 2));
  let dropped = false;
  onChange((jobs) => {
    const active = jobs.find((j) => j.state === 'active' && j.bytes > 0);
    if (active && !dropped) { dropped = true; s.drop(); }
  });
  await q.add({ direction: 'up', localPath: l('site.bin'), remotePath: '/site.bin', isDir: false });
  await until(() => q.jobs()[0].state === 'asking');
  q.answer(q.jobs()[0].id, 'overwrite', false);
  await until(() => q.jobs()[0].state === 'error', 20000);
  assert.ok(q.jobs()[0].error);
  assert.strictEqual(fs.readFileSync(r('site.bin'), 'utf8'), 'eski');
  noParts(s.root);
  const grew = seen.map((jobs) => jobs[0] && jobs[0].bytes).filter((b) => b > 0);
  assert.ok(grew.length >= 1);
  q.retry(q.jobs()[0].id);
  await until(() => q.jobs()[0].state === 'done', 20000);
  assert.strictEqual(fs.statSync(r('site.bin')).size, 24 * 1024 * 1024);
  noParts(s.root);
}, { slow: 4 }));

test('ilerleme artan baytlarla birden çok kez bildirilir', () => setup({}, async ({ q, l, seen, settled }) => {
  fs.writeFileSync(l('orta.bin'), Buffer.alloc(24 * 1024 * 1024, 3));
  await q.add({ direction: 'up', localPath: l('orta.bin'), remotePath: '/orta.bin', isDir: false });
  await settled();
  const bytes = seen.map((jobs) => jobs[0].bytes);
  assert.ok(new Set(bytes).size >= 3, 'en az üç farklı ilerleme değeri: ' + [...new Set(bytes)].length);
  assert.deepStrictEqual(bytes, [...bytes].sort((a, b) => a - b));
  assert.ok(q.jobs()[0].speed >= 0);
}, { slow: 4 }));

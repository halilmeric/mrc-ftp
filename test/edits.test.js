const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openSession } = require('../src/main/ftp');
const { createQueue } = require('../src/main/transfers');
const { createEdits } = require('../src/main/edits');
const { startServer } = require('./helpers/server');
const { tmpDir } = require('./helpers/tmp');

const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('zaman aşımı: ' + fn);
    await new Promise((r) => setTimeout(r, 15));
  }
};

async function setup(files, fn, opts = {}) {
  const s = await startServer({ files, ...opts });
  const connect = () => openSession({ host: '127.0.0.1', port: s.port, user: s.user, password: s.password, secure: false });
  const session = await connect();
  const dir = tmpDir('mrc-edit-');
  const opened = [];
  const counts = [];
  let edits;
  const q = createQueue({ openSession: connect, onChange: () => {}, onUploaded: (p, base) => edits.updateBaseline(p, base) });
  edits = createEdits({ dir, getSession: async () => session, enqueue: (spec) => q.add(spec), open: async (p) => { if (opts.openFails) throw new Error('uygulama yok'); opened.push(p); }, onChange: (n) => counts.push(n), interval: 25 });
  const entry = async (name) => (await session.list('/')).find((e) => e.name === name);
  try {
    await fn({ s, q, edits, dir, opened, counts, entry, r: (p) => path.join(s.root, p) });
  } finally {
    edits.stopAll();
    q.close();
    session.close();
    await s.stop();
  }
}
const lastDone = (q) => q.jobs().length > 0 && q.jobs().every((j) => j.state === 'done');

test('düzenle: dosya iner, açılır, kayıt sunucuya sormadan yüklenir', () => setup({ 'a.txt': 'eski' }, async ({ q, edits, opened, counts, entry, r }) => {
  await edits.start('/a.txt', await entry('a.txt'));
  assert.strictEqual(fs.readFileSync(opened[0], 'utf8'), 'eski');
  assert.strictEqual(edits.count(), 1);
  assert.deepStrictEqual(counts, [1]);
  fs.writeFileSync(opened[0], 'yeni içerik');
  await until(() => lastDone(q));
  assert.strictEqual(fs.readFileSync(r('a.txt'), 'utf8'), 'yeni içerik');
  fs.writeFileSync(opened[0], 'ikinci kayıt, daha uzun');
  await until(() => q.jobs().length === 2 && lastDone(q));
  assert.strictEqual(fs.readFileSync(r('a.txt'), 'utf8'), 'ikinci kayıt, daha uzun');
}));

test('düzenle: aynı dosya iki kez açılırsa yeniden inmez', () => setup({ 'a.txt': 'eski' }, async ({ edits, opened, entry }) => {
  await edits.start('/a.txt', await entry('a.txt'));
  await edits.start('/a.txt', await entry('a.txt'));
  assert.strictEqual(opened.length, 2);
  assert.strictEqual(opened[0], opened[1]);
  assert.strictEqual(edits.count(), 1);
}));

test('düzenle: sunucuda değişen dosya sormadan ezilmez', () => setup({ 'a.txt': 'eski' }, async ({ q, edits, opened, entry, r }) => {
  await edits.start('/a.txt', await entry('a.txt'));
  fs.writeFileSync(r('a.txt'), 'başkası sunucuda değiştirdi');
  fs.writeFileSync(opened[0], 'benim kaydım');
  await until(() => q.jobs().length === 1 && q.jobs()[0].state === 'asking');
  assert.strictEqual(q.jobs()[0].note, 'Dosya sen düzenlerken sunucuda değişmiş');
  assert.strictEqual(fs.readFileSync(r('a.txt'), 'utf8'), 'başkası sunucuda değiştirdi');
  q.answer(q.jobs()[0].id, 'overwrite', false);
  await until(() => lastDone(q));
  assert.strictEqual(fs.readFileSync(r('a.txt'), 'utf8'), 'benim kaydım');
}));

test('düzenle: yerine koyarak kaydeden editör de izlenir', () => setup({ 'a.txt': 'eski' }, async ({ q, edits, opened, entry, r }) => {
  await edits.start('/a.txt', await entry('a.txt'));
  fs.writeFileSync(opened[0] + '.tmp', 'yerine konan içerik');
  fs.renameSync(opened[0] + '.tmp', opened[0]);
  await until(() => lastDone(q));
  assert.strictEqual(fs.readFileSync(r('a.txt'), 'utf8'), 'yerine konan içerik');
}));

test('düzenle: dışarı taşan yol ve büyük dosya reddedilir', () => setup({ 'a.txt': 'eski' }, async ({ edits, opened }) => {
  await assert.rejects(edits.start('/a/../../x', { size: 3, modified: null }), (e) => e.code === 'LOCAL');
  await assert.rejects(edits.start('/buyuk.sql', { size: 10 * 1024 * 1024 + 1, modified: null }), (e) => e.message === 'Düzenlemek için çok büyük, önce indir.');
  assert.strictEqual(opened.length, 0);
}));

test('düzenle: bitirince izleme durur, silince klasör gider', () => setup({ 'a.txt': 'eski' }, async ({ q, edits, opened, counts, dir, entry, r }) => {
  await edits.start('/a.txt', await entry('a.txt'));
  edits.stopAll();
  assert.strictEqual(edits.count(), 0);
  assert.strictEqual(counts.at(-1), 0);
  fs.writeFileSync(opened[0], 'izlenmeyen değişiklik');
  await new Promise((res) => setTimeout(res, 200));
  assert.strictEqual(q.jobs().length, 0);
  assert.strictEqual(fs.readFileSync(r('a.txt'), 'utf8'), 'eski');
  edits.wipe();
  assert.ok(!fs.existsSync(dir));
}));


// --- Sürüm 2 inceleme bulguları ---
test('düzenle: art arda iki kayıt yanlış "sunucuda değişmiş" sorusu doğurmaz', () => setup({ 'a.txt': 'eski' }, async ({ q, edits, opened, entry, r }) => {
  await edits.start('/a.txt', await entry('a.txt'));
  fs.writeFileSync(opened[0], 'birinci kayıt');
  await until(() => q.jobs().some((j) => j.state === 'active')); // ilk yükleme sürerken ikinci kayıt
  fs.writeFileSync(opened[0], 'ikinci kayıt, daha uzun olan');
  await until(() => q.jobs().length > 0 && q.jobs().every((j) => j.state === 'done') && fs.readFileSync(r('a.txt'), 'utf8') === 'ikinci kayıt, daha uzun olan', 15000);
  assert.ok(!q.jobs().some((j) => j.state === 'asking'));
}, { slow: 200 }));

test('düzenle: yüklenmemiş düzenleme sayılır ve beklenebilir', () => setup({ 'a.txt': 'eski' }, async ({ q, edits, opened, entry, r }) => {
  await edits.start('/a.txt', await entry('a.txt'));
  assert.strictEqual(q.pendingEdits(), 0);
  fs.writeFileSync(opened[0], 'gidecek olan kayıt');
  await until(() => q.pendingEdits() === 1);
  assert.strictEqual(await q.drainEdits(10000), 0);
  assert.strictEqual(fs.readFileSync(r('a.txt'), 'utf8'), 'gidecek olan kayıt');
  fs.writeFileSync(r('a.txt'), 'dışarıdan değişti, soru çıkacak');
  fs.writeFileSync(opened[0], 'soruda bekleyen kayıt');
  await until(() => q.jobs().some((j) => j.state === 'asking'));
  assert.strictEqual(await q.drainEdits(300), 1);
}, { slow: 20 }));

test('düzenle: açılınca çalışan dosya türleri reddedilir', () => setup({ 'a.txt': 'eski' }, async ({ edits, opened }) => {
  for (const name of ['x.terminal', 'x.WEBLOC', 'kur.pkg', 'a.command', 'b.inetloc', 'c.jar', 'd.app']) {
    await assert.rejects(edits.start('/' + name, { size: 10, modified: null }), (e) => e.code === 'LOCAL' && /güvenlik/.test(e.message), name);
  }
  assert.strictEqual(opened.length, 0);
}));

test('düzenle: açılamayan dosya izlemeye alınmaz', () => setup({ 'a.txt': 'eski' }, async ({ edits, entry }) => {
  await assert.rejects(edits.start('/a.txt', await entry('a.txt')));
  assert.strictEqual(edits.count(), 0);
}, { openFails: true }));

test('düzenle: karşılaştırma temeli güncel listeden alınır', () => setup({ 'a.txt': 'eski' }, async ({ q, edits, opened, r }) => {
  // Panel eski bir liste gösteriyor olabilir; indirdiğimiz anki durum esas alınmalı.
  await edits.start('/a.txt', { size: 999, modified: '2001-01-01T00:00:00.000Z' });
  fs.writeFileSync(opened[0], 'yeni içerik burada');
  await until(() => q.jobs().length === 1 && q.jobs()[0].state !== 'queued' && q.jobs()[0].state !== 'active');
  assert.strictEqual(q.jobs()[0].state, 'done');
  assert.strictEqual(fs.readFileSync(r('a.txt'), 'utf8'), 'yeni içerik burada');
}));

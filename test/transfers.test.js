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

// --- Son inceleme bulguları ---
const { FtpError } = require('../src/main/ftp');

// Gerçek oturumu sarar; rename davranışını ve açılan oturumları testten yönetmeye yarar.
async function wrapped(files, { rename, slow } = {}, fn) {
  const s = await startServer({ files, slow });
  const sessions = [];
  const seen = [];
  const q = createQueue({
    openSession: async () => {
      const real = await openSession({ host: '127.0.0.1', port: s.port, user: s.user, password: s.password, secure: false });
      sessions.push(real);
      if (!rename) return real;
      return new Proxy(real, { get: (t, k) => (k === 'rename' ? (from, to) => rename(t, from, to, s) : t[k]) });
    },
    onChange: (jobs) => seen.push(jobs),
  });
  const local = tmp();
  try {
    await fn({ s, q, sessions, seen, l: (p) => path.join(local, p), r: (p) => path.join(s.root, p) });
  } finally {
    q.close();
    await s.stop();
  }
}

test('taşıma yanıtı kaybolursa tamamlanan dosya silinmez', () => wrapped({ 'a.txt': 'eski' }, {
  // Sunucu taşımayı yapar ama yanıt ulaşmaz; yinelenen deneme "kaynak yok" hatası alır.
  rename: async (real, from, to) => { await real.rename(from, to); throw new FtpError('FTP', 'Sunucu işlemi reddetti: RNFR'); },
}, async ({ q, l, r }) => {
  fs.writeFileSync(l('a.txt'), 'yeni içerik');
  await q.add({ direction: 'up', localPath: l('a.txt'), remotePath: '/a.txt', isDir: false });
  await until(() => q.jobs()[0].state === 'asking');
  q.answer(q.jobs()[0].id, 'overwrite', false);
  await until(() => !['queued', 'active'].includes(q.jobs()[0].state));
  assert.strictEqual(q.jobs()[0].state, 'done');
  assert.strictEqual(fs.readFileSync(r('a.txt'), 'utf8'), 'yeni içerik');
}));

test('geçici dosya kaybolduysa asıl dosya silinmez', () => wrapped({ 'a.txt': 'eski' }, {
  rename: async (real, from, to, s) => { fs.rmSync(path.join(s.root, from)); throw new FtpError('FTP', 'Sunucu işlemi reddetti: RNFR'); },
}, async ({ q, l, r }) => {
  fs.writeFileSync(l('a.txt'), 'yeni içerik');
  await q.add({ direction: 'up', localPath: l('a.txt'), remotePath: '/a.txt', isDir: false });
  await until(() => q.jobs()[0].state === 'asking');
  q.answer(q.jobs()[0].id, 'overwrite', false);
  await until(() => !['queued', 'active'].includes(q.jobs()[0].state));
  assert.strictEqual(q.jobs()[0].state, 'error');
  assert.strictEqual(fs.readFileSync(r('a.txt'), 'utf8'), 'eski');
}));

test('aynı anda eklenen klasörler tek oturum açar', () => wrapped({}, {}, async ({ q, sessions, l }) => {
  for (const n of ['k1', 'k2', 'k3']) { fs.mkdirSync(l(n)); fs.writeFileSync(l(n + '/f.txt'), n); }
  await Promise.all(['k1', 'k2', 'k3'].map((n) => q.add({ direction: 'up', localPath: l(n), remotePath: '/' + n, isDir: true })));
  await until(() => q.jobs().length === 3 && q.jobs().every((j) => j.state === 'done'));
  assert.strictEqual(sessions.length, 1);
}));

test('aktarım sürerken kapatma: geçici dosya temizlenir, oturum kapanır, bildirim kesilir', () => wrapped({}, { slow: 4 }, async ({ q, s, sessions, seen, l }) => {
  fs.writeFileSync(l('buyuk.bin'), Buffer.alloc(24 * 1024 * 1024, 5));
  await q.add({ direction: 'up', localPath: l('buyuk.bin'), remotePath: '/buyuk.bin', isDir: false });
  await until(() => q.jobs()[0] && q.jobs()[0].state === 'active' && q.jobs()[0].bytes > 0, 20000);
  q.close();
  const count = seen.length;
  await until(() => sessions.every((x) => x.client.closed), 20000);
  await new Promise((res) => setTimeout(res, 300));
  assert.deepStrictEqual(fs.readdirSync(s.root), []);
  assert.strictEqual(seen.length, count);
}));

test('kuyruk oturumu giriş yapamazsa tek deneme yapılır ve tüm işler hata olur', async () => {
  let calls = 0;
  const q = createQueue({
    openSession: async () => { calls += 1; throw new FtpError('AUTH', 'Kullanıcı adı ya da şifre yanlış.'); },
    onChange: () => {},
  });
  const local = tmp();
  for (const n of ['1.txt', '2.txt', '3.txt']) {
    fs.writeFileSync(path.join(local, n), 'x');
    q.add({ direction: 'up', localPath: path.join(local, n), remotePath: '/' + n, isDir: false });
  }
  await until(() => q.jobs().length === 3 && q.jobs().every((j) => j.state === 'error'));
  assert.strictEqual(calls, 1);
  assert.strictEqual(q.jobs()[0].error, 'Kullanıcı adı ya da şifre yanlış.');
  q.close();
});


// --- Sürüm 2: aktarımı sürdürme ---
const SIZE = 24 * 1024 * 1024;
const pattern = (seed) => { const b = Buffer.alloc(SIZE); for (let i = 0; i < SIZE; i++) b[i] = (i * 7 + seed) % 251; return b; };
const dropOnce = (onChange, s) => {
  let done = false;
  onChange((jobs) => { if (!done && jobs.some((j) => j.state === 'active' && j.bytes > 0)) { done = true; s.drop(); } });
};
const firstActiveBytesAfter = (seen, from) => {
  const snap = seen.slice(from).find((jobs) => jobs[0] && jobs[0].state === 'active');
  return snap ? snap[0].bytes : -1;
};

test('kopan yükleme kaldığı yerden sürer', () => setup({}, async ({ q, s, l, r, onChange, seen }) => {
  const data = pattern(1);
  fs.writeFileSync(l('b.bin'), data);
  dropOnce(onChange, s);
  await q.add({ direction: 'up', localPath: l('b.bin'), remotePath: '/b.bin', isDir: false });
  await until(() => q.jobs()[0].state === 'error', 20000);
  const part = fs.statSync(r('b.bin.mrcftp-part')).size;
  assert.ok(part > 0 && part < SIZE, 'geçici dosya yarım kalmalı: ' + part);
  const mark = seen.length;
  q.retry(q.jobs()[0].id);
  await until(() => q.jobs()[0].state === 'done', 30000);
  assert.ok(firstActiveBytesAfter(seen, mark) > 0, 'ikinci deneme sıfırdan başlamamalı');
  assert.ok(fs.readFileSync(r('b.bin')).equals(data));
  noParts(s.root);
}, { slow: 4 }));

test('kopan indirme kaldığı yerden sürer', () => setup({}, async ({ q, s, l, r, local, onChange, seen }) => {
  const data = pattern(2);
  fs.writeFileSync(r('d.bin'), data);
  dropOnce(onChange, s);
  await q.add({ direction: 'down', localPath: l('d.bin'), remotePath: '/d.bin', isDir: false, size: SIZE, modified: null });
  await until(() => q.jobs()[0].state === 'error', 20000);
  const part = fs.statSync(l('d.bin.mrcftp-part')).size;
  assert.ok(part > 0 && part < SIZE, 'geçici dosya yarım kalmalı: ' + part);
  const mark = seen.length;
  q.retry(q.jobs()[0].id);
  await until(() => q.jobs()[0].state === 'done', 30000);
  assert.ok(firstActiveBytesAfter(seen, mark) > 0, 'ikinci deneme sıfırdan başlamamalı');
  assert.ok(fs.readFileSync(l('d.bin')).equals(data));
  noParts(local);
}, { slow: 4 }));

test('kaynak değiştiyse sürdürmez, baştan aktarır', () => setup({}, async ({ q, s, l, r, onChange }) => {
  fs.writeFileSync(l('c.bin'), pattern(3));
  dropOnce(onChange, s);
  await q.add({ direction: 'up', localPath: l('c.bin'), remotePath: '/c.bin', isDir: false });
  await until(() => q.jobs()[0].state === 'error', 20000);
  const fresh = pattern(4);
  fs.writeFileSync(l('c.bin'), fresh);
  fs.utimesSync(l('c.bin'), new Date(), new Date(Date.now() + 5000));
  q.retry(q.jobs()[0].id);
  await until(() => q.jobs()[0].state === 'done', 40000);
  assert.ok(fs.readFileSync(r('c.bin')).equals(fresh));
}, { slow: 2 }));

test('geçici dosya beklenenden büyükse baştan aktarır', () => setup({}, async ({ q, s, l, r, onChange }) => {
  const data = pattern(5);
  fs.writeFileSync(l('e.bin'), data);
  dropOnce(onChange, s);
  await q.add({ direction: 'up', localPath: l('e.bin'), remotePath: '/e.bin', isDir: false });
  await until(() => q.jobs()[0].state === 'error', 20000);
  fs.writeFileSync(r('e.bin.mrcftp-part'), Buffer.alloc(SIZE + 100, 9));
  q.retry(q.jobs()[0].id);
  await until(() => q.jobs()[0].state === 'done', 40000);
  assert.ok(fs.readFileSync(r('e.bin')).equals(data));
}, { slow: 2 }));

test('hata kartını kapatmak geçici dosyayı siler', () => setup({}, async ({ q, s, l, onChange }) => {
  fs.writeFileSync(l('f.bin'), pattern(6));
  dropOnce(onChange, s);
  await q.add({ direction: 'up', localPath: l('f.bin'), remotePath: '/f.bin', isDir: false });
  await until(() => q.jobs()[0].state === 'error', 20000);
  q.dismiss(q.jobs()[0].id);
  await until(() => fs.readdirSync(s.root).length === 0, 10000);
  assert.deepStrictEqual(q.jobs(), []);
}, { slow: 4 }));


test('aynı hedefe giden iki yarım aktarım birbirinin geçici dosyasına eklemez', () => setup({}, async ({ q, s, l, r, onChange }) => {
  const a = pattern(11);
  fs.mkdirSync(l('x')); fs.mkdirSync(l('y'));
  fs.writeFileSync(l('x/ayni.bin'), a);
  fs.writeFileSync(l('y/ayni.bin'), pattern(12));
  let drops = 0;
  let armed = true;
  onChange((jobs) => {
    if (armed && drops < 2 && jobs.some((j) => j.state === 'active' && j.bytes > (drops === 0 ? 0 : 6 * 1024 * 1024))) { drops += 1; armed = false; s.drop(); setTimeout(() => { armed = true; }, 300); }
  });
  await q.add({ direction: 'up', localPath: l('x/ayni.bin'), remotePath: '/ayni.bin', isDir: false });
  await until(() => q.jobs()[0].state === 'error', 20000);
  await q.add({ direction: 'up', localPath: l('y/ayni.bin'), remotePath: '/ayni.bin', isDir: false });
  await until(() => q.jobs()[1].state === 'error', 30000);
  assert.strictEqual(drops, 2);
  q.retry(q.jobs()[0].id); // ikinci iş hata kartında duruyor, geçici dosya onun baytlarını taşıyor
  await until(() => q.jobs()[0].state === 'done', 40000);
  assert.ok(fs.readFileSync(r('ayni.bin')).equals(a), 'hedef, birinci kaynağın bayt bayt aynısı olmalı');
}, { slow: 3 }));

test('atlanan ya da sırada iptal edilen yarım işin geçici dosyası silinir', () => setup({}, async ({ q, s, l, onChange }) => {
  fs.writeFileSync(l('g.bin'), pattern(13));
  dropOnce(onChange, s);
  await q.add({ direction: 'up', localPath: l('g.bin'), remotePath: '/g.bin', isDir: false });
  await until(() => q.jobs()[0].state === 'error', 20000);
  assert.ok(fs.readdirSync(s.root).includes('g.bin.mrcftp-part'));
  q.cancel(q.jobs()[0].id);
  await until(() => fs.readdirSync(s.root).length === 0, 10000);
}, { slow: 4 }));

const test = require('node:test');
const assert = require('node:assert');
const { connectSsh } = require('../src/main/sftp');
const { createTerminal } = require('../src/main/terminal');
const { startSshServer } = require('./helpers/ssh-server');

const until = async (fn, ms = 5000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('zaman aşımı: ' + fn);
    await new Promise((r) => setTimeout(r, 10));
  }
};
async function withTerm(opts, fn) {
  const s = await startSshServer(opts);
  const out = [];
  const states = [];
  const cfg = { host: '127.0.0.1', port: s.port, user: s.user, password: s.password, fingerprint: s.fingerprint, ...opts.cfg };
  const term = createTerminal({ connect: () => connectSsh(cfg), onData: (d) => out.push(Buffer.from(d)), onState: (st) => states.push(st.state) });
  const text = () => Buffer.concat(out).toString();
  try {
    await fn({ s, term, text, states });
  } finally {
    term.close();
    await s.stop();
  }
}

test('terminal: sunucu klasöründe başlar, yazılan geri okunur, boyut sunucuya ulaşır', () => withTerm({}, async ({ s, term, text, states }) => {
  await term.start({ cols: 90, rows: 20, cwd: '/public_html/alt klasör' });
  await until(() => text().includes('hazir'));
  assert.deepStrictEqual(states, ['starting', 'open']);
  assert.deepStrictEqual(s.size, [90, 20]);
  assert.ok(s.commands[0].startsWith('exec /bin/sh -c ') && s.commands[0].endsWith(" sh '/public_html/alt klasör'"), s.commands[0]);
  term.write('merhaba');
  await until(() => text().includes('merhaba'));
  term.resize(120, 40);
  await until(() => s.size[0] === 120 && s.size[1] === 40);
  const snap = term.snapshot();
  assert.strictEqual(snap.state, 'open');
  assert.ok(snap.data.toString().includes('hazir') && snap.data.toString().includes('merhaba'));
}));

test('terminal: kabuk bitince closed olur ve yeniden başlatılabilir', () => withTerm({}, async ({ s, term, text, states }) => {
  await term.start({ cols: 80, rows: 24, cwd: '/' });
  await until(() => text().includes('hazir'));
  term.write('exit\r');
  await until(() => states.at(-1) === 'closed');
  await until(() => s.conns() === 0);
  await term.start({ cols: 80, rows: 24, cwd: '/' });
  await until(() => states.at(-1) === 'open');
  assert.strictEqual(s.shells, 2);
  assert.ok(!term.snapshot().data.toString().includes('exit'), 'yeni oturum eski çıktıyı taşımaz');
}));

test('terminal: kabuk erişimi kapalıysa refused ve düz bir cümle', () => withTerm({ shell: 'refuse' }, async ({ s, term, states }) => {
  await term.start({ cols: 80, rows: 24, cwd: '/' });
  await until(() => states.at(-1) === 'refused');
  assert.match(term.snapshot().message, /kabuk/i);
  await until(() => s.conns() === 0);
}));

test('terminal: close bağlantıyı kapatır; bağlanamazsa closed ve neden', () => withTerm({ cfg: {} }, async ({ s, term, text, states }) => {
  await term.start({ cols: 80, rows: 24, cwd: '/' });
  await until(() => text().includes('hazir'));
  term.close();
  await until(() => s.conns() === 0);
  assert.strictEqual(states.at(-1), 'idle');
  const bad = createTerminal({ connect: () => connectSsh({ host: '127.0.0.1', port: s.port, user: 'test', password: 'yanlis', fingerprint: s.fingerprint }), onData: () => {}, onState: () => {} });
  await bad.start({ cols: 80, rows: 24, cwd: '/' });
  assert.strictEqual(bad.snapshot().state, 'closed');
  assert.match(bad.snapshot().message, /şifre/i);
}));

test('terminal: çıktı tamponu son 1 MB ile sınırlı', () => withTerm({}, async ({ term, text }) => {
  await term.start({ cols: 80, rows: 24, cwd: '/' });
  await until(() => text().includes('hazir'));
  const chunk = 'x'.repeat(64 * 1024);
  for (let i = 0; i < 24; i++) term.write(chunk);
  await until(() => text().length >= 24 * 64 * 1024, 20000);
  const size = term.snapshot().data.length;
  assert.ok(size <= 1024 * 1024 + 64 * 1024 && size >= 1024 * 1024 - 64 * 1024, String(size));
}));

test('terminal: tırnak, ters bölü ya da satır sonu içeren klasör adı komuta girmez', async () => {
  for (const cwd of ["/a'b", '/a\\b', '/a\nb', '/a!b']) {
    await withTerm({}, async ({ s, term, states }) => {
      await term.start({ cols: 80, rows: 24, cwd });
      await until(() => states.at(-1) === 'open');
      assert.ok(s.commands[0].endsWith(" sh '.'"), s.commands[0]);
    });
  }
});

test('terminal: komut beklerken bağlantı koparsa ana süreç düşmez, durum closed olur', () => withTerm({ shell: 'drop' }, async ({ term, states }) => {
  await term.start({ cols: 80, rows: 24, cwd: '/' });
  await until(() => states.at(-1) === 'closed');
  await new Promise((r) => setTimeout(r, 100));
}));

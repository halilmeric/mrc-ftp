// Testler için yerel SSH sunucusu: SFTP (geçici bir klasör üzerinde) ve yankı yapan bir kabuk.
// Elle: node test/helpers/ssh-server.js [--port 2222]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Server, utils } = require('ssh2');

const { STATUS_CODE: ST, flagsToString } = utils.sftp;
const attrsOf = (st) => ({ mode: st.mode, uid: st.uid, gid: st.gid, size: st.size, atime: Math.floor(st.atimeMs / 1000), mtime: Math.floor(st.mtimeMs / 1000) });
const codeOf = (err) => (err.code === 'ENOENT' ? ST.NO_SUCH_FILE : err.code === 'EACCES' ? ST.PERMISSION_DENIED : ST.FAILURE);

function serveSftp(sftp, root, slow) {
  const real = (p) => path.join(root, path.posix.normalize('/' + p));
  const handles = new Map();
  let seq = 0;
  const open = (value) => { const h = Buffer.alloc(4); h.writeUInt32BE(++seq); handles.set(seq, value); return h; };
  const get = (h) => handles.get(h.readUInt32BE(0));
  const later = (fn) => (slow ? setTimeout(fn, slow) : fn());
  // Her istek: işi yap, hata olursa durum koduyla yanıtla.
  const on = (name, fn) => sftp.on(name, (id, ...args) => {
    try {
      fn(id, ...args);
    } catch (err) {
      sftp.status(id, codeOf(err));
    }
  });
  const ok = (id) => sftp.status(id, ST.OK);

  on('REALPATH', (id, p) => sftp.name(id, [{ filename: path.posix.normalize('/' + p), longname: '', attrs: {} }]));
  on('OPEN', (id, file, flags, attrs) => sftp.handle(id, open({ fd: fs.openSync(real(file), flagsToString(flags), attrs.mode || 0o644) })));
  on('READ', (id, h, offset, length) => {
    const buf = Buffer.alloc(length);
    const n = fs.readSync(get(h).fd, buf, 0, length, offset);
    later(() => (n === 0 ? sftp.status(id, ST.EOF) : sftp.data(id, buf.subarray(0, n))));
  });
  on('WRITE', (id, h, offset, data) => {
    fs.writeSync(get(h).fd, data, 0, data.length, offset);
    later(() => ok(id));
  });
  on('CLOSE', (id, h) => {
    const v = get(h);
    if (v && v.fd != null) fs.closeSync(v.fd);
    handles.delete(h.readUInt32BE(0));
    ok(id);
  });
  on('FSTAT', (id, h) => sftp.attrs(id, attrsOf(fs.fstatSync(get(h).fd))));
  on('STAT', (id, p) => sftp.attrs(id, attrsOf(fs.statSync(real(p)))));
  on('LSTAT', (id, p) => sftp.attrs(id, attrsOf(fs.lstatSync(real(p)))));
  on('SETSTAT', (id, p, attrs) => { if (attrs.mode != null) fs.chmodSync(real(p), attrs.mode & 0o777); ok(id); });
  on('FSETSTAT', (id) => ok(id));
  on('OPENDIR', (id, p) => {
    const dir = real(p);
    const names = fs.readdirSync(dir);
    sftp.handle(id, open({ list: ['.', '..', ...names].map((n) => ({ filename: n, longname: n, attrs: attrsOf(fs.lstatSync(path.join(dir, n))) })) }));
  });
  on('READDIR', (id, h) => {
    const v = get(h);
    if (!v.list) return sftp.status(id, ST.EOF);
    sftp.name(id, v.list);
    v.list = null;
  });
  on('MKDIR', (id, p) => { fs.mkdirSync(real(p)); ok(id); });
  on('RMDIR', (id, p) => { fs.rmdirSync(real(p)); ok(id); });
  on('REMOVE', (id, p) => { fs.unlinkSync(real(p)); ok(id); });
  // OpenSSH gibi: hedef varsa taşıma reddedilir.
  on('RENAME', (id, from, to) => {
    if (fs.existsSync(real(to))) return sftp.status(id, ST.FAILURE);
    fs.renameSync(real(from), real(to));
    ok(id);
  });
}

function startSshServer({ files = {}, slow = 0, shell = 'echo', port = 0 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mrc-ssh-root-'));
  for (const [name, body] of Object.entries(files)) {
    const full = path.join(root, name);
    if (name.endsWith('/')) fs.mkdirSync(full, { recursive: true });
    else { fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, body); }
  }
  const host = utils.generateKeyPairSync('ed25519');
  const plain = utils.generateKeyPairSync('ed25519');
  const locked = utils.generateKeyPairSync('ed25519', { passphrase: 'gizli', cipher: 'aes256-ctr', rounds: 4 });
  const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrc-ssh-keys-'));
  fs.writeFileSync(path.join(keyDir, 'id_plain'), plain.private, { mode: 0o600 });
  fs.writeFileSync(path.join(keyDir, 'id_locked'), locked.private, { mode: 0o600 });
  const allowed = [plain, locked].map((k) => utils.parseKey(k.public));
  const hostBlob = utils.parseKey(host.public).getPublicSSH();

  const state = {
    root, user: 'test', password: 'test', passphrase: 'gizli',
    clientKey: path.join(keyDir, 'id_plain'), lockedKey: path.join(keyDir, 'id_locked'),
    fingerprint: 'SHA256:' + crypto.createHash('sha256').update(hostBlob).digest('base64').replace(/=+$/, ''),
    auths: 0, commands: [], size: null, shells: 0,
  };
  const socks = new Set();

  const srv = new Server({ hostKeys: [host.private] }, (client) => {
    client.on('error', () => {});
    client.on('authentication', (ctx) => {
      if (ctx.method === 'none') return ctx.reject(['password', 'publickey']);
      state.auths += 1;
      if (ctx.username !== 'test') return ctx.reject();
      if (ctx.method === 'password') return ctx.password === 'test' ? ctx.accept() : ctx.reject();
      if (ctx.method === 'publickey') {
        const key = allowed.find((k) => k.type === ctx.key.algo && k.getPublicSSH().equals(ctx.key.data));
        if (!key) return ctx.reject();
        if (ctx.signature && key.verify(ctx.blob, ctx.signature, ctx.hashAlgo) !== true) return ctx.reject();
        return ctx.accept();
      }
      return ctx.reject();
    });
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        session.on('sftp', (acc) => serveSftp(acc(), root, slow));
        session.on('pty', (acc, rej, info) => { state.size = [info.cols, info.rows]; if (acc) acc(); });
        session.on('window-change', (acc, rej, info) => { state.size = [info.cols, info.rows]; if (acc) acc(); });
        const run = (acc, rej, info) => {
          if (shell === 'refuse') return rej();
          state.shells += 1;
          state.commands.push(info ? info.command : null);
          const stream = acc();
          stream.write('hazir\r\n');
          stream.on('data', (d) => {
            if (String(d) === 'exit\r') { stream.exit(0); stream.end(); } else stream.write(d);
          });
        };
        session.on('shell', run);
        session.on('exec', run);
      });
    });
  });
  srv.on('connection', () => {});

  return new Promise((resolve) => {
    srv.listen(port, '127.0.0.1', function listening() {
      state.port = this.address().port;
      srv._srv.on('connection', (sock) => { socks.add(sock); sock.on('close', () => socks.delete(sock)); });
      state.drop = () => { for (const s of socks) s.destroy(); };
      state.conns = () => socks.size;
      state.stop = () => new Promise((res) => { state.drop(); srv.close(() => res()); });
      resolve(state);
    });
  });
}

module.exports = { startSshServer };

if (require.main === module) {
  const args = process.argv.slice(2);
  const port = Number(args[args.indexOf('--port') + 1]) || 2222;
  startSshServer({ port, files: { 'public_html/index.html': '<h1>merhaba</h1>', 'public_html/görseller/': null } })
    .then((s) => console.log(`SSH 127.0.0.1:${s.port}  kullanıcı: test  şifre: test  anahtar: ${s.clientKey}  parolalı: ${s.lockedKey} (gizli)  kök: ${s.root}`));
}

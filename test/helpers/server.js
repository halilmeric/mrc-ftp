// Testler için yerel FTP sunucusu. Elle: node test/helpers/server.js [--tls] [--port 2121]
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Transform } = require('node:stream');
const { FtpSrv, FileSystem } = require('ftp-srv');
const { tmpDir } = require('./tmp');

const quiet = { child() { return quiet; }, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} };

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});

// Yüklemeyi yavaşlatır: aktarımın ortasında iptal ve kopma denenebilsin.
class SlowFs extends FileSystem {
  constructor(conn, opts, delay) { super(conn, opts); this.delay = delay; }
  write(name, opts) {
    const real = super.write(name, opts);
    const delay = this.delay;
    const slow = new Transform({ transform(chunk, enc, cb) { setTimeout(() => cb(null, chunk), delay); } });
    slow.once('close', () => slow.end());
    slow.pipe(real.stream);
    // ftp-srv yükleme biter bitmez akışı yok eder; gecikmeli son parça diske yazılmadan kaybolmasın.
    const destroy = slow.destroy.bind(slow);
    slow.destroy = (err) => (slow.writableFinished && !err ? slow : destroy(err));
    return { stream: slow, clientPath: real.clientPath };
  }
  async read(name, opts) {
    const real = await super.read(name, opts);
    const delay = this.delay;
    const slow = new Transform({ transform(chunk, enc, cb) { setTimeout(() => cb(null, chunk), delay); } });
    real.stream.on('error', (err) => slow.destroy(err));
    real.stream.pipe(slow);
    return { stream: slow, clientPath: real.clientPath };
  }
}

let certCache;
function selfSigned() {
  if (certCache) return certCache;
  const dir = tmpDir('mrc-cert-');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=baska-ad.test',
    '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem')], { stdio: 'ignore' });
  const cert = fs.readFileSync(path.join(dir, 'c.pem'));
  certCache = { key: fs.readFileSync(path.join(dir, 'k.pem')), cert, fingerprint: new crypto.X509Certificate(cert).fingerprint256 };
  return certCache;
}

async function startServer({ tls = false, files = {}, port, slow = 0 } = {}) {
  const root = tmpDir('mrc-ftp-root-');
  for (const [name, body] of Object.entries(files)) {
    const full = path.join(root, name);
    if (name.endsWith('/')) fs.mkdirSync(full, { recursive: true });
    else { fs.mkdirSync(path.dirname(full), { recursive: true }); fs.writeFileSync(full, body); }
  }
  port = port || await freePort();
  const pem = tls ? selfSigned() : null;
  const srv = new FtpSrv({
    url: `ftp://127.0.0.1:${port}`, pasv_url: '127.0.0.1', anonymous: false, log: quiet,
    tls: pem ? { key: pem.key, cert: pem.cert } : false,
  });
  const state = { port, root, user: 'test', password: 'test', fingerprint: pem ? pem.fingerprint : null, logins: 0 };
  const conns = new Set();
  srv.on('login', ({ connection, username, password }, resolve, reject) => {
    state.logins += 1;
    conns.add(connection);
    if (username === 'test' && password === 'test') resolve(slow ? { fs: new SlowFs(connection, { root, cwd: '/' }, slow) } : { root });
    else reject(new Error('Login incorrect'));
  });
  srv.on('client-error', () => {});
  await srv.listen();
  state.drop = () => {
    for (const c of conns) {
      c.connector?.dataSocket?.destroy();
      c.commandSocket?.destroy();
    }
    conns.clear();
  };
  state.stop = () => { state.drop(); return srv.close(); };
  return state;
}

module.exports = { startServer };

if (require.main === module) {
  const args = process.argv.slice(2);
  const port = Number(args[args.indexOf('--port') + 1]) || 2121;
  startServer({ tls: args.includes('--tls'), port, files: { 'public_html/index.html': '<h1>merhaba</h1>', 'public_html/görseller/': null } })
    .then((s) => console.log(`FTP 127.0.0.1:${s.port}  kullanıcı: test  şifre: test  kök: ${s.root}`));
}

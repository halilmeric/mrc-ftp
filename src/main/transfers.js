const fs = require('node:fs');
const path = require('node:path');

const PART = '.mrcftp-part';
const FINISHED = ['done', 'skipped', 'cancelled'];
const NO_RETRY = ['AUTH', 'CERT']; // yeniden denemek hesabı kilitleyebilir ya da anlamsızdır

// Aktarım kuyruğu: aynı anda tek iş, kendi FTP oturumu. Soru bekleyen iş kuyruğu tutmaz.
function createQueue({ openSession, onChange }) {
  const jobs = [];
  const policy = { up: null, down: null }; // "hepsine uygula" seçimi
  const known = new Map(); // uzak klasör -> ad kümesi (çakışma kontrolü için)
  let session = null;
  let sessionPromise = null;
  let pumping = false;
  let closing = false;
  let nextId = 1;
  let timer = null;
  let lastEmit = 0;

  const snapshot = () => jobs.map(({ id, direction, name, localPath, remotePath, state, bytes, total, speed, error }) =>
    ({ id, direction, name, localPath, remotePath, state, bytes, total, speed, error }));

  const emitNow = () => {
    clearTimeout(timer);
    timer = null;
    if (closing) return;
    lastEmit = Date.now();
    onChange(snapshot());
  };
  // İlerleme saniyede en çok 5 kez bildirilir; durum değişimi hemen.
  const emitSoon = () => {
    const wait = 200 - (Date.now() - lastEmit);
    if (wait <= 0) emitNow();
    else if (!timer) timer = setTimeout(emitNow, wait);
  };

  // Eşzamanlı çağrılar tek oturumu paylaşır; açılamazsa bir sonraki çağrı yeniden dener.
  const getSession = () => {
    if (!sessionPromise) {
      sessionPromise = openSession().then((ses) => { session = ses; return ses; }, (err) => { sessionPromise = null; throw err; });
    }
    return sessionPromise;
  };

  const remoteNames = async (dir) => {
    if (!known.has(dir)) known.set(dir, new Set((await (await getSession()).list(dir)).map((e) => e.name)));
    return known.get(dir);
  };

  const push = (direction, localPath, remotePath, total) => {
    jobs.push({
      id: nextId++, direction, localPath, remotePath, total,
      name: path.basename(direction === 'up' ? localPath : remotePath),
      state: 'queued', bytes: 0, speed: 0, error: null, decision: null,
      cancelRequested: false, started: false, keepPart: false, samples: [],
    });
  };

  const describe = (err) => {
    if (err && ['FTP', 'AUTH', 'CERT'].includes(err.code)) return err.message;
    if (err && err.syscall) return 'Mac\'teki dosya okunamadı ya da yazılamadı.';
    return 'Bağlantı koptu, dosya aktarılmadı.';
  };

  const mkdirRemote = async (dir) => {
    const ses = await getSession();
    try {
      await ses.mkdir(dir);
    } catch (err) {
      if (err.code !== 'FTP') throw err; // zaten var
    }
    known.delete(path.posix.dirname(dir));
  };

  async function expandUp(localDir, remoteDir) {
    await mkdirRemote(remoteDir);
    for (const ent of fs.readdirSync(localDir, { withFileTypes: true })) {
      if (ent.name === '.DS_Store' || ent.isSymbolicLink()) continue;
      const lp = path.join(localDir, ent.name);
      const rp = path.posix.join(remoteDir, ent.name);
      if (ent.isDirectory()) await expandUp(lp, rp);
      else if (ent.isFile()) push('up', lp, rp, fs.statSync(lp).size);
    }
  }

  async function expandDown(remoteDir, localDir) {
    const ses = await getSession();
    fs.mkdirSync(localDir, { recursive: true });
    for (const ent of await ses.list(remoteDir)) {
      const rp = path.posix.join(remoteDir, ent.name);
      const lp = path.join(localDir, ent.name);
      if (ent.isDir) await expandDown(rp, lp);
      else push('down', lp, rp, ent.size);
    }
  }

  async function targetExists(job) {
    if (job.direction === 'down') return fs.existsSync(job.localPath);
    return (await remoteNames(path.posix.dirname(job.remotePath))).has(job.name);
  }

  const cleanupPart = async (job) => {
    try {
      if (job.direction === 'down') fs.rmSync(job.localPath + PART, { force: true });
      else await (await getSession()).remove(job.remotePath + PART, false);
    } catch {
      // geçici dosya hiç oluşmamış olabilir
    }
  };

  // Geçici dosyayı asıl adına taşır. Taşıma reddedilirse asıl dosyaya ancak geçici dosyanın
  // hâlâ yerinde olduğu görüldükten sonra dokunulur; aksi halde tamamlanmış ya da tek kalan kopya silinebilir.
  async function moveIntoPlace(job) {
    const ses = await getSession();
    const part = job.remotePath + PART;
    try {
      await ses.rename(part, job.remotePath);
      return;
    } catch (err) {
      if (err.code !== 'FTP') throw err;
      const entries = await (await getSession()).list(path.posix.dirname(job.remotePath));
      const names = new Set(entries.map((e) => e.name));
      if (!names.has(job.name + PART)) {
        // Geçici dosya yok. Hedef yüklenen dosyanın boyutundaysa taşıma olmuş, yalnızca yanıt kaybolmuştur;
        // değilse geçici dosya sunucuda kaybolmuştur ve eski dosyaya dokunulmaz.
        const target = entries.find((e) => e.name === job.name);
        if (target && target.size === job.total) return;
        throw err;
      }
      // Bazı sunucular var olan dosyanın üzerine taşımaz: önce eskiyi kaldır.
      job.keepPart = true; // bundan sonra geçici dosya yüklenen tek kopya olabilir
      if (names.has(job.name)) await ses.remove(job.remotePath, false);
      await ses.rename(part, job.remotePath);
      job.keepPart = false;
    }
  }

  async function transfer(job) {
    const ses = await getSession();
    job.started = true;
    // run() kopan bağlantıda işlemi kendiliğinden yineler; aktarımda bunu istemiyoruz, hatayı değer olarak döndürürüz.
    const failure = await ses.run(async (client) => {
      client.trackProgress((info) => {
        job.bytes = info.bytes;
        const now = Date.now();
        job.samples.push([now, info.bytes]);
        while (job.samples.length > 1 && now - job.samples[0][0] > 2000) job.samples.shift();
        const [t0, b0] = job.samples[0];
        job.speed = now > t0 ? Math.round(((info.bytes - b0) * 1000) / (now - t0)) : 0;
        emitSoon();
      });
      try {
        if (job.direction === 'up') await client.uploadFrom(job.localPath, job.remotePath + PART);
        else await client.downloadTo(job.localPath + PART, job.remotePath);
        return null;
      } catch (err) {
        return err;
      } finally {
        client.trackProgress();
      }
    });
    if (failure) throw failure;
    if (job.cancelRequested) throw new Error('iptal');

    if (job.direction === 'down') {
      fs.renameSync(job.localPath + PART, job.localPath);
    } else {
      await moveIntoPlace(job);
      const names = known.get(path.posix.dirname(job.remotePath));
      if (names) names.add(job.name);
    }
  }

  async function runJob(job) {
    try {
      if (job.decision !== 'overwrite' && await targetExists(job)) {
        const choice = policy[job.direction];
        if (choice === 'skip') { job.state = 'skipped'; return; }
        if (choice !== 'overwrite') { job.state = 'asking'; return; }
      }
      Object.assign(job, { state: 'active', bytes: 0, samples: [], started: false, keepPart: false });
      emitNow();
      await transfer(job);
      job.bytes = job.total || job.bytes;
      job.total = job.total || job.bytes;
      job.speed = 0;
      job.state = 'done';
    } catch (err) {
      // Giriş yapılamıyorsa temizlik için yeniden bağlanmak yalnızca yeni bir başarısız giriş demektir.
      const noRetry = err && NO_RETRY.includes(err.code);
      if (job.started && !job.keepPart && !noRetry) await cleanupPart(job);
      job.speed = 0;
      if (job.cancelRequested) {
        job.state = 'cancelled';
      } else {
        job.state = 'error';
        job.error = job.keepPart ? `Dosya yüklendi ama yerine taşınamadı; sunucuda ${job.name}${PART} adıyla duruyor.` : describe(err);
        if (noRetry) {
          for (const other of jobs) if (other.state === 'queued') Object.assign(other, { state: 'error', error: job.error });
        }
      }
    }
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (!closing) {
        const job = jobs.find((j) => j.state === 'queued');
        if (!job) break;
        await runJob(job);
        emitNow();
      }
    } finally {
      pumping = false;
      if (closing && session) session.close();
    }
    if (!jobs.some((j) => j.state === 'asking')) known.clear();
  }

  return {
    jobs: snapshot,

    async add({ direction, localPath, remotePath, isDir, size }) {
      if (closing) return;
      try {
        if (!isDir) push(direction, localPath, remotePath, direction === 'up' ? fs.statSync(localPath).size : (size || 0));
        else if (direction === 'up') await expandUp(localPath, remotePath);
        else await expandDown(remotePath, localPath);
      } catch (err) {
        push(direction, localPath, remotePath, 0);
        const job = jobs[jobs.length - 1];
        job.state = 'error';
        job.error = err && err.syscall ? 'Klasör okunamadı.' : describe(err);
      }
      emitNow();
      pump();
    },

    cancel(id) {
      const job = jobs.find((j) => j.id === id);
      if (!job || FINISHED.includes(job.state)) return;
      if (job.state === 'active') {
        job.cancelRequested = true;
        if (session) session.client.close(); // aktarım hata ile döner, runJob "iptal" olarak işaretler
        return;
      }
      job.state = 'cancelled';
      emitNow();
    },

    retry(id) {
      const job = jobs.find((j) => j.id === id);
      if (!job || !['error', 'cancelled'].includes(job.state)) return;
      Object.assign(job, { state: 'queued', bytes: 0, error: null, cancelRequested: false });
      emitNow();
      pump();
    },

    answer(id, choice, applyAll) {
      const job = jobs.find((j) => j.id === id);
      if (!job || job.state !== 'asking') return;
      const targets = applyAll ? jobs.filter((j) => j.state === 'asking' && j.direction === job.direction) : [job];
      if (applyAll) policy[job.direction] = choice;
      for (const j of targets) {
        if (choice === 'overwrite') Object.assign(j, { decision: 'overwrite', state: 'queued' });
        else j.state = 'skipped';
      }
      emitNow();
      pump();
    },

    clearFinished() {
      for (let i = jobs.length - 1; i >= 0; i--) if (FINISHED.includes(jobs[i].state)) jobs.splice(i, 1);
      if (jobs.length === 0) { policy.up = null; policy.down = null; }
      emitNow();
    },

    // Bağlantı kesilirken: bildirimler durur, süren aktarım iptal edilir. Oturum, geçici dosya
    // temizlendikten sonra pump() çıkarken kapanır; süren iş yoksa hemen.
    close() {
      closing = true;
      clearTimeout(timer);
      for (const j of jobs) if (j.state === 'active') j.cancelRequested = true;
      if (pumping) {
        if (session) session.client.close();
      } else if (sessionPromise) {
        sessionPromise.then((ses) => ses.close(), () => {});
      }
    },
  };
}

module.exports = { createQueue, PART };

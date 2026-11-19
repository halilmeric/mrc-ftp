const fs = require('node:fs');
const path = require('node:path');

const PART = '.mrcftp-part';
const FINISHED = ['done', 'skipped', 'cancelled'];

// Aktarım kuyruğu: aynı anda tek iş, kendi FTP oturumu. Soru bekleyen iş kuyruğu tutmaz.
function createQueue({ openSession, onChange }) {
  const jobs = [];
  const policy = { up: null, down: null }; // "hepsine uygula" seçimi
  const known = new Map(); // uzak klasör -> ad kümesi (çakışma kontrolü için)
  let session = null;
  let pumping = false;
  let nextId = 1;
  let timer = null;
  let lastEmit = 0;

  const snapshot = () => jobs.map(({ id, direction, name, localPath, remotePath, state, bytes, total, speed, error }) =>
    ({ id, direction, name, localPath, remotePath, state, bytes, total, speed, error }));

  const emitNow = () => {
    clearTimeout(timer);
    timer = null;
    lastEmit = Date.now();
    onChange(snapshot());
  };
  // İlerleme saniyede en çok 5 kez bildirilir; durum değişimi hemen.
  const emitSoon = () => {
    const wait = 200 - (Date.now() - lastEmit);
    if (wait <= 0) emitNow();
    else if (!timer) timer = setTimeout(emitNow, wait);
  };

  const getSession = async () => {
    if (!session) session = await openSession();
    return session;
  };

  const remoteNames = async (dir) => {
    if (!known.has(dir)) {
      const ses = await getSession();
      known.set(dir, new Set((await ses.list(dir)).map((e) => e.name)));
    }
    return known.get(dir);
  };

  const push = (direction, localPath, remotePath, total) => {
    jobs.push({
      id: nextId++, direction, localPath, remotePath, total,
      name: path.basename(direction === 'up' ? localPath : remotePath),
      state: 'queued', bytes: 0, speed: 0, error: null, decision: null, cancelRequested: false, samples: [],
    });
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

  async function transfer(job) {
    const ses = await getSession();
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

    if (job.direction === 'down') {
      fs.renameSync(job.localPath + PART, job.localPath);
    } else {
      try {
        await ses.rename(job.remotePath + PART, job.remotePath);
      } catch (err) {
        if (err.code !== 'FTP') throw err;
        // Bazı sunucular var olan dosyanın üzerine taşımaz: önce eskiyi kaldır.
        await ses.remove(job.remotePath, false);
        await ses.rename(job.remotePath + PART, job.remotePath);
      }
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
      job.state = 'active';
      job.bytes = 0;
      job.samples = [];
      emitNow();
      await transfer(job);
      job.bytes = job.total || job.bytes;
      job.total = job.total || job.bytes;
      job.speed = 0;
      job.state = 'done';
    } catch (err) {
      await cleanupPart(job);
      job.speed = 0;
      if (job.cancelRequested) {
        job.state = 'cancelled';
      } else {
        job.state = 'error';
        job.error = err && err.code === 'FTP' ? err.message
          : err && err.code === 'AUTH' ? err.message
            : 'Bağlantı koptu, dosya aktarılmadı.';
      }
    }
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      for (;;) {
        const job = jobs.find((j) => j.state === 'queued');
        if (!job) break;
        await runJob(job);
        emitNow();
      }
    } finally {
      pumping = false;
    }
    if (!jobs.some((j) => j.state === 'asking')) known.clear();
  }

  return {
    jobs: snapshot,

    async add({ direction, localPath, remotePath, isDir, size }) {
      try {
        if (!isDir) push(direction, localPath, remotePath, direction === 'up' ? fs.statSync(localPath).size : (size || 0));
        else if (direction === 'up') await expandUp(localPath, remotePath);
        else await expandDown(remotePath, localPath);
      } catch (err) {
        push(direction, localPath, remotePath, 0);
        const job = jobs[jobs.length - 1];
        job.state = 'error';
        job.error = (err && err.code && err.message) || 'Klasör okunamadı.';
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

    close() {
      clearTimeout(timer);
      for (const j of jobs) if (j.state === 'active') j.cancelRequested = true;
      if (session) session.close();
      session = null;
      jobs.length = 0;
      known.clear();
    },
  };
}

module.exports = { createQueue, PART };

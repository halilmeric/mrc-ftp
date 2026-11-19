const fs = require('node:fs');
const path = require('node:path');

const PART = '.mrcftp-part';
const FINISHED = ['done', 'skipped', 'cancelled'];
const NO_RETRY = ['AUTH', 'CERT']; // yeniden denemek hesabı kilitleyebilir ya da anlamsızdır

// Aktarım kuyruğu: aynı anda tek iş, kendi oturumu (FTP ya da SFTP). Soru bekleyen iş kuyruğu tutmaz.
function createQueue({ openSession, onChange, onUploaded }) {
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

  const snapshot = () => jobs.map(({ id, direction, name, localPath, remotePath, state, bytes, total, speed, error, note }) =>
    ({ id, direction, name, localPath, remotePath, state, bytes, total, speed, error, note }));

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

  const push = (direction, localPath, remotePath, total, modified = null) => {
    jobs.push({
      id: nextId++, direction, localPath, remotePath, total,
      name: path.basename(direction === 'up' ? localPath : remotePath),
      state: 'queued', bytes: 0, speed: 0, error: null, decision: null,
      cancelRequested: false, started: false, keepPart: false, samples: [],
      resumable: false, sourceMark: null, offset: 0, remoteModified: modified, baseline: null, note: null,
    });
  };

  const describe = (err) => {
    if (err && ['FTP', 'AUTH', 'CERT'].includes(err.code)) return err.message;
    if (err && typeof err.code === 'number') return 'Sunucu işlemi reddetti: ' + String(err.message).replace(/^\d+[ -]/, '');
    if (err && err.syscall && err.path) return 'Mac\'teki dosya okunamadı ya da yazılamadı.'; // soket hataları da syscall taşır, path taşımaz
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
      if (ent.isDir && ent.link) continue; // klasöre giden bağ: döngüye ve çift indirmeye yol açar
      if (ent.isDir) await expandDown(rp, lp);
      else push('down', lp, rp, ent.size, ent.modified);
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

  // Kaynağın "aynı dosya mı" izi: boyut + değişme zamanı. Sürdürme ancak iz değişmediyse yapılır.
  async function sourceMarkOf(job, fresh) {
    if (job.direction === 'up') {
      const st = fs.statSync(job.localPath);
      return `${st.size}:${st.mtimeMs}`;
    }
    // Değişme zamanı çağırandan geldiyse ilk denemede listeye gitmeye gerek yok.
    if (!fresh && job.remoteModified != null) return `${job.total}:${job.remoteModified}`;
    const ent = (await (await getSession()).list(path.posix.dirname(job.remotePath))).find((e) => e.name === job.name);
    return ent ? `${ent.size}:${ent.modified}` : null;
  }

  async function partSizeOf(job) {
    if (job.direction === 'down') {
      try { return fs.statSync(job.localPath + PART).size; } catch { return 0; }
    }
    const ent = (await (await getSession()).list(path.posix.dirname(job.remotePath))).find((e) => e.name === job.name + PART);
    return ent ? ent.size : 0;
  }

  // Önceki deneme koptuysa ve kaynak aynıysa geçici dosyanın bittiği bayttan devam edilir; değilse baştan.
  async function resumeOffset(job) {
    const wasResumable = job.resumable;
    const mark = await sourceMarkOf(job, wasResumable);
    let offset = 0;
    if (wasResumable) {
      const size = await partSizeOf(job);
      if (mark && mark === job.sourceMark && size > 0 && size < job.total) offset = size;
      else await cleanupPart(job);
    }
    job.sourceMark = mark;
    job.resumable = false;
    return offset;
  }

  async function transfer(job, offset) {
    const ses = await getSession();
    job.started = true;
    const onProgress = (bytes) => {
      job.bytes = offset + bytes;
      const now = Date.now();
      job.samples.push([now, bytes]);
      while (job.samples.length > 1 && now - job.samples[0][0] > 2000) job.samples.shift();
      const [t0, b0] = job.samples[0];
      job.speed = now > t0 ? Math.round(((bytes - b0) * 1000) / (now - t0)) : 0;
      emitSoon();
    };
    if (job.direction === 'down') await ses.download(job.remotePath, job.localPath + PART, { offset, onProgress });
    else await ses.upload(job.localPath, job.remotePath + PART, { offset, onProgress });
    if (job.cancelRequested) throw new Error('iptal');

    if (job.direction === 'down') {
      fs.renameSync(job.localPath + PART, job.localPath);
    } else {
      await moveIntoPlace(job);
      const names = known.get(path.posix.dirname(job.remotePath));
      if (names) names.add(job.name);
      if (job.baseline && onUploaded) {
        const now = await remoteEntry(job);
        if (now) {
          const base = { size: now.size, modified: now.modified };
          for (const other of jobs) if (other.baseline && other.remotePath === job.remotePath) other.baseline = base;
          onUploaded(job.remotePath, base);
        }
      }
    }
  }

  const remoteEntry = async (job) => (await (await getSession()).list(path.posix.dirname(job.remotePath))).find((e) => e.name === job.name);

  async function runJob(job) {
    try {
      if (job.baseline) {
        // Düzenlenen dosyanın geri yüklenmesi: sunucudaki dosya indirdiğimizle aynıysa sormadan yazılır,
        // arada değiştiyse "hepsine uygula" seçimine bakılmadan sorulur.
        const now = job.decision === 'overwrite' ? null : await remoteEntry(job);
        if (now && (now.size !== job.baseline.size || now.modified !== job.baseline.modified)) {
          job.note = 'Dosya sen düzenlerken sunucuda değişmiş';
          job.state = 'asking';
          return;
        }
      } else if (job.decision !== 'overwrite' && await targetExists(job)) {
        const choice = policy[job.direction];
        if (choice === 'skip') { job.state = 'skipped'; return; }
        if (choice !== 'overwrite') { job.state = 'asking'; return; }
      }
      // Geçici dosya hedefe göre adlandırılır: bu iş onu yeniden yazacağı için aynı hedefe giden
      // başka bir yarım iş artık oradan süremez.
      const sameTarget = (o) => o !== job && o.direction === job.direction && (job.direction === 'up' ? o.remotePath === job.remotePath : o.localPath === job.localPath);
      for (const other of jobs) if (sameTarget(other)) other.resumable = false;
      if (job.direction === 'up') job.total = fs.statSync(job.localPath).size; // kuyrukta beklerken dosya yeniden kaydedilmiş olabilir
      const offset = await resumeOffset(job);
      Object.assign(job, { state: 'active', bytes: offset, samples: [], started: false, keepPart: false });
      emitNow();
      try {
        await transfer(job, offset);
      } catch (err) {
        // Sunucu devam etmeyi (REST/APPE) reddettiyse sessizce baştan aktar.
        if (!(offset > 0 && typeof err.code === 'number' && !job.cancelRequested)) throw err;
        await cleanupPart(job);
        job.bytes = 0;
        await transfer(job, 0);
      }
      job.bytes = job.total || job.bytes;
      job.total = job.total || job.bytes;
      job.speed = 0;
      job.state = 'done';
    } catch (err) {
      // Giriş yapılamıyorsa temizlik için yeniden bağlanmak yalnızca yeni bir başarısız giriş demektir.
      const noRetry = err && NO_RETRY.includes(err.code);
      // Bağlantı koptuysa geçici dosya kalır ki "Yeniden dene" kaldığı yerden sürsün; iptalde silinir.
      const lostConnection = !job.cancelRequested && !noRetry && !(err && (err.code === 'FTP' || typeof err.code === 'number' || (err.syscall && err.path)));
      if (job.started && !job.keepPart && !noRetry) {
        if (lostConnection) job.resumable = true;
        else await cleanupPart(job);
      }
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

  // Artık sürdürülmeyecek yarım işin geçici dosyasını siler.
  const dropPart = (job) => {
    if (!job.resumable) return;
    job.resumable = false;
    cleanupPart(job);
  };
  const unsentEdits = () => jobs.filter((j) => j.baseline && !FINISHED.includes(j.state));

  // Kapanırken: yarım kalan geçici dosyalar temizlenir, sonra oturum kapanır.
  async function finalize() {
    for (const job of jobs) if (job.resumable) await cleanupPart(job);
    if (session) session.close();
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
      if (closing) finalize();
    }
    if (!jobs.some((j) => j.state === 'asking')) known.clear();
  }

  return {
    jobs: snapshot,

    async add({ direction, localPath, remotePath, isDir, size, modified, baseline }) {
      if (closing) return;
      try {
        if (isDir && direction === 'up') await expandUp(localPath, remotePath);
        else if (isDir) await expandDown(remotePath, localPath);
        else {
          // Aynı düzenlenen dosya için sırada bekleyen bir yükleme varsa yenisi gereksizdir: bekleyen iş dosyayı çalışırken okur.
          if (baseline && jobs.some((j) => j.baseline && j.remotePath === remotePath && j.state === 'queued')) return;
          push(direction, localPath, remotePath, direction === 'up' ? fs.statSync(localPath).size : (size || 0), modified);
          if (baseline) jobs[jobs.length - 1].baseline = baseline;
        }
      } catch (err) {
        push(direction, localPath, remotePath, 0);
        const job = jobs[jobs.length - 1];
        job.state = 'error';
        job.error = err && err.syscall && err.path ? 'Klasör okunamadı.' : describe(err);
      }
      emitNow();
      pump();
    },

    cancel(id) {
      const job = jobs.find((j) => j.id === id);
      if (!job || FINISHED.includes(job.state)) return;
      if (job.state === 'active') {
        job.cancelRequested = true;
        if (session) session.abort(); // aktarım hata ile döner, runJob "iptal" olarak işaretler
        return;
      }
      job.state = 'cancelled';
      dropPart(job);
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
      const all = applyAll && !job.baseline;
      const targets = all ? jobs.filter((j) => j.state === 'asking' && j.direction === job.direction && !j.baseline) : [job];
      if (all) policy[job.direction] = choice;
      for (const j of targets) {
        if (choice === 'overwrite') Object.assign(j, { decision: 'overwrite', state: 'queued' });
        else { j.state = 'skipped'; dropPart(j); }
      }
      emitNow();
      pump();
    },

    // Düzenlenip henüz sunucuya gitmemiş dosya sayısı.
    pendingEdits: () => unsentEdits().length,

    // Sırada ya da aktarımda olan düzenleme yüklemelerinin bitmesini bekler (soru ve hata bekleyenler beklenmez).
    // Dönen sayı: hâlâ gitmemiş düzenleme sayısı.
    async drainEdits(timeoutMs) {
      const end = Date.now() + timeoutMs;
      while (Date.now() < end && unsentEdits().some((j) => ['queued', 'active'].includes(j.state))) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return unsentEdits().length;
    },

    // Hata kartını kapatır: iş listeden çıkar, yarım geçici dosyası silinir.
    dismiss(id) {
      const index = jobs.findIndex((j) => j.id === id);
      if (index < 0 || ['active', 'queued'].includes(jobs[index].state)) return;
      const [job] = jobs.splice(index, 1);
      emitNow();
      if (job.resumable) cleanupPart(job);
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
        if (session) session.abort();
      } else if (sessionPromise) {
        sessionPromise.then(() => finalize(), () => {});
      }
    },
  };
}

module.exports = { createQueue, PART };

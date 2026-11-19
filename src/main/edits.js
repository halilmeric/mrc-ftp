const fs = require('node:fs');
const path = require('node:path');
const { FtpError } = require('./ftp');

const MAX_EDIT = 10 * 1024 * 1024;

// Sunucudaki dosyayı Mac'teki editörde düzenleme: dosya geçici klasöre iner, açılır ve izlenir;
// her kayıtta sunucuya geri yükleme kuyruğa eklenir.
function createEdits({ dir, getSession, enqueue, open, onChange, interval = 1000 }) {
  const items = new Map(); // uzak yol -> { localPath, remotePath, mark, baseline, timer }
  let seq = 0;

  const markOf = (file) => {
    const st = fs.statSync(file);
    return `${st.size}:${st.mtimeMs}`;
  };

  // Editörler çoğu zaman yeni dosya yazıp eskisinin yerine koyar; bu yüzden dosya olayı değil,
  // belirli aralıkla boyut ve değişme zamanı izlenir. Yer değiştirme anında dosya kısa süre yok olabilir.
  function check(item) {
    let mark;
    try {
      mark = markOf(item.localPath);
    } catch {
      return;
    }
    if (mark === item.mark) return;
    item.mark = mark;
    enqueue({ direction: 'up', localPath: item.localPath, remotePath: item.remotePath, isDir: false, baseline: item.baseline });
  }

  return {
    count: () => items.size,

    async start(remotePath, entry) {
      const name = path.posix.basename(remotePath);
      if (remotePath.split('/').includes('..') || !name || /[\\/]/.test(name)) throw new FtpError('LOCAL', 'Bu dosya düzenlemeye açılamıyor.');
      if (entry.size > MAX_EDIT) throw new FtpError('LOCAL', 'Düzenlemek için çok büyük, önce indir.');
      const existing = items.get(remotePath);
      if (existing) {
        await open(existing.localPath);
        return;
      }
      const localPath = path.join(dir, String(++seq), name);
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      const session = await getSession();
      await session.run((client) => client.downloadTo(localPath, remotePath));
      const item = { localPath, remotePath, mark: markOf(localPath), baseline: { size: entry.size, modified: entry.modified } };
      item.timer = setInterval(() => check(item), interval);
      items.set(remotePath, item);
      onChange(items.size);
      await open(localPath);
    },

    // Yükleme bitince kuyruk sunucudaki yeni boyut ve tarihi bildirir; sonraki kayıt buna göre karşılaştırılır.
    updateBaseline(remotePath, baseline) {
      const item = items.get(remotePath);
      if (item) item.baseline = baseline;
    },

    // İzlemeyi durdurur; son anda yapılmış bir kayıt varsa önce onu kuyruğa verir. Dosyalar wipe() ile silinir.
    stopAll() {
      if (items.size === 0) return;
      for (const item of items.values()) {
        clearInterval(item.timer);
        check(item);
      }
      items.clear();
      onChange(0);
    },

    wipe() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

module.exports = { createEdits, MAX_EDIT };

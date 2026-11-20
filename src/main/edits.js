const fs = require('node:fs');
const { t } = require('../i18n');
const path = require('node:path');
const { FtpError } = require('./ftp');

const MAX_EDIT = 10 * 1024 * 1024;
// Açıldığında düzenlenmek yerine çalışan ya da başka bir yere yönlendiren türler. Dosya adı sunucudan gelir,
// yani güvenilmezdir; ele geçirilmiş bir siteye konmuş böyle bir dosya "Düzenle" ile çalıştırılmamalı.
const RUNS_ON_OPEN = new Set(['app', 'command', 'tool', 'terminal', 'inetloc', 'fileloc', 'webloc', 'url', 'jar', 'pkg', 'mpkg',
  'dmg', 'workflow', 'action', 'scpt', 'scptd', 'osax', 'prefpane', 'service', 'kext', 'shortcut']);

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
      if (remotePath.split('/').includes('..') || !name || /[\\/]/.test(name)) throw new FtpError('LOCAL', t('Bu dosya düzenlemeye açılamıyor.'));
      if (RUNS_ON_OPEN.has(path.extname(name).slice(1).toLowerCase())) throw new FtpError('LOCAL', t('Bu dosya türü güvenlik nedeniyle düzenlemeye açılmıyor.'));
      if (entry.size > MAX_EDIT) throw new FtpError('LOCAL', t('Düzenlemek için çok büyük, önce indir.'));
      const existing = items.get(remotePath);
      if (existing) {
        await open(existing.localPath);
        return;
      }
      const localPath = path.join(dir, String(++seq), name);
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      const session = await getSession();
      // Panelin gösterdiği liste eskimiş olabilir: boyut sınırı ve karşılaştırma temeli güncel listeden alınır.
      const fresh = (await session.list(path.posix.dirname(remotePath))).find((e) => e.name === name) || entry;
      if (fresh.size > MAX_EDIT) throw new FtpError('LOCAL', t('Düzenlemek için çok büyük, önce indir.'));
      await session.fetch(remotePath, localPath);
      await open(localPath); // açılamazsa izlemeye alınmaz
      const item = { localPath, remotePath, mark: markOf(localPath), baseline: { size: fresh.size, modified: fresh.modified } };
      item.timer = setInterval(() => check(item), interval);
      items.set(remotePath, item);
      onChange(items.size);
    },

    // Yükleme bitince kuyruk sunucudaki yeni boyut ve tarihi bildirir; sonraki kayıt buna göre karşılaştırılır.
    updateBaseline(remotePath, baseline) {
      const item = items.get(remotePath);
      if (item) item.baseline = baseline;
    },

    // Son anda yapılmış kayıtları, izlemeyi durdurmadan kuyruğa verir.
    flush() {
      for (const item of items.values()) check(item);
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

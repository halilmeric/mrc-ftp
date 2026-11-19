const KEEP = 1024 * 1024;
// Klasör adı sunucudan gelir ve giriş kabuğu (bash, csh, fish…) bilinmez. Tek tırnak içinde her kabukta
// düz metin kalan adlar komuta girer; tırnak, ters bölü, ünlem ya da denetim karakteri içeren ad girmez.
const safeDir = (dir) => (typeof dir === 'string' && dir && !/['\\!\x00-\x1f\x7f]/.test(dir) ? dir : '.');

// Sunucudaki kabuk oturumu. Ana süreçte yaşar; arayüz yalnızca bir görünümdür, bu yüzden
// terminal alttan ayrılıp geri takılırken oturum kopmaz. Durumlar: idle, starting, open, closed, refused.
function createTerminal({ connect, onData, onState }) {
  let conn = null;
  let stream = null;
  let state = 'idle';
  let message = '';
  let chunks = [];
  let kept = 0;
  let gen = 0; // eski oturumdan geç gelen olaylar yenisine karışmasın

  const set = (next, text = '') => {
    state = next;
    message = text;
    onState({ state, message });
  };
  const hangUp = () => {
    const c = conn;
    conn = null;
    stream = null;
    if (c) c.destroy();
  };
  // Ayrılan pencere açıldığında ekranı yeniden kurabilsin diye son çıktı tutulur.
  // ponytail: sınır parça ortasından geçebilir, o zaman en eski satır bozuk görünür; gerekirse satır sınırından kes.
  const record = (data) => {
    chunks.push(data);
    kept += data.length;
    while (chunks.length > 1 && kept - chunks[0].length >= KEEP) kept -= chunks.shift().length;
    onData(data);
  };

  return {
    async start({ cols, rows, cwd }) {
      if (state === 'starting' || state === 'open') return;
      const mine = ++gen;
      chunks = [];
      kept = 0;
      set('starting');
      let c;
      try {
        c = await connect();
      } catch (err) {
        if (mine === gen) set('closed', (err && err.message) || 'Sunucuya bağlanılamadı.');
        return;
      }
      if (mine !== gen) { c.destroy(); return; }
      conn = c;
      c.once('close', () => {
        if (mine !== gen || conn !== c) return;
        conn = null;
        stream = null;
        set('closed');
      });
      const pty = { term: 'xterm-256color', cols, rows };
      const refused = () => {
        if (mine !== gen) return;
        conn = null;
        c.destroy();
        set('refused', 'Bu hesapta kabuk (SSH komut satırı) erişimi kapalı. Dosya işlemleri bundan etkilenmez.');
      };
      const opened = (ch) => {
        if (mine !== gen) return;
        stream = ch;
        set('open');
        ch.on('data', record);
        ch.stderr.on('data', record);
        ch.on('close', () => c.destroy()); // kabuk bitti: bağlantının kapanma olayı durumu "closed" yapar
      };
      // Kabuk, sunucu panelinde açık olan klasörde başlar; klasöre girilemezse ev klasöründe kalır.
      // Komut çalıştırmaya izin vermeyen sunucularda düz kabuk denenir.
      // Asıl satırı /bin/sh yorumlar; giriş kabuğu yalnızca tek tırnaklı iki düz metin görür.
      const command = `exec /bin/sh -c 'cd -- "$1" 2>/dev/null; exec "\${SHELL:-/bin/sh}" -l' sh '${safeDir(cwd)}'`;
      c.exec(command, { pty }, (err, ch) => {
        if (!err) return opened(ch);
        if (mine !== gen || conn !== c) return undefined; // bağlantı bu arada koptu: kapanma olayı durumu bildirir
        try {
          return c.shell(pty, (err2, ch2) => (err2 ? refused() : opened(ch2)));
        } catch {
          return undefined;
        }
      });
    },

    write(data) {
      if (stream) stream.write(data);
    },

    resize(cols, rows) {
      if (stream && cols > 0 && rows > 0) stream.setWindow(rows, cols, 0, 0);
    },

    snapshot: () => ({ state, message, data: Buffer.concat(chunks) }),

    close() {
      gen += 1;
      hangUp();
      chunks = [];
      kept = 0;
      if (state !== 'idle') set('idle');
    },
  };
}

module.exports = { createTerminal };

const KEEP = 1024 * 1024;
const quote = (text) => "'" + String(text).replace(/'/g, "'\\''") + "'";

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
      c.exec(`cd -- ${quote(cwd || '.')} 2>/dev/null; exec "\${SHELL:-/bin/sh}" -l`, { pty }, (err, ch) => {
        if (!err) return opened(ch);
        if (mine !== gen) return undefined;
        return c.shell(pty, (err2, ch2) => (err2 ? refused() : opened(ch2)));
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

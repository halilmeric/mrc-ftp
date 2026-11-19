'use strict';
// Terminal görünümü (xterm). Oturum ana süreçtedir; alttaki panel ve ayrılan pencere onu gösterir.
function createTermView(body) {
  const term = new Terminal({
    fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, cursorBlink: true, scrollback: 5000,
    theme: { background: '#14171e', foreground: '#e9ecf3', cursor: '#7ea2ff', selectionBackground: '#33456f' },
    linkHandler: { activate() {} }, // sunucu çıktısındaki bağlantılar tıklanınca hiçbir şey açmaz
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(body);
  let live = true;
  const visible = () => body.offsetParent !== null && body.clientHeight > 20;
  const refit = () => {
    if (!visible()) return; // gizli görünüm sunucudaki boyutu bozmasın
    fit.fit();
    mrc.term.resize(term.cols, term.rows);
  };
  new ResizeObserver(refit).observe(body);
  term.onData((data) => mrc.term.input(data));
  mrc.term.onData((data) => { if (live) term.write(data); });
  return {
    refit,
    focus: () => term.focus(),
    clear: () => term.reset(),
    print: (text) => term.write(`\r\n\x1b[33m${text}\x1b[0m\r\n`),
    size: () => ({ cols: term.cols, rows: term.rows }),
    // Oturumun tuttuğu son çıktıyı ekrana yeniden yazar. Yanıt gelene kadarki canlı veri zaten içindedir.
    async replay() {
      live = false;
      const snap = await mrc.term.snapshot();
      term.reset();
      term.write(snap.data);
      live = true;
      return snap;
    },
  };
}

// Başlıktaki durum yazısı ve "Yeniden başlat" düğmesi.
function bindTermStatus({ view, note, restart }) {
  const TEXT = { starting: 'Bağlanıyor…', closed: 'Oturum kapandı', refused: 'Kabuk erişimi kapalı' };
  const show = ({ state, message }, quiet) => {
    note.textContent = TEXT[state] || '';
    restart.hidden = state !== 'closed';
    if (message && !quiet) view.print(message);
    else if (message) note.textContent = message;
  };
  mrc.term.onState((s) => show(s));
  return { show };
}

// Ana penceredeki alt panel.
function initTermPanel({ getCwd }) {
  const $ = (id) => document.getElementById(id);
  const panel = $('term');
  let view = null;
  let state = 'idle';
  let enabled = false; // yalnızca SFTP sitesine bağlıyken
  let wanted = false; // kullanıcı paneli açık istiyor
  let docked = true; // false: terminal kendi penceresinde

  const start = () => mrc.term.start({ ...view.size(), cwd: getCwd() || '/' }).catch((err) => notify(err.message));
  function apply() {
    panel.hidden = !(enabled && wanted && docked);
    $('btn-term').setAttribute('aria-pressed', String(!panel.hidden));
    if (panel.hidden) return;
    if (!view) {
      view = createTermView($('term-body'));
      bindTermStatus({ view, note: $('term-note'), restart: $('term-restart') });
    }
    view.refit();
    view.focus();
    if (state === 'idle') start();
  }
  function toggle() {
    if (!enabled) return;
    if (!docked) { mrc.term.detach(); return; } // ayrılmış pencereyi öne getirir
    wanted = !wanted;
    apply();
  }

  mrc.term.onState((s) => { state = s.state; });
  mrc.term.onDocked((isDocked) => {
    docked = isDocked;
    if (isDocked) wanted = true;
    apply();
  });
  $('btn-term').addEventListener('click', toggle);
  $('term-hide').addEventListener('click', toggle);
  $('term-detach').addEventListener('click', () => mrc.term.detach());
  $('term-restart').addEventListener('click', () => { view.clear(); start(); });
  addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.code === 'Backquote') { e.preventDefault(); e.stopPropagation(); toggle(); }
  }, true);

  // Üst kenardan sürükleyerek yükseklik.
  const grip = $('term-grip');
  grip.addEventListener('pointerdown', (e) => {
    grip.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startH = panel.offsetHeight;
    const move = (ev) => {
      const max = panel.parentElement.clientHeight - 220;
      panel.style.height = Math.max(120, Math.min(startH + startY - ev.clientY, max)) + 'px';
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', () => grip.removeEventListener('pointermove', move), { once: true });
  });

  return {
    setEnabled(on) {
      enabled = on;
      $('btn-term').hidden = !on;
      if (!on) {
        wanted = false;
        state = 'idle';
        if (view) view.clear();
      }
      apply();
    },
  };
}

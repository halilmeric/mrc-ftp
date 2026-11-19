'use strict';
// Sağdaki aktarım paneli. İlerleme saniyede birkaç kez gelir; kartlar yalnızca durum değişince yeniden kurulur
// ki tıklanan düğme tıklama bitmeden yok olmasın.
function createTray({ root, panes }) {
  const FINISHED = ['done', 'skipped', 'cancelled'];
  const dirname = (p) => p.slice(0, p.lastIndexOf('/')) || '/';
  const applyAll = new Map(); // iş kimliği -> "Hepsine uygula" işaretli mi
  let prev = new Map();
  const cache = new Map(); // "kimlik:durum:hata" -> kart düğümü
  let closeTimer = null;
  const timers = {};
  const refreshSoon = (which, target) => {
    const pane = panes[which];
    if (pane.path == null || !target.startsWith(pane.path === '/' ? '/' : pane.path + '/')) return;
    clearTimeout(timers[which]);
    timers[which] = setTimeout(() => pane.refresh(), 300);
  };

  const head = el('span');
  const totalBar = progressBar(0);
  const totalPct = el('span');
  const totalEta = el('span');
  const list = el('div', { class: 'jobs' });
  root.append(el('div', { class: 'tray-head' }, el('b', {}, 'Aktarımlar'), head),
    el('div', { class: 'total' }, totalBar, el('small', {}, totalPct, totalEta)), list);

  const activeText = (job) => {
    const left = job.speed > 0 ? ` · ${formatEta((job.total - job.bytes) / job.speed)} kaldı` : '';
    return `${formatSize(job.bytes)} / ${formatSize(job.total)} · ${formatSize(job.speed)}/sn${left}`;
  };

  function card(job) {
    const top = (mark, ...rest) => el('div', { class: 't' }, el('i', { class: 'dir' }, mark), el('span', { title: job.name }, job.name), ...rest);
    const arrow = job.direction === 'up' ? '↑' : '↓';
    if (job.state === 'active') {
      const bar = progressBar(job.total ? (job.bytes / job.total) * 100 : 0);
      const text = el('small', {}, activeText(job));
      const node = el('div', { class: 'job' }, top(arrow, el('button', { type: 'button', class: 'mini', onclick: () => mrc.transfers.cancel(job.id) }, 'İptal')), bar, text);
      node.live = { bar, text };
      return node;
    }
    if (job.state === 'asking') {
      const box = el('input', { type: 'checkbox', id: `all-${job.id}` });
      box.checked = Boolean(applyAll.get(job.id));
      box.addEventListener('change', () => applyAll.set(job.id, box.checked));
      const answer = (choice) => mrc.transfers.answer(job.id, choice, box.checked);
      return el('div', { class: 'job ask' }, top('?'),
        el('small', {}, `${job.direction === 'up' ? 'Sunucuda' : 'Mac\'te'} aynı adlı dosya var`),
        el('div', { class: 'acts' },
          el('button', { type: 'button', class: 'p', onclick: () => answer('overwrite') }, 'Üzerine yaz'),
          el('button', { type: 'button', onclick: () => answer('skip') }, 'Atla')),
        el('label', {}, box, 'Hepsine uygula'));
    }
    if (job.state === 'error') {
      return el('div', { class: 'job err' }, top('!'), el('small', {}, job.error || 'Aktarılamadı.'),
        el('div', { class: 'acts' },
          el('button', { type: 'button', onclick: () => mrc.transfers.retry(job.id) }, 'Yeniden dene'),
          el('button', { type: 'button', onclick: () => mrc.transfers.dismiss(job.id) }, 'Kapat')));
    }
    if (job.state === 'queued') return el('div', { class: 'job' }, top(arrow, el('small', {}, job.total ? formatSize(job.total) : '')));
    const word = job.state === 'done' ? (job.direction === 'up' ? 'Yüklendi' : 'İndirildi') : job.state === 'skipped' ? 'Atlandı' : 'İptal edildi';
    return el('div', { class: 'job' + (job.state === 'done' ? ' done' : '') }, top(job.state === 'done' ? '✓' : arrow, el('small', {}, word)));
  }

  function render(jobs) {
    root.hidden = jobs.length === 0;

    // Biten işin hedefi ekrandaki klasörün içindeyse (alt klasörler dahil) o paneli yenile.
    for (const job of jobs) {
      if (job.state === 'done' && prev.get(job.id) !== 'done') {
        if (job.direction === 'up') refreshSoon('remote', job.remotePath);
        else refreshSoon('local', job.localPath);
      }
    }
    prev = new Map(jobs.map((j) => [j.id, j.state]));
    for (const id of applyAll.keys()) if (!prev.has(id)) applyAll.delete(id);

    const active = jobs.find((j) => j.state === 'active');
    panes.remote.setGhost(active && active.direction === 'up' && panes.remote.path === dirname(active.remotePath)
      ? { name: active.name, pct: active.total ? Math.round((active.bytes / active.total) * 100) : 0 } : null);

    // Toplam
    const counted = jobs.filter((j) => !['skipped', 'cancelled'].includes(j.state));
    const sum = counted.reduce((n, j) => n + j.total, 0);
    const got = counted.reduce((n, j) => n + (j.state === 'done' ? j.total : j.state === 'active' ? j.bytes : 0), 0);
    const pct = sum ? Math.round((got / sum) * 100) : 0;
    head.textContent = `${jobs.filter((j) => FINISHED.includes(j.state)).length} / ${jobs.length} bitti`;
    totalBar.firstChild.style.width = pct + '%';
    totalPct.textContent = pct + '%';
    totalEta.textContent = active && active.speed > 0 ? `yaklaşık ${formatEta((sum - got) / active.speed)}` : '';

    // Kartlar anahtarla yeniden kullanılır: değişmeyen kart yerinden oynamaz, üstündeki tıklama kaybolmaz.
    const desired = [];
    const keys = new Set();
    const use = (key, make) => {
      keys.add(key);
      if (!cache.has(key)) cache.set(key, make());
      desired.push(cache.get(key));
    };
    const keyOf = (j) => `${j.id}:${j.state}:${j.error || ''}`;
    const group = (states) => jobs.filter((j) => states.includes(j.state));
    for (const j of [...group(['active']), ...group(['asking']), ...group(['error'])]) use(keyOf(j), () => card(j));
    const queued = group(['queued']);
    const finished = group(FINISHED);
    if (queued.length) use('sub:queued', () => el('div', { class: 'sub' }, 'Sırada'));
    for (const j of queued) use(keyOf(j), () => card(j));
    if (finished.length) use('sub:finished', () => el('div', { class: 'sub' }, 'Biten'));
    for (const j of finished) use(keyOf(j), () => card(j));
    for (const [key, node] of cache) {
      if (!keys.has(key)) { node.remove(); cache.delete(key); }
    }
    desired.forEach((node, i) => { if (list.children[i] !== node) list.insertBefore(node, list.children[i] || null); });
    if (active) {
      const node = cache.get(keyOf(active));
      node.live.bar.firstChild.style.width = (active.total ? (active.bytes / active.total) * 100 : 0) + '%';
      node.live.text.textContent = activeText(active);
    }

    // Hepsi bittiyse 3 sn sonra panel kapanır; soru ya da hata varken açık kalır.
    clearTimeout(closeTimer);
    if (jobs.length && jobs.every((j) => FINISHED.includes(j.state))) {
      closeTimer = setTimeout(() => mrc.transfers.clearFinished().catch(() => {}), 3000);
    }
  }

  return { render };
}

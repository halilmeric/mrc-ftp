'use strict';
// Bir dosya paneli (Mac ya da Sunucu). Sürüklenen şeyin kaynağı paneller arasında bu değişkenle taşınır.
let dragSource = null;

function progressBar(pct) {
  const fill = el('i');
  fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
  return el('div', { class: 'bar' }, fill);
}

// ponytail: her yenilemede tüm satırlar yeniden çizilir; on binlerce girdili klasörde yavaşlarsa sanal liste gerekir.
function createPane({ root, kind, label, list, ops, menu, onSend, onDropIn, onLoaded, onPreview }) {
  const state = { path: null, entries: [], sort: { key: 'name', dir: 1 }, selected: new Set(), anchor: null,
    renaming: null, confirming: null, creating: false, error: '', loading: false, ghost: null, stale: false };
  let ghostNode = null;
  const editing = () => Boolean(state.renaming || state.creating || state.confirming);
  const taken = (name) => state.entries.some((e) => e.name === name);

  const crumb = el('div', { class: 'crumb' });
  const cols = el('div', { class: 'cols' });
  const errBox = el('div', { class: 'perr', hidden: true });
  const rows = el('div', { class: 'rows', tabindex: '0', 'aria-label': label });
  root.append(crumb, cols, errBox, rows);

  const sorted = () => {
    const { key, dir } = state.sort;
    return [...state.entries].sort((a, b) => (b.isDir - a.isDir) || dir * (
      key === 'name' ? a.name.localeCompare(b.name, 'tr')
        : key === 'size' ? a.size - b.size
          : String(a.modified || '').localeCompare(String(b.modified || ''))) || a.name.localeCompare(b.name, 'tr'));
  };
  const picked = () => state.entries.filter((e) => state.selected.has(e.name));

  function nameInput(value, onDone) {
    const input = el('input', { value, spellcheck: 'false', 'aria-label': t('Ad') });
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      onDone(commit && name && name !== value && !/[\\/]/.test(name) ? name : null);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
      e.stopPropagation();
    });
    input.addEventListener('blur', () => finish(false));
    setTimeout(() => { input.focus(); input.select(); });
    return input;
  }

  async function act(fn) {
    state.error = '';
    try {
      await fn();
    } catch (err) {
      state.error = err.message || t('İşlem yapılamadı.');
    }
    rows.focus();
    await refresh();
  }

  function rowFor(entry, index, all) {
    const icon = el('i', { class: entry.isDir ? 'ic' : 'ic f' });
    if (state.confirming === entry.name) {
      return el('div', { class: 'r ask' },
        el('span', {}, t`${entry.name} silinsin mi?${entry.isDir ? t(' İçindekilerle birlikte silinir.') : ''}`),
        el('div', { class: 'acts' },
          el('button', { type: 'button', class: 'd', onclick: () => { state.confirming = null; act(() => ops.remove(joinPath(state.path, entry.name), entry.isDir)); } }, t('Sil')),
          el('button', { type: 'button', onclick: () => { state.confirming = null; settle(); } }, t('Vazgeç'))));
    }
    if (state.renaming === entry.name) {
      return el('div', { class: 'r sel' }, el('div', { class: 'n' }, icon, nameInput(entry.name, (name) => {
        state.renaming = null;
        if (name && taken(name)) { state.error = t('Bu adda bir öğe zaten var.'); settle(); } // RNTO sunucuda sessizce üzerine yazar
        else if (name) act(() => ops.rename(joinPath(state.path, entry.name), joinPath(state.path, name)));
        else settle();
      })), el('span', { class: 'm' }), el('span', { class: 'm' }));
    }
    return el('div', {
      class: 'r' + (state.selected.has(entry.name) ? ' sel' : ''), draggable: 'true', role: 'row',
      onclick: (e) => {
        if (e.shiftKey && state.anchor != null) {
          const [a, b] = [state.anchor, index].sort((x, y) => x - y);
          state.selected = new Set(all.slice(a, b + 1).map((x) => x.name));
        } else if (e.metaKey) {
          if (state.selected.has(entry.name)) state.selected.delete(entry.name); else state.selected.add(entry.name);
          state.anchor = index;
        } else {
          state.selected = new Set([entry.name]);
          state.anchor = index;
        }
        render();
      },
      ondblclick: () => (entry.isDir ? go(joinPath(state.path, entry.name)) : onSend(state.path, [entry])),
      ondragstart: (e) => {
        if (!state.selected.has(entry.name)) { state.selected = new Set([entry.name]); state.anchor = index; }
        dragSource = { from: kind, dir: state.path, entries: picked() };
        e.dataTransfer.setData('application/x-mrc', kind);
        e.dataTransfer.effectAllowed = 'copy';
      },
      ondragend: () => { dragSource = null; },
      oncontextmenu: (e) => {
        if (!menu) return;
        e.preventDefault();
        if (!state.selected.has(entry.name)) state.selected = new Set([entry.name]);
        render();
        showMenu(e.clientX, e.clientY, menu(entry, picked()));
      },
    }, el('div', { class: 'n' }, icon, el('span', {}, entry.name)),
    el('span', { class: 'm' }, entry.isDir ? t('klasör') : formatSize(entry.size)),
    el('span', { class: 'm' }, formatDate(entry.modified)));
  }

  function render() {
    // Yol çubuğu
    const parts = state.path ? state.path.split('/').filter(Boolean) : [];
    const crumbs = [el('button', { type: 'button', onclick: () => state.path && go('/') }, label)];
    parts.forEach((part, i) => {
      crumbs.push('›', el('button', { type: 'button', onclick: () => go('/' + parts.slice(0, i + 1).join('/')) }, part));
    });
    crumb.replaceChildren(...crumbs);

    const head = (key, text) => el('button', { type: 'button', onclick: () => {
      state.sort = { key, dir: state.sort.key === key ? -state.sort.dir : 1 };
      render();
    } }, text + (state.sort.key === key ? (state.sort.dir === 1 ? ' ↑' : ' ↓') : ''));
    cols.replaceChildren(head('name', t('Ad')), head('size', t('Boyut')), head('modified', t('Değişti')));

    errBox.hidden = !state.error;
    errBox.textContent = state.error;
    rows.classList.toggle('loading', state.loading);

    if (state.path == null) {
      rows.replaceChildren(el('div', { class: 'empty' }, t('Bir site seç')));
      return;
    }
    const all = sorted();
    const out = [];
    if (state.creating) {
      out.push(el('div', { class: 'r sel' }, el('div', { class: 'n' }, el('i', { class: 'ic' }), nameInput('', (name) => {
        state.creating = false;
        if (name && taken(name)) { state.error = t('Bu adda bir öğe zaten var.'); settle(); }
        else if (name) act(() => ops.mkdir(joinPath(state.path, name)));
        else settle();
      })), el('span', { class: 'm' }), el('span', { class: 'm' })));
    }
    all.forEach((entry, i) => out.push(rowFor(entry, i, all)));
    ghostNode = state.ghost ? el('div', { class: 'r ghost' }, el('div', { class: 'n' }, el('i', { class: 'ic f' }), el('span', {}, t`${state.ghost.name} yükleniyor`)), progressBar(state.ghost.pct)) : null;
    if (ghostNode) out.push(ghostNode);
    if (out.length === 0) out.push(el('div', { class: 'empty' }, t('Bu klasör boş')));
    rows.replaceChildren(...out);
  }

  async function go(path) {
    state.loading = true;
    render();
    try {
      const entries = await list(path);
      Object.assign(state, { path, entries, selected: new Set(), anchor: null, renaming: null, confirming: null, creating: false, error: '', stale: false });
    } catch (err) {
      state.error = err.message || t('Klasör açılamadı.');
    }
    state.loading = false;
    render();
    if (onLoaded) onLoaded(state.entries.length, state.path);
  }
  // Ad yazılırken ya da silme sorulurken gelen yenileme, düzenleme bitene kadar bekler.
  const refresh = () => {
    if (state.path == null) return Promise.resolve();
    if (editing()) { state.stale = true; return Promise.resolve(); }
    return go(state.path);
  };
  // Satır içi düzenleme bitince odak listeye döner ki ok tuşları çalışmaya devam etsin.
  const settle = () => { rows.focus(); return state.stale ? refresh() : render(); };

  // Klavye: oklar seçimi taşır, Enter açar ya da gönderir, boşluk Hızlı Bakış.
  rows.addEventListener('keydown', (e) => {
    if (editing() || state.path == null) return;
    if (e.repeat && (e.key === 'Enter' || e.key === ' ')) return; // basılı tutunca yinelenen aktarım ya da önizleme olmasın
    const all = sorted();
    const index = all.findIndex((x) => state.selected.has(x.name));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (all.length === 0) return;
      const next = index < 0 ? 0 : Math.max(0, Math.min(all.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)));
      state.selected = new Set([all[next].name]);
      state.anchor = next;
      render();
      const row = rows.querySelector('.r.sel');
      if (row) row.scrollIntoView({ block: 'nearest' });
    } else if (index >= 0 && e.key === 'Enter') {
      e.preventDefault();
      if (all[index].isDir) go(joinPath(state.path, all[index].name));
      else onSend(state.path, [all[index]]);
    } else if (index >= 0 && e.key === ' ') {
      e.preventDefault();
      if (!all[index].isDir && onPreview) onPreview(state.path, all[index]);
    }
  });

  // Bırakma: karşı panelden ya da (yalnızca sunucu panelinde) Finder'dan.
  const accepts = (e) => state.path != null && (dragSource ? dragSource.from !== kind : (kind === 'remote' && e.dataTransfer.types.includes('Files')));
  root.addEventListener('dragover', (e) => {
    if (!accepts(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    root.classList.add('drop');
  });
  root.addEventListener('dragleave', (e) => { if (!root.contains(e.relatedTarget)) root.classList.remove('drop'); });
  root.addEventListener('drop', (e) => {
    root.classList.remove('drop');
    if (!accepts(e)) return;
    e.preventDefault();
    if (dragSource) {
      onDropIn(dragSource, state.path);
    } else {
      const entries = [...e.dataTransfer.items].filter((it) => it.kind === 'file').map((it) => {
        const fsEntry = it.webkitGetAsEntry && it.webkitGetAsEntry();
        const file = it.getAsFile();
        return file && { name: file.name, isDir: Boolean(fsEntry && fsEntry.isDirectory), size: file.size, localPath: mrc.pathForFile(file) };
      }).filter((x) => x && x.localPath);
      if (entries.length) onDropIn({ from: 'finder', dir: null, entries }, state.path);
    }
    dragSource = null;
  });

  render();
  return {
    go, refresh,
    get path() { return state.path; },
    get count() { return state.entries.length; },
    get names() { return state.entries.map((e) => e.name); },
    startRename(name) { state.renaming = name; render(); },
    startDelete(name) { state.confirming = name; render(); },
    newFolder() { if (state.path != null && ops) { state.creating = true; render(); } },
    // Yüklenen dosyanın soluk satırı: yüzde değişince yalnızca çubuk güncellenir, satırlar yeniden çizilmez.
    setGhost(ghost) {
      const same = ghost && state.ghost && ghost.name === state.ghost.name;
      state.ghost = ghost;
      if (same && ghostNode) { ghostNode.querySelector('.bar i').style.width = ghost.pct + '%'; return; }
      if (!editing()) render();
    },
    reset() { Object.assign(state, { path: null, entries: [], selected: new Set(), error: '', ghost: null }); render(); if (onLoaded) onLoaded(0, null); },
  };
}

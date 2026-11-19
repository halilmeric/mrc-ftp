'use strict';
(function main() {
  const $ = (id) => document.getElementById(id);
  let connected = false;

  // Aktarım: yerel girdiler sunucudaki klasöre, sunucu girdileri Mac'teki klasöre.
  function upload(entries, localDir, remoteDir) {
    for (const e of entries) {
      mrc.transfers.add({ direction: 'up', localPath: e.localPath || joinPath(localDir, e.name), remotePath: joinPath(remoteDir, e.name), isDir: e.isDir });
    }
  }
  function download(entries, remoteDir, localDir) {
    for (const e of entries) {
      mrc.transfers.add({ direction: 'down', localPath: joinPath(localDir, e.name), remotePath: joinPath(remoteDir, e.name), isDir: e.isDir, size: e.size, modified: e.modified });
    }
  }
  const guard = () => {
    if (!connected || remote.path == null) { notify('Önce bir siteye bağlan.'); return false; }
    notify('');
    return true;
  };

  const local = createPane({
    root: $('local'), kind: 'local', label: 'Mac', list: mrc.local.list,
    onSend: (dir, entries) => guard() && upload(entries, dir, remote.path),
    onDropIn: (src, dir) => guard() && src.from === 'remote' && download(src.entries, src.dir, dir),
    onLoaded: (n) => { $('st-local').textContent = `Mac: ${n} öğe`; },
    onPreview: (dir, entry) => mrc.preview.local(joinPath(dir, entry.name)),
  });
  const info = initInfo();
  const termPanel = initTermPanel({ getCwd: () => remote.path });
  const remote = createPane({
    root: $('remote'), kind: 'remote', label: 'Sunucu', list: mrc.remote.list, ops: mrc.remote,
    menu: (entry, picked) => [
      !entry.isDir && { label: 'Düzenle', run: () => mrc.edit.open(joinPath(remote.path, entry.name), { size: entry.size, modified: entry.modified }).catch((err) => notify(err.message)) },
      { label: 'İndirilenler\'e indir', run: async () => download(picked, remote.path, (await mrc.local.downloads()).path) },
      { label: 'Farklı indir…', run: async () => { const dir = await mrc.local.pickDir(); if (dir) download(picked, remote.path, dir.path); } },
      { label: 'Bilgi ve izinler…', run: () => info.open(remote.path, entry, () => remote.refresh()) },
      { label: 'Yeniden adlandır', run: () => remote.startRename(entry.name) },
      { label: 'Sil', danger: true, run: () => remote.startDelete(entry.name) },
    ].filter(Boolean),
    onPreview: (dir, entry) => mrc.preview.remote(joinPath(dir, entry.name), entry.size).catch((err) => notify(err.message)),
    onSend: (dir, entries) => guard() && download(entries, dir, local.path),
    onDropIn: (src, dir) => guard() && src.from !== 'remote' && upload(src.entries, src.dir, dir),
    onLoaded: (n, path) => { $('st-remote').textContent = path == null ? '' : `Sunucu: ${n} öğe`; },
  });

  document.addEventListener('mrc:connected', async (e) => {
    const { site, startDir, terminal } = e.detail;
    connected = true;
    termPanel.setEnabled(false); // önceki sitenin terminali kapanır
    termPanel.setEnabled(Boolean(terminal));
    window.mrcTray.render([]); // önceki sitenin kartları yeni sitenin kuyruğuna karışmasın
    $('site-name').textContent = site.name;
    $('badge').hidden = false;
    $('badge').textContent = site.secure ? 'Şifreli bağlantı' : 'Şifresiz';
    $('badge').className = 'badge' + (site.secure ? '' : ' plain');
    $('btn-mkdir').hidden = false;
    remote.reset();
    await remote.go(startDir);
    if (remote.path == null) await remote.go('/'); // başlangıç klasörü yoksa köke düş
  });
  document.addEventListener('mrc:disconnected', () => {
    connected = false;
    termPanel.setEnabled(false);
    $('site-name').textContent = 'Bağlı değil';
    $('badge').hidden = true;
    $('btn-mkdir').hidden = true;
    $('st-edit').hidden = true;
    remote.reset();
    if (window.mrcTray) window.mrcTray.render([]);
  });

  mrc.edit.onChange((count) => {
    $('st-edit').hidden = count === 0;
    $('st-edit-text').textContent = `${count} dosya düzenleniyor`;
  });
  $('st-edit-stop').addEventListener('click', () => mrc.edit.stopAll());

  $('btn-refresh').addEventListener('click', () => { local.refresh(); remote.refresh(); });
  $('btn-mkdir').addEventListener('click', () => remote.newFolder());

  window.mrcPanes = { local, remote };
  window.mrcTray = createTray({ root: $('tray'), panes: { local, remote } });
  mrc.transfers.onChange((jobs) => window.mrcTray.render(jobs));
  mrc.local.home().then((h) => local.go(h.path));
  initSites();
})();

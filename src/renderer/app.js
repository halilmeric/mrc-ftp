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
    if (!connected || remote.path == null) { notify(t('Önce bir siteye bağlan.')); return false; }
    notify('');
    return true;
  };

  const local = createPane({
    root: $('local'), kind: 'local', label: 'Mac', list: mrc.local.list,
    onSend: (dir, entries) => guard() && upload(entries, dir, remote.path),
    onDropIn: (src, dir) => guard() && src.from === 'remote' && download(src.entries, src.dir, dir),
    onLoaded: (n) => { $('st-local').textContent = t`Mac: ${n} öğe`; },
    onPreview: (dir, entry) => feat().preview && mrc.preview.local(joinPath(dir, entry.name)),
  });
  const info = initInfo();
  const batch = initBatch();
  let site = null; // bağlı site
  let favorites = [];
  let hasShell = false; // bağlı site terminal sunuyor (SFTP)
  // Ayarlar'da kapatılan özelliğin düğmesi görünmez; menü maddeleri açılırken feat() ile süzülür.
  function applyFeatures() {
    const f = feat();
    $('btn-fav').hidden = !(connected && f.favorites);
    mrc.transfers.setParallel(f.parallel);
    if (termPanel.enabled === (hasShell && f.terminal)) return;
    if (termPanel.enabled) mrc.term.stop(); // görünmeyen kabuk arkada açık kalmasın
    termPanel.setEnabled(hasShell && f.terminal);
  }
  const termPanel = initTermPanel({ getCwd: () => remote.path });
  const remote = createPane({
    root: $('remote'), kind: 'remote', label: t('Sunucu'), list: mrc.remote.list, ops: mrc.remote,
    menu: (entry, picked) => [
      feat().edit && !entry.isDir && { label: t('Düzenle'), run: () => mrc.edit.open(joinPath(remote.path, entry.name), { size: entry.size, modified: entry.modified }).catch((err) => notify(err.message)) },
      { label: t('İndirilenler\'e indir'), run: async () => download(picked, remote.path, (await mrc.local.downloads()).path) },
      { label: t('Farklı indir…'), run: async () => { const dir = await mrc.local.pickDir(); if (dir) download(picked, remote.path, dir.path); } },
      { label: t('Bilgi ve izinler…'), run: () => info.open(remote.path, entry, () => remote.refresh()) },
      picked.length > 1 && feat().batch
        ? { label: t('Toplu yeniden adlandır…'), run: () => batch.open(remote.path, picked, remote.names, () => remote.refresh()) }
        : { label: t('Yeniden adlandır'), run: () => remote.startRename(entry.name) },
      { label: t('Sil'), danger: true, run: () => remote.startDelete(entry.name) },
    ].filter(Boolean),
    onPreview: (dir, entry) => feat().preview && mrc.preview.remote(joinPath(dir, entry.name), entry.size).catch((err) => notify(err.message)),
    onSend: (dir, entries) => guard() && download(entries, dir, local.path),
    onDropIn: (src, dir) => guard() && src.from !== 'remote' && upload(src.entries, src.dir, dir),
    onLoaded: (n, path) => { $('st-remote').textContent = path == null ? '' : t`Sunucu: ${n} öğe`; },
  });

  document.addEventListener('mrc:connected', async (e) => {
    const { startDir, terminal } = e.detail;
    ({ site } = e.detail);
    favorites = e.detail.favorites || [];
    connected = true;
    hasShell = Boolean(terminal);
    termPanel.setEnabled(false); // önceki sitenin terminali kapanır
    applyFeatures();
    window.mrcTray.render([]); // önceki sitenin kartları yeni sitenin kuyruğuna karışmasın
    $('site-name').textContent = site.name;
    $('badge').hidden = false;
    $('badge').textContent = site.secure ? t('Şifreli bağlantı') : t('Şifresiz');
    $('badge').className = 'badge' + (site.secure ? '' : ' plain');
    $('btn-mkdir').hidden = false;
    remote.reset();
    await remote.go(startDir);
    if (remote.path == null) await remote.go('/'); // başlangıç klasörü yoksa köke düş
  });
  document.addEventListener('mrc:disconnected', () => {
    connected = false;
    site = null;
    hasShell = false;
    applyFeatures();
    $('site-name').textContent = t('Bağlı değil');
    $('badge').hidden = true;
    $('btn-mkdir').hidden = true;
    $('st-edit').hidden = true;
    remote.reset();
    if (window.mrcTray) window.mrcTray.render([]);
  });

  mrc.edit.onChange((count) => {
    $('st-edit').hidden = count === 0;
    $('st-edit-text').textContent = t`${count} dosya düzenleniyor`;
  });
  $('st-edit-stop').addEventListener('click', () => mrc.edit.stopAll());

  // Sık kullanılan klasörler: o sitenin kayıtlı sunucu klasörleri.
  $('btn-fav').addEventListener('click', async (e) => {
    e.stopPropagation(); // menüyü açan tıklama onu kapatmasın
    if (!site || remote.path == null) return;
    const here = remote.path;
    const box = $('btn-fav').getBoundingClientRect();
    favorites = await mrc.sites.favorites(site.id); // aynı site başka sekmede de açık olabilir: güncel liste
    const saved = favorites.includes(here);
    const toggle = async () => { favorites = await mrc.sites.favorite(site.id, here, !saved); };
    showMenu(box.left, box.bottom + 4, [
      { label: saved ? t('Bu klasörü çıkar') : t('Bu klasörü ekle'), run: toggle },
      ...favorites.map((p) => ({ label: p, run: () => remote.go(p) })),
    ]);
  });

  $('btn-refresh').addEventListener('click', () => { local.refresh(); remote.refresh(); });
  $('btn-mkdir').addEventListener('click', () => remote.newFolder());

  window.mrcPanes = { local, remote };
  window.mrcTray = createTray({ root: $('tray'), panes: { local, remote } });
  mrc.transfers.onChange((jobs) => window.mrcTray.render(jobs));
  mrc.local.home().then((h) => local.go(h.path));
  initSettings(applyFeatures);
  applyFeatures();
  initSites();
})();

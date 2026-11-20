'use strict';
// Kenar çubuğu, site formu, şifre sorusu ve sertifika kartı.
function initSites() {
  const $ = (id) => document.getElementById(id);
  const listEl = $('site-list');
  let sites = [];
  let activeId = null;
  let busyId = null;
  let confirmId = null;

  const CERT_TEXT = {
    mismatch: (c) => t`Sertifika başka bir ada ait: ${c.subject}`,
    'self-signed': () => t('Sertifikayı sunucu kendi imzalamış.'),
    untrusted: (c) => t`Sertifikayı tanınmayan bir kurum vermiş: ${c.issuer}`,
    expired: (c) => t`Sertifikanın süresi ${c.validTo} tarihinde dolmuş.`,
    changed: () => t('Sertifika son bağlantıdan bu yana değişmiş.'),
    'ssh-new': () => t('Bu sunucuya ilk kez bağlanıyorsun. Parmak izini hosting panelinde gösterilen SSH anahtar parmak iziyle karşılaştırabilirsin.'),
    'ssh-changed': () => t('Sunucunun anahtarı son bağlantıdan bu yana değişmiş. Sunucu taşınmadıysa ya da yeniden kurulmadıysa bağlanma.'),
  };

  function render() {
    listEl.replaceChildren(...sites.map((site) => {
      if (site.id === confirmId) {
        return el('div', { class: 'confirm' }, t('Silinsin mi?'), el('div', { class: 'acts' },
          el('button', { type: 'button', class: 'd', onclick: () => remove(site) }, t('Evet')),
          el('button', { type: 'button', onclick: () => { confirmId = null; render(); } }, t('Vazgeç'))));
      }
      const cls = 'site' + (site.id === activeId ? ' on' : '') + (site.id === busyId ? ' busy' : '');
      return el('button', {
        type: 'button', class: cls, title: `${site.user}@${site.host}`,
        onclick: (e) => {
          if (e.metaKey) mrc.newTab(site.id); // ⌘-tık: bu sekmeye dokunmadan yeni sekmede aç
          else if (site.id !== activeId) connect(site); // etkin siteye tıklamak süren aktarımları düşürmesin
        },
        oncontextmenu: (e) => {
          e.preventDefault();
          showMenu(e.clientX, e.clientY, [
            site.id === activeId && { label: t('Bağlantıyı kes'), run: disconnect },
            { label: t('Yeni sekmede aç'), run: () => mrc.newTab(site.id) },
            { label: t('Düzenle'), run: () => openForm(site) },
            { label: t('Sil'), danger: true, run: () => { confirmId = site.id; render(); } },
          ].filter(Boolean));
        },
      }, el('span', { class: 'led' }), el('span', { class: 'n' }, site.name));
    }));
  }

  async function reload() {
    sites = await mrc.sites.list();
    render();
  }

  async function disconnect() {
    try {
      await mrc.disconnect();
    } catch (err) {
      if (err.code !== 'CANCELLED') notify(err.message);
      return;
    }
    activeId = null;
    render();
    document.dispatchEvent(new CustomEvent('mrc:disconnected'));
  }

  async function remove(site) {
    const wasActive = site.id === activeId;
    confirmId = null;
    try {
      await mrc.sites.remove(site.id);
    } catch (err) {
      if (err.code !== 'CANCELLED') notify(err.message);
      render();
      return;
    }
    if (wasActive) {
      activeId = null;
      document.dispatchEvent(new CustomEvent('mrc:disconnected'));
    }
    await reload();
  }

  async function connect(site, password) {
    if (busyId) return;
    notify('');
    busyId = site.id;
    render();
    try {
      const { startDir, terminal, favorites } = await mrc.connect(site.id, password);
      activeId = site.id;
      document.dispatchEvent(new CustomEvent('mrc:connected', { detail: { site, startDir, terminal, favorites } }));
    } catch (err) {
      if (err.code === 'CERT') askTrust(site, err.cert, password);
      else if (err.code === 'NEED_PASSWORD') askPassword(site);
      else if (err.code !== 'CANCELLED') notify(err.message); // kullanıcı "Vazgeç" dediyse sessiz kal
    } finally {
      busyId = null;
      render();
    }
  }

  // Sertifika kartı
  let pendingTrust = null;
  function askTrust(site, cert, password) {
    pendingTrust = { site, cert, password };
    $('cert-reason').textContent = (CERT_TEXT[cert.reason] || CERT_TEXT.untrusted)(cert);
    const ssh = String(cert.reason).startsWith('ssh');
    $('cert-title').textContent = cert.reason === 'ssh-new' ? t('Bu sunucuyu ilk kez görüyoruz') : ssh ? t('Sunucunun anahtarı değişmiş') : t('Bu sunucunun kimliği doğrulanamadı');
    $('cert-who').hidden = ssh;
    $('cert-hint').hidden = ssh;
    $('cert-who').textContent = t`Sertifika sahibi: ${cert.subject || t('bilinmiyor')} · Veren: ${cert.issuer || t('bilinmiyor')}`;
    $('cert-fp').textContent = cert.fingerprint;
    $('dlg-cert').showModal();
  }
  $('cert-cancel').addEventListener('click', () => $('dlg-cert').close());
  $('cert-trust').addEventListener('click', async () => {
    const { site, cert, password } = pendingTrust;
    $('dlg-cert').close();
    await mrc.trust(site.id, cert.fingerprint);
    await reload();
    connect(site, password);
  });

  // Şifre sorusu
  let pendingPass = null;
  function askPassword(site) {
    pendingPass = site;
    const key = site.auth === 'key';
    $('pass-title').textContent = t`${site.name} için ${key ? t('anahtar parolası') : t('şifre')}`;
    $('p-pass-label').textContent = key ? t('Anahtar parolası') : t('Şifre');
    $('p-pass').value = '';
    $('dlg-pass').showModal();
  }
  $('p-cancel').addEventListener('click', () => $('dlg-pass').close());
  $('pass-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const password = $('p-pass').value;
    if (!password) return;
    $('dlg-pass').close();
    connect(pendingPass, password);
  });

  // Site formu
  let editing = null;
  let keyPath = '';
  const isSsh = () => $('f-secure').value === 'sftp';
  const byKey = () => isSsh() && $('f-auth').value === 'key';
  // Bağlantı ve giriş türüne göre görünen alanlar.
  function syncForm() {
    $('f-plain-warn').hidden = $('f-secure').value !== '0';
    $('f-auth-row').hidden = !isSsh();
    $('f-key-row').hidden = !byKey();
    $('f-key').textContent = keyPath || t('Seçilmedi');
    $('f-key').title = keyPath;
    $('f-pass-label').textContent = byKey() ? t('Anahtar parolası (yoksa boş bırak)') : t('Şifre');
  }
  function openForm(site) {
    editing = site || null;
    $('site-form-title').textContent = site ? t('Siteyi düzenle') : t('Yeni site');
    $('f-name').value = site ? site.name : '';
    $('f-host').value = site ? site.host : '';
    $('f-user').value = site ? site.user : '';
    $('f-pass').value = '';
    $('f-pass').placeholder = site && site.hasPassword ? t('Değiştirmek için yaz') : '';
    $('f-port').value = site ? site.port : 21;
    $('f-dir').value = site ? site.startDir : '';
    $('f-secure').value = site && site.protocol === 'sftp' ? 'sftp' : !site || site.secure ? '1' : '0';
    $('f-auth').value = site && site.auth === 'key' ? 'key' : 'password';
    keyPath = (site && site.keyPath) || '';
    syncForm();
    for (const small of $('site-form').querySelectorAll('.err')) small.hidden = true;
    $('dlg-site').showModal();
  }
  $('add-site').addEventListener('click', () => openForm());
  $('f-cancel').addEventListener('click', () => $('dlg-site').close());
  $('f-secure').addEventListener('change', () => {
    // Port elle değiştirilmediyse bağlantı türünün varsayılanına döner.
    if (['', '21', '22'].includes($('f-port').value.trim())) $('f-port').value = isSsh() ? 22 : 21;
    syncForm();
  });
  $('f-auth').addEventListener('change', syncForm);
  $('f-key-pick').addEventListener('click', async () => {
    const picked = await mrc.local.pickKey();
    if (picked) keyPath = picked.path;
    syncForm();
  });
  $('site-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const auth = byKey() ? 'key' : 'password';
    const needPass = auth === 'password' && !(editing && editing.hasPassword && editing.auth !== 'key');
    let ok = !byKey() || Boolean(keyPath);
    $('f-key-row').querySelector('.err').hidden = ok;
    for (const [id, required] of [['f-host', true], ['f-user', true], ['f-pass', needPass]]) {
      const missing = required && !$(id).value.trim();
      $(id).parentElement.querySelector('.err').hidden = !missing;
      if (missing) ok = false;
    }
    if (!ok) return;
    const password = $('f-pass').value;
    const saved = await mrc.sites.save({
      id: editing ? editing.id : undefined,
      name: $('f-name').value.trim() || $('f-host').value.trim(),
      host: $('f-host').value.trim(),
      user: $('f-user').value.trim(),
      password: password || undefined,
      port: Number($('f-port').value) || (isSsh() ? 22 : 21),
      protocol: isSsh() ? 'sftp' : 'ftp',
      auth,
      keyPath,
      startDir: $('f-dir').value.trim() || '/',
      secure: $('f-secure').value !== '0',
    });
    $('dlg-site').close();
    await reload();
    // Şifre saklanamadıysa (şifreleme yok) yazılan şifreyle bağlanılır.
    connect(saved, saved.hasPassword ? undefined : password);
  });

  mrc.sites.onChange(reload); // başka bir sekmede site eklendi, düzenlendi ya da silindi
  // Bu sekme "yeni sekmede aç" ile açıldıysa doğrudan o siteye bağlanır.
  const wanted = new URLSearchParams(location.search).get('site');
  reload().then(() => {
    const site = wanted && sites.find((s) => s.id === wanted);
    if (site) connect(site);
  });
}

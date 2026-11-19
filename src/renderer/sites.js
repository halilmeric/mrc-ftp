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
    mismatch: (c) => `Sertifika başka bir ada ait: ${c.subject}`,
    'self-signed': () => 'Sertifikayı sunucu kendi imzalamış.',
    untrusted: (c) => `Sertifikayı tanınmayan bir kurum vermiş: ${c.issuer}`,
    expired: (c) => `Sertifikanın süresi ${c.validTo} tarihinde dolmuş.`,
    changed: () => 'Sertifika son bağlantıdan bu yana değişmiş.',
  };

  function render() {
    listEl.replaceChildren(...sites.map((site) => {
      if (site.id === confirmId) {
        return el('div', { class: 'confirm' }, 'Silinsin mi?', el('div', { class: 'acts' },
          el('button', { type: 'button', class: 'd', onclick: () => remove(site) }, 'Evet'),
          el('button', { type: 'button', onclick: () => { confirmId = null; render(); } }, 'Vazgeç')));
      }
      const cls = 'site' + (site.id === activeId ? ' on' : '') + (site.id === busyId ? ' busy' : '');
      return el('button', {
        type: 'button', class: cls, title: `${site.user}@${site.host}`,
        onclick: () => connect(site),
        oncontextmenu: (e) => {
          e.preventDefault();
          showMenu(e.clientX, e.clientY, [
            site.id === activeId && { label: 'Bağlantıyı kes', run: disconnect },
            { label: 'Düzenle', run: () => openForm(site) },
            { label: 'Sil', danger: true, run: () => { confirmId = site.id; render(); } },
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
    await mrc.disconnect();
    activeId = null;
    render();
    document.dispatchEvent(new CustomEvent('mrc:disconnected'));
  }

  async function remove(site) {
    const wasActive = site.id === activeId;
    await mrc.sites.remove(site.id);
    confirmId = null;
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
      const { startDir } = await mrc.connect(site.id, password);
      activeId = site.id;
      document.dispatchEvent(new CustomEvent('mrc:connected', { detail: { site, startDir } }));
    } catch (err) {
      if (err.code === 'CERT') askTrust(site, err.cert, password);
      else if (err.code === 'NEED_PASSWORD') askPassword(site);
      else notify(err.message);
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
    $('pass-title').textContent = `${site.name} için şifre`;
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
  function openForm(site) {
    editing = site || null;
    $('site-form-title').textContent = site ? 'Siteyi düzenle' : 'Yeni site';
    $('f-name').value = site ? site.name : '';
    $('f-host').value = site ? site.host : '';
    $('f-user').value = site ? site.user : '';
    $('f-pass').value = '';
    $('f-pass').placeholder = site && site.hasPassword ? 'Değiştirmek için yaz' : '';
    $('f-port').value = site ? site.port : 21;
    $('f-dir').value = site ? site.startDir : '';
    $('f-secure').value = !site || site.secure ? '1' : '0';
    $('f-plain-warn').hidden = $('f-secure').value === '1';
    for (const small of $('site-form').querySelectorAll('.err')) small.hidden = true;
    $('dlg-site').showModal();
  }
  $('add-site').addEventListener('click', () => openForm());
  $('f-cancel').addEventListener('click', () => $('dlg-site').close());
  $('f-secure').addEventListener('change', () => { $('f-plain-warn').hidden = $('f-secure').value === '1'; });
  $('site-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const needPass = !(editing && editing.hasPassword);
    let ok = true;
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
      port: Number($('f-port').value) || 21,
      startDir: $('f-dir').value.trim() || '/',
      secure: $('f-secure').value === '1',
    });
    $('dlg-site').close();
    await reload();
    // Şifre saklanamadıysa (şifreleme yok) yazılan şifreyle bağlanılır.
    connect(saved, saved.hasPassword ? undefined : password);
  });

  reload();
}

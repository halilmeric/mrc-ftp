'use strict';
(function main() {
  const $ = (id) => document.getElementById(id);

  document.addEventListener('mrc:connected', (e) => {
    const { site } = e.detail;
    $('site-name').textContent = site.name;
    $('badge').hidden = false;
    $('badge').textContent = site.secure ? 'Şifreli bağlantı' : 'Şifresiz';
    $('badge').className = 'badge' + (site.secure ? '' : ' plain');
    $('btn-mkdir').hidden = false;
  });
  document.addEventListener('mrc:disconnected', () => {
    $('site-name').textContent = 'Bağlı değil';
    $('badge').hidden = true;
    $('btn-mkdir').hidden = true;
  });

  initSites();
})();

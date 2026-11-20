'use strict';
// Saf biçimlendirme işlevleri; hem arayüzde hem node testlerinde kullanılır.
if (typeof module !== 'undefined') { var { t, getLang } = require('../i18n'); } // tarayıcıda i18n.js'ten gelir
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = -1;
  do { value /= 1024; unit += 1; } while (value >= 1024 && unit < units.length - 1);
  const text = value < 10 && Math.round(value * 10) % 10 !== 0 ? value.toFixed(1).replace('.', getLang() === 'en' ? '.' : ',') : String(Math.round(value));
  return `${text} ${units[unit]}`;
}

function formatDate(iso, now = new Date()) {
  if (!iso) return '—';
  const d = new Date(iso);
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return t('bugün');
  if (diff === 1) return t('dün');
  const short = `${d.getDate()} ${(getLang() === 'en' ? MONTHS_EN : MONTHS)[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? short : `${short} ${d.getFullYear()}`;
}

function formatEta(seconds) {
  if (seconds < 60) return t`${Math.max(1, Math.round(seconds))} sn`;
  return t`${Math.round(seconds / 60)} dk`;
}

const modeToText = (mode) => (mode & 0o777).toString(8).padStart(3, '0');
const textToMode = (text) => (/^[0-7]{3}$/.test(text) ? parseInt(text, 8) : null);

// Toplu ad değiştirme: "bul" doluysa bul → değiştir; boşsa "değiştir" yeni ad kalıbıdır ve uzantı korunur.
// {n} sıra numarasıdır. Dönen her satır { from, to, error }; error doluysa o ad uygulanamaz.
function batchNames(names, find, replace, taken) {
  const pad = String(names.length).length;
  const rows = names.map((from, i) => {
    const dot = from.lastIndexOf('.');
    const ext = dot > 0 ? from.slice(dot) : '';
    const numbered = replace.split('{n}').join(String(i + 1).padStart(pad, '0')); // {n} yalnızca kalıpta sayılır
    return { from, to: find ? from.split(find).join(numbered) : replace ? numbered + ext : from, error: null };
  });
  // Sunucunun dosya sistemi harf büyüklüğünü ayırmıyor olabilir: çakışma kontrolü buna göre yapılır.
  const key = (name) => name.normalize('NFC').toLowerCase();
  const count = new Map();
  for (const r of rows) count.set(key(r.to), (count.get(key(r.to)) || 0) + 1);
  const selected = new Set(names.map(key));
  const others = new Set(taken.map(key).filter((n) => !selected.has(n)));
  for (const r of rows) {
    if (r.to === r.from) continue;
    if (!r.to || r.to === '.' || r.to === '..') r.error = t('ad boş kalıyor');
    else if (/[\\/]/.test(r.to)) r.error = t('ad / içeremez');
    else if (count.get(key(r.to)) > 1) r.error = t('iki öğe aynı adı alıyor');
    else if (others.has(key(r.to)) || (selected.has(key(r.to)) && key(r.to) !== key(r.from))) r.error = t('bu ad zaten var');
  }
  return rows;
}

// Ayarlar'dan kapatılabilen özellikler. Saklanan değer kapalı olanların listesidir; bozuk ya da eksik değer = hepsi açık.
const FEATURE_KEYS = ['terminal', 'favorites', 'parallel', 'edit', 'batch', 'preview'];
function features(raw) {
  let off = [];
  try {
    off = JSON.parse(raw);
  } catch {
    // okunamayan ayar yok sayılır
  }
  if (!Array.isArray(off)) off = [];
  return Object.fromEntries(FEATURE_KEYS.map((k) => [k, !off.includes(k)]));
}

if (typeof module !== 'undefined') module.exports = { formatSize, formatDate, formatEta, modeToText, textToMode, batchNames, features };

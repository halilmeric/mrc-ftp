'use strict';
// Saf biçimlendirme işlevleri; hem arayüzde hem node testlerinde kullanılır.
const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = -1;
  do { value /= 1024; unit += 1; } while (value >= 1024 && unit < units.length - 1);
  const text = value < 10 && Math.round(value * 10) % 10 !== 0 ? value.toFixed(1).replace('.', ',') : String(Math.round(value));
  return `${text} ${units[unit]}`;
}

function formatDate(iso, now = new Date()) {
  if (!iso) return '—';
  const d = new Date(iso);
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return 'bugün';
  if (diff === 1) return 'dün';
  const short = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? short : `${short} ${d.getFullYear()}`;
}

function formatEta(seconds) {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} sn`;
  return `${Math.round(seconds / 60)} dk`;
}

if (typeof module !== 'undefined') module.exports = { formatSize, formatDate, formatEta };

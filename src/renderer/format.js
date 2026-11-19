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

const modeToText = (mode) => (mode & 0o777).toString(8).padStart(3, '0');
const textToMode = (text) => (/^[0-7]{3}$/.test(text) ? parseInt(text, 8) : null);

// Toplu ad değiştirme: "bul" doluysa bul → değiştir; boşsa "değiştir" yeni ad kalıbıdır ve uzantı korunur.
// {n} sıra numarasıdır. Dönen her satır { from, to, error }; error doluysa o ad uygulanamaz.
function batchNames(names, find, replace, taken) {
  const pad = String(names.length).length;
  const rows = names.map((from, i) => {
    const dot = from.lastIndexOf('.');
    const ext = dot > 0 ? from.slice(dot) : '';
    const base = find ? from.split(find).join(replace) : replace ? replace + ext : from;
    return { from, to: base.split('{n}').join(String(i + 1).padStart(pad, '0')), error: null };
  });
  const count = new Map();
  for (const r of rows) count.set(r.to, (count.get(r.to) || 0) + 1);
  const selected = new Set(names);
  const others = new Set(taken.filter((n) => !selected.has(n)));
  for (const r of rows) {
    if (r.to === r.from) continue;
    if (!r.to || r.to === '.' || r.to === '..') r.error = 'ad boş kalıyor';
    else if (/[\\/]/.test(r.to)) r.error = 'ad / içeremez';
    else if (count.get(r.to) > 1) r.error = 'iki öğe aynı adı alıyor';
    else if (others.has(r.to) || selected.has(r.to)) r.error = 'bu ad zaten var';
  }
  return rows;
}

if (typeof module !== 'undefined') module.exports = { formatSize, formatDate, formatEta, modeToText, textToMode, batchNames };

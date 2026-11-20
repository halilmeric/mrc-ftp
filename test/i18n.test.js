const test = require('node:test');
const assert = require('node:assert');
const { t, setLang } = require('../src/i18n');
const { formatSize, formatDate, formatEta } = require('../src/renderer/format');

test('i18n: Türkçede metin olduğu gibi, İngilizcede sözlükten gelir', () => {
  setLang('tr');
  assert.strictEqual(t('Sil'), 'Sil');
  assert.strictEqual(t`Sunucu: ${3} öğe`, 'Sunucu: 3 öğe');
  setLang('en');
  try {
    assert.strictEqual(t('Sil'), 'Delete');
    assert.strictEqual(t`Sunucu: ${3} öğe`, 'Server: 3 items');
    assert.strictEqual(t`${'site'} için ${'Password'}`, 'Password for site'); // numaralı yer tutucu sırayı değiştirir
    assert.strictEqual(t('sözlükte yok'), 'sözlükte yok');
    assert.strictEqual(t`bilinmeyen ${1} kalıp`, 'bilinmeyen 1 kalıp');
    assert.strictEqual(formatSize(1536), '1.5 KB');
    assert.strictEqual(formatEta(30), '30 s');
    assert.strictEqual(formatDate('2026-03-05T10:00:00', new Date('2026-11-21T10:00:00')), '5 Mar');
    assert.strictEqual(formatDate('2026-11-21T08:00:00', new Date('2026-11-21T10:00:00')), 'today');
  } finally {
    setLang('tr');
  }
});

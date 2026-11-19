const test = require('node:test');
const assert = require('node:assert');
const { formatSize, formatDate, formatEta } = require('../src/renderer/format');

test('formatSize', () => {
  assert.strictEqual(formatSize(0), '0 B');
  assert.strictEqual(formatSize(512), '512 B');
  assert.strictEqual(formatSize(1536), '1,5 KB');
  assert.strictEqual(formatSize(4096), '4 KB');
  assert.strictEqual(formatSize(50331648), '48 MB');
  assert.strictEqual(formatSize(2.4 * 1024 * 1024), '2,4 MB');
  assert.strictEqual(formatSize(3 * 1024 ** 3), '3 GB');
});

test('formatDate', () => {
  const now = new Date(2026, 10, 19, 15, 0);
  assert.strictEqual(formatDate(new Date(2026, 10, 19, 9, 0).toISOString(), now), 'bugün');
  assert.strictEqual(formatDate(new Date(2026, 10, 18, 23, 0).toISOString(), now), 'dün');
  assert.strictEqual(formatDate(new Date(2026, 10, 3, 12, 0).toISOString(), now), '3 Kas');
  assert.strictEqual(formatDate(new Date(2025, 10, 3, 12, 0).toISOString(), now), '3 Kas 2025');
  assert.strictEqual(formatDate(null, now), '—');
});

test('formatEta', () => {
  assert.strictEqual(formatEta(7), '7 sn');
  assert.strictEqual(formatEta(59), '59 sn');
  assert.strictEqual(formatEta(150), '3 dk');
  assert.strictEqual(formatEta(0), '1 sn');
});

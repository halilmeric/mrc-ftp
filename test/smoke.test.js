const test = require('node:test');
const assert = require('node:assert');

test('basic-ftp yüklenir', () => {
  assert.strictEqual(typeof require('basic-ftp').Client, 'function');
});

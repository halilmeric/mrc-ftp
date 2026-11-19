const { Transform } = require('node:stream');

// Ortak hız sınırı (bayt/sn; 0 = sınırsız). Eşzamanlı aktarımların hepsi aynı sınırlayıcıdan geçer,
// böylece sınır dosya başına değil toplama uygulanır.
function createLimiter() {
  let rate = 0;
  let nextFree = 0; // bir sonraki parçanın gidebileceği an
  const limiter = {
    get rate() { return rate; },
    set(bytesPerSec) {
      rate = Math.max(0, Number(bytesPerSec) || 0);
      nextFree = 0;
    },
    // n baytlık parçanın gönderilmeden önce bekleyeceği süre (ms).
    delay(n) {
      if (!rate) return 0;
      const now = Date.now();
      const start = Math.max(now, nextFree);
      nextFree = start + (n / rate) * 1000;
      return start - now;
    },
    stream() {
      return new Transform({
        transform(chunk, _enc, done) {
          const wait = limiter.delay(chunk.length);
          if (wait > 0) setTimeout(() => done(null, chunk), wait);
          else done(null, chunk);
        },
      });
    },
  };
  return limiter;
}

module.exports = { createLimiter };

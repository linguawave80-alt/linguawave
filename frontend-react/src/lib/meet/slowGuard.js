// Decides when sign recognition is too slow for this device and should switch itself off.
// Fed the per-frame cost (ms) reported by signEngine. The first `warmup` frames are ignored (GPU shader
// compile / first inference are always slow); after that, if the average of the last `size` frames is
// above `maxMs`, feed() returns true (once) so the caller can disable sign mode.
export function makeSlowGuard({ size = 30, maxMs = 150, warmup = 10 } = {}) {
  let seen = 0, tripped = false;
  const win = [];
  return function feed(ms) {
    if (tripped || !Number.isFinite(ms)) return false;
    if (++seen <= warmup) return false;
    win.push(ms); if (win.length > size) win.shift();
    if (win.length < size) return false;
    const avg = win.reduce((a, b) => a + b, 0) / win.length;
    if (avg > maxMs) { tripped = true; return true; }
    return false;
  };
}

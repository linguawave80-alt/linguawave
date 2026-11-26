// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { makeCaptioner } from './captioner';
import { makeSlowGuard } from './slowGuard';
import { coverMap } from './drawHand';

/** Feed `n` identical frames, 80 ms apart (~12 fps), starting at t. Returns [words, nextT]. */
function run(feed, label, conf, n, t) {
  const words = [];
  for (let i = 0; i < n; i++) { const w = feed(label, conf, t); if (w) words.push(w.text); t += 80; }
  return [words, t];
}

describe('captioner', () => {
  it('emits a word once after enough agreeing frames', () => {
    const feed = makeCaptioner();
    const [w] = run(feed, 'HELLO', 0.95, 12, 1000);
    expect(w).toEqual(['HELLO']);
  });

  it('does not spam while the hand rests on the same sign', () => {
    const feed = makeCaptioner();
    const [w] = run(feed, 'HELLO', 0.95, 15, 1000);        // 1.2 s < repeatMs
    expect(w).toEqual(['HELLO']);
  });

  it('allows the same word again after a pause (hand leaves / unsure frames)', () => {
    const feed = makeCaptioner();
    let [w, t] = run(feed, 'HELLO', 0.95, 10, 1000);
    const [gap, t2] = run(feed, null, 0, 10, t);            // 800 ms with no hand > gapMs
    const [w2] = run(feed, 'HELLO', 0.95, 10, t2);
    expect(w).toEqual(['HELLO']); expect(gap).toEqual([]); expect(w2).toEqual(['HELLO']);
  });

  it('re-emits a held sign only after repeatMs', () => {
    const feed = makeCaptioner();
    const [w] = run(feed, 'STOP', 0.95, 40, 1000);          // 3.2 s of holding
    expect(w.length).toBeGreaterThanOrEqual(2);
    expect(w.length).toBeLessThanOrEqual(3);
  });

  it('ignores low-confidence frames', () => {
    const feed = makeCaptioner();
    const [w] = run(feed, 'HELP', 0.5, 40, 1000);
    expect(w).toEqual([]);
  });

  it('does not emit on a single-frame flicker between two signs', () => {
    const feed = makeCaptioner();
    const words = []; let t = 1000;
    const seq = ['YES', 'YES', 'NO', 'YES', 'YES', 'NO', 'YES', 'YES'];
    for (const l of seq) { const w = feed(l, 0.95, t); if (w) words.push(w.text); t += 80; }
    expect(words.every((x) => x === 'YES')).toBe(true);
  });

  it('emits two different words in order', () => {
    const feed = makeCaptioner();
    let [a, t] = run(feed, 'HELLO', 0.95, 10, 1000);
    const [b] = run(feed, 'PLEASE', 0.95, 12, t);
    expect([...a, ...b]).toEqual(['HELLO', 'PLEASE']);
  });
});

describe('slowGuard', () => {
  it('stays quiet for fast frames', () => {
    const g = makeSlowGuard();
    expect(Array.from({ length: 100 }, () => g(30)).some(Boolean)).toBe(false);
  });
  it('ignores slow warm-up frames', () => {
    const g = makeSlowGuard();
    const r = [...Array.from({ length: 10 }, () => g(2000)), ...Array.from({ length: 60 }, () => g(30))];
    expect(r.some(Boolean)).toBe(false);
  });
  it('trips once when frames are consistently slow', () => {
    const g = makeSlowGuard();
    const r = Array.from({ length: 80 }, () => g(300));
    expect(r.filter(Boolean)).toHaveLength(1);
    expect(r.indexOf(true)).toBe(10 + 30 - 1);              // warmup + one full window
  });
  it('a few spikes do not trip it', () => {
    const g = makeSlowGuard();
    const r = Array.from({ length: 100 }, (_, i) => g(i % 10 === 0 ? 400 : 40));
    expect(r.some(Boolean)).toBe(false);
  });
});

describe('coverMap (skeleton alignment with object-fit: cover)', () => {
  it('matches the crop the browser applies', () => {
    // 640x480 video in a 400x400 box: scale by height, crop the sides equally.
    const { k, ox, oy } = coverMap(640, 480, 400, 400);
    expect(k).toBeCloseTo(400 / 480); expect(oy).toBeCloseTo(0); expect(ox).toBeCloseTo((400 - 640 * k) / 2);
  });
  it('contain letterboxes instead', () => {
    const { k, ox } = coverMap(640, 480, 400, 400, 'contain');
    expect(k).toBeCloseTo(400 / 640); expect(ox).toBeCloseTo(0);
  });
});

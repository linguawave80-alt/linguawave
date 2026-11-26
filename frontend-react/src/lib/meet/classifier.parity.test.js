// @vitest-environment node
// Parity: the browser classifier must reproduce the Python (sklearn) reference outputs.
// Fixtures are written by ml/export_model.py next to the model:  raw landmarks -> normalised -> probabilities.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalize, makeClassifier } from './classifier';

const read = (rel) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
const model = read('../../../public/sign_model.json');
const fx = read('../../../../ml/sign_model.fixtures.json');
const predict = makeClassifier(model);
const toLandmarks = (flat) => Array.from({ length: 21 }, (_, i) => ({ x: flat[i * 3], y: flat[i * 3 + 1], z: flat[i * 3 + 2] }));

describe('sign classifier parity with ml/export_model.py', () => {
  it('fixtures and model agree on shape', () => {
    expect(fx.raw).toHaveLength(fx.proba.length);
    expect(fx.raw[0]).toHaveLength(63);
    expect(fx.proba[0]).toHaveLength(model.labels.length);
  });

  it.each(fx.raw.map((_, i) => i))('sample %i: normalize matches python (±0.001)', (i) => {
    const n = normalize(toLandmarks(fx.raw[i]));
    n.forEach((v, j) => expect(Math.abs(v - fx.norm[i][j])).toBeLessThan(0.001));
  });

  it.each(fx.raw.map((_, i) => i))('sample %i: probabilities match python (±0.001) and same label', (i) => {
    const r = predict(normalize(toLandmarks(fx.raw[i])));
    r.probs.forEach((p, j) => expect(Math.abs(p - fx.proba[i][j])).toBeLessThan(0.001));
    expect(r.label).toBe(fx.pred[i]);
  });

  it('exposes labels and handles a degenerate (all-equal) hand without NaN', () => {
    expect(predict.labels).toEqual(model.labels);
    const flat = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    const r = predict(normalize(flat));
    expect(Number.isFinite(r.conf)).toBe(true);
  });
});

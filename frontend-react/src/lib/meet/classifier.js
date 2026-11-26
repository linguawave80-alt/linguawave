// Tiny MLP forward pass (63 -> 64 -> 32 -> N) for the exported sign model. No ML runtime needed.
// Weights come from /sign_model.json, produced by ml/export_model.py.

/** Same preprocessing as training: wrist at origin, divide by max |coordinate|. `lm` = 21 x {x,y,z}. */
export function normalize(lm) {
  const out = new Float32Array(63);
  const bx = lm[0].x, by = lm[0].y, bz = lm[0].z;
  let mx = 0;
  for (let i = 0; i < 21; i++) {
    const x = lm[i].x - bx, y = lm[i].y - by, z = lm[i].z - bz;
    out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
    mx = Math.max(mx, Math.abs(x), Math.abs(y), Math.abs(z));
  }
  if (mx > 0) for (let i = 0; i < 63; i++) out[i] /= mx;
  return out;
}

export async function loadClassifier(url = '/sign_model.json') {
  const m = await (await fetch(url)).json();
  return makeClassifier(m);
}

export function makeClassifier(m) {
  const { layers, labels } = m;
  const predict = function predict(x) {
    let a = x;
    layers.forEach((L, li) => {
      const next = new Float32Array(L.b.length);
      for (let o = 0; o < next.length; o++) {
        let s = L.b[o]; const w = L.w[o];
        for (let i = 0; i < a.length; i++) s += w[i] * a[i];
        next[o] = li < layers.length - 1 ? Math.max(0, s) : s;      // relu on hidden layers
      }
      a = next;
    });
    let max = -Infinity; for (const v of a) if (v > max) max = v;
    let sum = 0; const p = a.map((v) => { const e = Math.exp(v - max); sum += e; return e; });
    let best = 0; for (let i = 0; i < p.length; i++) { p[i] /= sum; if (p[i] > p[best]) best = i; }
    return { label: labels[best], conf: p[best], probs: p };
  };
  predict.labels = labels;
  return predict;
}

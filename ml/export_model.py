"""Train a small MLP on the SignFlow landmark dataset and export it as plain JSON
(weights only) so the browser can run it with ~30 lines of JS (no onnxruntime, no WASM).
Also evaluates RF vs MLP with a *blocked* split (last 20% of every class, in file order)
because consecutive webcam frames make a random split leak."""
import json, sys, numpy as np, pandas as pd, warnings
warnings.filterwarnings("ignore")
from sklearn.neural_network import MLPClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import LabelEncoder

CSV = sys.argv[1]; OUT = sys.argv[2]
df = pd.read_csv(CSV)
X_raw = df.iloc[:, :-1].values.astype(np.float64); y_raw = df.iloc[:, -1].values
def norm(r):
    p = r.reshape(-1, 3).copy(); p -= p[0]; m = np.abs(p).max()
    if m > 0: p /= m
    return p.flatten()
X = np.array([norm(r) for r in X_raw]); le = LabelEncoder(); y = le.fit_transform(y_raw)

def flip(a):  # mirror augmentation: negate x of every landmark
    b = a.copy(); b[:, 0::3] *= -1; return b
def jitter(a, rng, s=0.02): return a + rng.normal(0, s, a.shape)

# blocked split
tr, te = [], []
for c in range(len(le.classes_)):
    idx = np.where(y == c)[0]; k = int(len(idx) * 0.8); tr += list(idx[:k]); te += list(idx[k:])
Xtr, ytr, Xte, yte = X[tr], y[tr], X[te], y[te]
rng = np.random.default_rng(0)
def aug(Xa, ya): return (np.vstack([Xa, flip(Xa), jitter(Xa, rng), jitter(flip(Xa), rng)]), np.concatenate([ya]*4))

rf = RandomForestClassifier(100, random_state=42).fit(Xtr, ytr)
print("blocked-split acc  RF            :", round(rf.score(Xte, yte), 4))
print("blocked-split acc  RF on mirrored test:", round(rf.score(flip(Xte), yte), 4), "(mirror sensitivity)")
Xa, ya = aug(Xtr, ytr)
mlp = MLPClassifier((64, 32), max_iter=400, random_state=1, early_stopping=True).fit(Xa, ya)
print("blocked-split acc  MLP+augment:", round(mlp.score(Xte, yte), 4))
print("blocked-split acc  MLP on mirrored test:", round(mlp.score(flip(Xte), yte), 4))

# final model on ALL data (+augmentation)
Xa, ya = aug(X, y)
mlp = MLPClassifier((64, 32), max_iter=400, random_state=1, early_stopping=True).fit(Xa, ya)
W = [w.T.round(5).tolist() for w in mlp.coefs_]   # shape [out][in]
B = [b.round(5).tolist() for b in mlp.intercepts_]
json.dump({"labels": list(le.classes_), "layers": [{"w": w, "b": b} for w, b in zip(W, B)],
           "activation": "relu", "input": 63}, open(OUT, "w"), separators=(",", ":"))
# parity fixtures for the JS test
sel = np.random.default_rng(3).choice(len(X), 20, replace=False)
json.dump({"raw": X_raw[sel].round(6).tolist(), "norm": X[sel].round(6).tolist(),
           "proba": mlp.predict_proba(X[sel]).round(5).tolist(), "pred": [str(le.classes_[i]) for i in mlp.predict(X[sel])]},
          open(OUT.replace(".json", ".fixtures.json"), "w"))
print("final train acc:", round(mlp.score(X, y), 4)); print("classes:", list(le.classes_))

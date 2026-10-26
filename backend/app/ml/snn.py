"""
Jaringan spiking LIF yang dilatih (surrogate gradient + BPTT), murni NumPy.

Arsitektur:  rasio kepadatan 24 jam terakhir (+ fitur waktu target) -> H neuron LIF (arus langsung)
             -> fitur [laju spike, potensial membran akhir] -> regresi linear -> rasio kepadatan jam berikutnya.
Neuron: v_t = beta * (1 - s_{t-1}) * v_{t-1} + I_t ;  s_t = 1 jika v_t >= 1 (reset ke 0 setelah spike).
Gradien melewati fungsi spike dengan surrogate 'fast sigmoid'; reset diperlakukan konstan (detach).
Tidak butuh PyTorch, jadi dapat dilatih dan dijalankan di mesin biasa.
"""
from __future__ import annotations

import numpy as np

from app.ml.dataset import time_features

SG_K = 5.0


def _sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


def seq_inputs(hist: np.ndarray, ts_list) -> np.ndarray:
    """(n,24) riwayat + waktu target -> (n,24,6): [rasio_t, 5 fitur waktu target (konstan sepanjang langkah)]."""
    n, T = hist.shape
    tf = np.array([time_features(t) for t in ts_list])  # (n,5)
    return np.concatenate([hist[:, :, None], np.repeat(tf[:, None, :], T, axis=1)], axis=2)


class SpikingRegressor:
    def __init__(self, n_in: int = 6, hidden: int = 48, seed: int = 0):
        rng = np.random.default_rng(seed)
        self.H = hidden
        self.W = rng.normal(0, 1.0, (n_in, hidden)) * 0.9
        self.b = rng.normal(0, 0.3, hidden)
        self.beta_p = rng.normal(1.4, 0.4, hidden)  # beta = sigmoid(beta_p) ~ 0.8
        self.Wo = rng.normal(0, 0.1, 2 * hidden)
        self.b0 = 0.5

    @property
    def beta(self):
        return _sigmoid(self.beta_p)

    # ---- maju ----
    def forward(self, X: np.ndarray, smooth: bool = False, reset: bool = True):
        B, T, _ = X.shape
        beta = self.beta
        v = np.zeros((B, self.H))
        s_prev = np.zeros((B, self.H))
        cache = {"v_prev": [], "r": [], "v": [], "s": []}
        for t in range(T):
            I = X[:, t, :] @ self.W + self.b
            r = (1 - s_prev) if reset else np.ones_like(v)
            v_new = beta * r * v + I
            s = _sigmoid(SG_K * (v_new - 1)) if smooth else (v_new >= 1.0).astype(float)
            cache["v_prev"].append(v); cache["r"].append(r); cache["v"].append(v_new); cache["s"].append(s)
            v, s_prev = v_new, s
        rate = np.mean(cache["s"], axis=0)
        feat = np.concatenate([rate, v], axis=1)
        y = feat @ self.Wo + self.b0
        cache.update(feat=feat, X=X, smooth=smooth)
        return y, cache

    # ---- mundur (BPTT) ----
    def backward(self, dy: np.ndarray, cache: dict) -> dict:
        X, H = cache["X"], self.H
        B, T, _ = X.shape
        beta = self.beta
        g = {"Wo": cache["feat"].T @ dy, "b0": dy.sum()}
        dfeat = dy[:, None] * self.Wo[None, :]
        d_rate, d_vT = dfeat[:, :H], dfeat[:, H:]
        dW, db, dbeta = np.zeros_like(self.W), np.zeros(H), np.zeros(H)
        g_next = None
        for t in reversed(range(T)):
            u = cache["v"][t] - 1.0
            if cache["smooth"]:
                sg = SG_K * cache["s"][t] * (1 - cache["s"][t])
            else:
                sg = 1.0 / (1.0 + SG_K * np.abs(u)) ** 2
            gt = d_rate / T * sg
            if t == T - 1:
                gt = gt + d_vT
            else:
                gt = gt + g_next * beta * cache["r"][t + 1]
            dW += X[:, t, :].T @ gt
            db += gt.sum(0)
            dbeta += (gt * cache["r"][t] * cache["v_prev"][t]).sum(0)
            g_next = gt
        g.update(W=dW, b=db, beta_p=dbeta * beta * (1 - beta))
        return g

    # ---- latih ----
    PARAMS = ("W", "b", "beta_p", "Wo", "b0")

    def fit(self, Xtr, ytr, Xva, yva, epochs=60, batch=256, lr=3e-3, seed=0, log=None):
        rng = np.random.default_rng(seed)
        m = {k: np.zeros_like(getattr(self, k), dtype=float) for k in self.PARAMS}
        s2 = {k: np.zeros_like(getattr(self, k), dtype=float) for k in self.PARAMS}
        best, best_state, step, history = 1e9, None, 0, []
        for ep in range(epochs):
            idx = rng.permutation(len(ytr))
            for i in range(0, len(idx), batch):
                b = idx[i:i + batch]
                y, cache = self.forward(Xtr[b])
                grads = self.backward(2 * (y - ytr[b]) / len(b), cache)
                step += 1
                for k in self.PARAMS:
                    m[k] = 0.9 * m[k] + 0.1 * grads[k]
                    s2[k] = 0.999 * s2[k] + 0.001 * grads[k] ** 2
                    upd = (m[k] / (1 - 0.9 ** step)) / (np.sqrt(s2[k] / (1 - 0.999 ** step)) + 1e-8)
                    setattr(self, k, getattr(self, k) - lr * upd)
            val = float(np.abs(self.predict(Xva) - yva).mean())
            history.append(val)
            if val < best:
                best, best_state = val, {k: np.array(getattr(self, k), copy=True) for k in self.PARAMS}
            if log and (ep % 5 == 0 or ep == epochs - 1):
                log(f"epoch {ep + 1:3d}  MAE validasi {val:.4f}  (terbaik {best:.4f})")
        for k, v in best_state.items():
            setattr(self, k, v)
        return {"best_val_mae": best, "val_curve": history}

    def predict(self, X: np.ndarray, chunk: int = 2048) -> np.ndarray:
        return np.concatenate([self.forward(X[i:i + chunk])[0] for i in range(0, len(X), chunk)])

    def save(self, path):
        np.savez(path, **{k: np.asarray(getattr(self, k)) for k in self.PARAMS}, hidden=self.H)

    @classmethod
    def load(cls, path):
        z = np.load(path)
        obj = cls(n_in=z["W"].shape[0], hidden=int(z["hidden"]))
        for k in cls.PARAMS:
            setattr(obj, k, z[k] if z[k].ndim else float(z[k]))
        return obj

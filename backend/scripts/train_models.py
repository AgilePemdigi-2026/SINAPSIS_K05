"""
Melatih dan mengevaluasi model prediksi kepadatan jam berikutnya.   Jalankan dari root proyek:
    python scripts/train_models.py

Model:
  A. Gradient Boosting (scikit-learn)           -> data/models/gbm.joblib
  B. Jaringan spiking LIF (surrogate gradient)  -> data/models/snn.npz
Pembanding: persistensi (jam depan = jam ini) dan seasonal-naive 24 jam.
Pembagian KRONOLOGIS: latih < 2017-03-01 <= validasi < 2017-05-01 <= uji.
Model terbaik dipilih dari MAE VALIDASI (bukan uji) dan dicatat di data/models/metrics.json.
"""
import json
import sys
import time
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.ml.dataset import build  # noqa: E402
from app.ml.snn import SpikingRegressor, seq_inputs  # noqa: E402

CUT_TRAIN, CUT_VAL = datetime(2017, 3, 1), datetime(2017, 5, 1)
OUT = ROOT / "data" / "models"


def metrics(pred, y):
    return {"mae": round(float(np.abs(pred - y).mean()), 4),
            "rmse": round(float(np.sqrt(((pred - y) ** 2).mean())), 4),
            "wape": round(float(np.abs(pred - y).sum() / np.abs(y).sum()), 4)}


def early_warning(pred, y, thr):
    p, t = pred >= thr, y >= thr
    tp, fp, fn = (p & t).sum(), (p & ~t).sum(), (~p & t).sum()
    prec, rec = tp / max(1, tp + fp), tp / max(1, tp + fn)
    return {"precision": round(float(prec), 3), "recall": round(float(rec), 3),
            "f1": round(float(2 * prec * rec / max(1e-9, prec + rec)), 3)}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    d, scale = build(CUT_TRAIN, CUT_VAL)
    tr, va, te = d["train"], d["val"], d["test"]
    print(f"data: latih {len(tr['y'])}, validasi {len(va['y'])}, uji {len(te['y'])}")

    # ---- A. Gradient boosting ----
    t0, best = time.time(), None
    for lr in (0.05, 0.1):
        for depth in (3, 5, None):
            for leaf in (20, 60):
                m = HistGradientBoostingRegressor(learning_rate=lr, max_depth=depth, min_samples_leaf=leaf,
                                                  max_iter=400, early_stopping=False, random_state=0)
                m.fit(tr["X"], tr["y"])
                v = float(np.abs(m.predict(va["X"]) - va["y"]).mean())
                if best is None or v < best[0]:
                    best = (v, dict(learning_rate=lr, max_depth=depth, min_samples_leaf=leaf))
    gbm = HistGradientBoostingRegressor(max_iter=400, early_stopping=False, random_state=0, **best[1]).fit(tr["X"], tr["y"])
    joblib.dump(gbm, OUT / "gbm.joblib", compress=3)
    print(f"GBM selesai {time.time() - t0:.0f}s, hiperparameter: {best[1]}")

    # ---- B. Jaringan spiking ----
    S = {k: seq_inputs(v["hist"], v["ts"]) for k, v in d.items()}
    t0 = time.time()
    snn = SpikingRegressor(hidden=48, seed=0)
    info = snn.fit(S["train"], tr["y"], S["val"], va["y"], epochs=100, lr=3e-3, log=print)
    snn.save(OUT / "snn.npz")
    print(f"SNN selesai {time.time() - t0:.0f}s")

    # ---- evaluasi ----
    preds = {
        "persistensi": {k: d[k]["hist"][:, -1] for k in d},
        "seasonal_naive_24j": {k: d[k]["hist"][:, -24] for k in d},
        "gradient_boosting": {k: gbm.predict(d[k]["X"]) for k in d},
        "snn_lif_terlatih": {k: snn.predict(S[k]) for k in d},
    }
    preds["ensemble_gbm_snn"] = {k: (preds["gradient_boosting"][k] + preds["snn_lif_terlatih"][k]) / 2 for k in d}
    thr = float(np.percentile(tr["y"], 85))
    result = {}
    for name, p in preds.items():
        result[name] = {"val": metrics(p["val"], va["y"]), "test": metrics(p["test"], te["y"]),
                        "peringatan_dini_uji": early_warning(p["test"], te["y"], thr),
                        "per_junction_mae_uji": {int(j): round(float(np.abs(p["test"][te["junction"] == j] - te["y"][te["junction"] == j]).mean()), 4) for j in (1, 2, 3, 4)}}
    candidates = ("gradient_boosting", "snn_lif_terlatih", "ensemble_gbm_snn")
    best_name = min(candidates, key=lambda n: result[n]["val"]["mae"])
    _, c = snn.forward(S["test"][:1000])
    out = {
        "split": {"latih": f"< {CUT_TRAIN.date()}", "validasi": f"{CUT_TRAIN.date()} s.d. < {CUT_VAL.date()}", "uji": f">= {CUT_VAL.date()}",
                  "n": {"latih": len(tr["y"]), "validasi": len(va["y"]), "uji": len(te["y"])}},
        "skala_rasio_p95_per_junction": scale,
        "ambang_padat_rasio_p85": round(thr, 3),
        "gbm_hiperparameter": best[1],
        "snn": {"hidden": snn.H, "epoch": 100, "best_val_mae": round(info["best_val_mae"], 4),
                "laju_spike_rata2": round(float(np.mean(c["s"])), 3)},
        "model_terbaik_menurut_validasi": best_name,
        "hasil": result,
    }
    (OUT / "metrics.json").write_text(json.dumps(out, indent=2))
    print(json.dumps({"model_terbaik": best_name, **{n: {"mae_uji": r["test"]["mae"], "wape_uji": r["test"]["wape"],
          "f1_peringatan_dini": r["peringatan_dini_uji"]["f1"]} for n, r in result.items()}}, indent=2))


if __name__ == "__main__":
    main()

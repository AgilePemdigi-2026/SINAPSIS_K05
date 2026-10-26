"""Layanan inferensi prediksi kepadatan jam berikutnya (memuat model hasil scripts/train_models.py)."""
from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path

import numpy as np

from app.ml.dataset import WINDOW, make_features
from app.ml.snn import SpikingRegressor, seq_inputs

log = logging.getLogger("sinapsis.ml")
MODEL_DIR = Path(__file__).resolve().parents[2] / "data" / "models"


class Predictor:
    def __init__(self, gbm=None, snn: SpikingRegressor | None = None, metrics: dict | None = None):
        if gbm is None and snn is None:
            raise ValueError("minimal satu model diperlukan")
        self.gbm, self.snn, self.metrics = gbm, snn, metrics or {}
        self.congestion_ratio = float(self.metrics.get("ambang_padat_rasio_p85", 0.8))

    @property
    def name(self) -> str:
        if self.gbm is not None and self.snn is not None:
            return "ensemble_gbm_snn"
        return "gradient_boosting" if self.gbm is not None else "snn_lif_terlatih"

    def predict_next(self, hist: np.ndarray, ts: datetime) -> np.ndarray:
        """hist: (n_jalur, 24) rasio kepadatan 24 jam terakhir; ts: waktu jam yang diprediksi. Return (n_jalur,)."""
        if hist.ndim != 2 or hist.shape[1] != WINDOW:
            raise ValueError(f"hist harus berbentuk (n, {WINDOW})")
        outs = []
        if self.gbm is not None:
            outs.append(self.gbm.predict(make_features(hist, [ts] * len(hist))))
        if self.snn is not None:
            outs.append(self.snn.predict(seq_inputs(hist, [ts] * len(hist))))
        return np.clip(np.mean(outs, axis=0), 0.0, 1.5)

    @classmethod
    def load(cls, model_dir: Path = MODEL_DIR) -> "Predictor | None":
        gbm = snn = None
        metrics = {}
        try:
            metrics = json.loads((model_dir / "metrics.json").read_text())
        except Exception as e:  # noqa: BLE001
            log.warning("metrics.json tidak terbaca: %s", e)
        try:
            import joblib
            gbm = joblib.load(model_dir / "gbm.joblib")
        except Exception as e:  # noqa: BLE001  (mis. beda versi scikit-learn)
            log.warning("gbm.joblib tidak dapat dimuat (%s). Jalankan 'python scripts/train_models.py' ulang.", e)
        try:
            snn = SpikingRegressor.load(model_dir / "snn.npz")
        except Exception as e:  # noqa: BLE001
            log.warning("snn.npz tidak dapat dimuat: %s", e)
        if gbm is None and snn is None:
            return None
        return cls(gbm, snn, metrics)


_cached: dict = {}


def get_predictor() -> Predictor | None:
    if "p" not in _cached:
        _cached["p"] = Predictor.load()
    return _cached["p"]

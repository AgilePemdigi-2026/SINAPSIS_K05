"""Model terlatih: pelatihan, evaluasi jujur, inferensi, dan integrasi ke mesin keputusan."""
import json
from datetime import datetime
from pathlib import Path

import numpy as np

from app.ml.predictor import Predictor, get_predictor
from app.ml.snn import SpikingRegressor, seq_inputs
from app.services import monitoring_service as svc
from app.services.neuromorphic import IntersectionEngine, Params

MODELS = Path(__file__).resolve().parents[1] / "data" / "models"
M = json.loads((MODELS / "metrics.json").read_text())


# ---- bukti pelatihan & evaluasi ------------------------------------------------
def test_trained_models_beat_persistence_baseline_on_holdout():
    r = M["hasil"]
    base = r["persistensi"]["test"]["mae"]
    for name in ("gradient_boosting", "snn_lif_terlatih", "ensemble_gbm_snn"):
        assert r[name]["test"]["mae"] < base, name
    assert r["ensemble_gbm_snn"]["peringatan_dini_uji"]["f1"] > r["persistensi"]["peringatan_dini_uji"]["f1"]


def test_split_is_chronological_without_overlap():
    s = M["split"]
    assert s["latih"] == "< 2017-03-01" and s["uji"] == ">= 2017-05-01"
    assert s["n"]["latih"] > s["n"]["uji"] > 0


def test_snn_really_spikes_and_learned():
    assert 0.05 < M["snn"]["laju_spike_rata2"] < 0.9      # bukan neuron mati / jenuh
    assert M["snn"]["best_val_mae"] < 0.13                # jauh di bawah awal latihan (~0.25)


def test_snn_save_load_roundtrip(tmp_path):
    snn = SpikingRegressor.load(MODELS / "snn.npz")
    snn.save(tmp_path / "x.npz")
    again = SpikingRegressor.load(tmp_path / "x.npz")
    hist = np.random.default_rng(0).uniform(0.2, 0.9, (5, 24))
    X = seq_inputs(hist, [datetime(2017, 5, 3, 9)] * 5)
    assert np.allclose(snn.predict(X), again.predict(X))


def test_snn_gradients_match_numerical():
    rng = np.random.default_rng(1)
    m = SpikingRegressor(hidden=6, seed=3)
    X, y = rng.normal(0.5, 0.3, (5, 8, 6)), rng.normal(0.5, 0.2, 5)
    loss = lambda: ((m.forward(X, smooth=True, reset=False)[0] - y) ** 2).mean()  # noqa: E731
    p, c = m.forward(X, smooth=True, reset=False)
    g = m.backward(2 * (p - y) / len(y), c)
    for name in ("W", "b", "beta_p", "Wo"):
        flat = getattr(m, name).reshape(-1)
        for i in rng.choice(flat.size, min(3, flat.size), replace=False):
            old = flat[i]
            flat[i] = old + 1e-6; l1 = loss()
            flat[i] = old - 1e-6; l2 = loss()
            flat[i] = old
            assert abs((l1 - l2) / 2e-6 - g[name].reshape(-1)[i]) < 1e-6


# ---- inferensi -----------------------------------------------------------------
def test_predictor_output_shape_range_and_fallback():
    pred = get_predictor()
    assert pred is not None and pred.name in ("ensemble_gbm_snn", "gradient_boosting", "snn_lif_terlatih")
    hist = np.full((4, 24), 0.5)
    out = pred.predict_next(hist, datetime(2017, 5, 3, 19))
    assert out.shape == (4,) and np.all((out >= 0) & (out <= 1.5))
    only_snn = Predictor(None, SpikingRegressor.load(MODELS / "snn.npz"), M)  # mesin tanpa scikit-learn kompatibel
    assert only_snn.name == "snn_lif_terlatih"
    assert only_snn.predict_next(hist, datetime(2017, 5, 3, 19)).shape == (4,)


def test_prediction_reacts_to_rising_traffic():
    pred = get_predictor()
    calm, busy = np.full((1, 24), 0.2), np.full((1, 24), 0.9)
    ts = datetime(2017, 5, 3, 20)
    assert pred.predict_next(busy, ts)[0] > pred.predict_next(calm, ts)[0] + 0.2


# ---- integrasi ke mesin keputusan & API -----------------------------------------
def test_prediction_influences_priority_ranking():
    e = IntersectionEngine()
    out = e.step([8, 8, 8, 8], 10, Params(), predicted=[0.1, 0.1, 0.9, 0.1])
    assert out["prediction_used"] is True and out["lanes"][2]["priority_rank"] == 1
    no_pred = IntersectionEngine().step([8, 8, 8, 8], 10, Params())
    assert no_pred["prediction_used"] is False and no_pred["lanes"][0]["predicted_ratio"] is None


def test_prediction_endpoint_pilot_ready_immediately(client, petugas):
    r = client.get("/api/prediction/1", headers=petugas).json()
    assert r["tersedia"] is True and len(r["jalur"]) == 4
    assert {"arah", "prediksi_rasio", "prediksi_kendaraan", "peringatan_dini"} <= set(r["jalur"][0])


def test_prediction_needs_history_for_other_intersections(client, admin):
    r = client.get("/api/prediction/2", headers=admin).json()
    assert r["tersedia"] is False and r["riwayat"] == 0
    for _ in range(24):
        client.post("/api/monitoring/cycle", headers=admin, json={"id_persimpangan": 2, "vehicle_counts": [8, 6, 5, 4]})
    assert client.get("/api/prediction/2", headers=admin).json()["tersedia"] is True


def test_cycle_includes_prediction_and_model_info(client, admin):
    out = client.post("/api/monitoring/cycle", headers=admin, json={"id_persimpangan": 1, "vehicle_counts": [10, 6, 5, 4]}).json()
    assert out["prediction_used"] is True and out["prediction_model"] and out["lanes"][0]["predicted_ratio"] is not None
    info = client.get("/api/prediction/model-info", headers=admin).json()
    assert info["ringkasan_uji"]["persistensi"]["mae"] > info["ringkasan_uji"]["ensemble_gbm_snn"]["mae"]
    assert client.get("/api/prediction/1").status_code == 401

"""Uji unit mesin LIF (tanpa database)."""
from app.core.config import settings
from app.services.neuromorphic import IntersectionEngine, Params


def test_dense_lane_spikes_and_gets_green():
    e, p = IntersectionEngine(), Params()
    out = e.step([16, 5, 8, 3], hour=20, params=p)
    lanes = out["lanes"]
    assert lanes[0]["spike"] is True
    assert [l["signal"] for l in lanes].count("HIJAU") == 1 and lanes[0]["signal"] == "HIJAU"
    assert all(p.min_green <= l["duration"] <= p.max_green for l in lanes)


def test_adaptive_threshold_by_period():
    p = Params()
    assert p.threshold_for(20)[1] == "JAM SIBUK"
    assert p.threshold_for(10)[1] == "JAM NORMAL"
    assert p.threshold_for(4)[1] == "JAM MALAM"
    assert p.threshold_for(20)[0] < p.threshold_for(10)[0] < p.threshold_for(4)[0]


def test_default_parameters_come_from_calibration():
    assert Params().spike_threshold == 0.76  # hasil kalibrasi, docs/calibration_report.md


def test_refractory_prevents_consecutive_spikes():
    e, p = IntersectionEngine(), Params()
    spikes = [e.step([20, 0, 0, 0], 20, p)["lanes"][0]["spike"] for _ in range(5)]
    assert spikes[0] is True and spikes[1:4] == [False, False, False]


def test_critical_lane_forces_green_max():
    e, p = IntersectionEngine(), Params()
    out = e.step([19, 2, 2, 2], 10, p)
    assert out["critical_lanes"] == [0]
    assert out["lanes"][0]["signal"] == "HIJAU" and out["lanes"][0]["duration"] == p.max_green


def test_corridor_overrides_decision():
    e, p = IntersectionEngine(), Params()
    out = e.step([3, 3, 3, 3], 10, p, corridor_lanes={2})
    assert out["lanes"][2]["signal"] == "HIJAU" and out["corridor_active"] is True


def test_input_is_clamped_and_validated():
    e, p = IntersectionEngine(), Params()
    out = e.step([999, -5, 3, 3], 10, p)
    assert out["lanes"][0]["vehicle_count"] == settings.MAX_VEHICLES and out["lanes"][1]["vehicle_count"] == 0
    try:
        e.step([1, 2], 10, p)
        assert False, "harus menolak jumlah jalur salah"
    except ValueError:
        pass

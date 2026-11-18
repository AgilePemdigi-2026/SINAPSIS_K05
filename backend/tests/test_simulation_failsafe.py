"""Fitur 11 — Simulasi Skenario Lalu Lintas & Mode Fail-Safe: unit + integration tests."""
from app.services import monitoring_service as svc
from app.services.neuromorphic import IntersectionEngine, Params
from app.services.sensor_source import OfflineSensorSource, SyntheticSensorSource


# ---- Unit Tests: Neuromorphic Fail-Safe Step ----

def test_failsafe_step_rotates_lanes_round_robin():
    """Fail-safe step merotasi jalur hijau secara bergantian setiap siklus."""
    engine = IntersectionEngine(n_lanes=4)
    params = Params()

    # Siklus 1: Jalur 0 (Utara) HIJAU, lainnya MERAH
    step1 = engine.fail_safe_step(params, fixed_green=25)
    assert step1["fail_safe_active"] is True
    assert step1["lanes"][0]["signal"] == "HIJAU"
    assert step1["lanes"][0]["duration"] == 25
    assert all(step1["lanes"][i]["signal"] == "MERAH" for i in (1, 2, 3))

    # Siklus 2: Jalur 1 (Selatan) HIJAU
    step2 = engine.fail_safe_step(params, fixed_green=25)
    assert step2["lanes"][1]["signal"] == "HIJAU"
    assert all(step2["lanes"][i]["signal"] == "MERAH" for i in (0, 2, 3))

    # Siklus 3: Jalur 2 (Timur) HIJAU
    step3 = engine.fail_safe_step(params, fixed_green=25)
    assert step3["lanes"][2]["signal"] == "HIJAU"
    assert all(step3["lanes"][i]["signal"] == "MERAH" for i in (0, 1, 3))

    # Siklus 4: Jalur 3 (Barat) HIJAU
    step4 = engine.fail_safe_step(params, fixed_green=25)
    assert step4["lanes"][3]["signal"] == "HIJAU"
    assert all(step4["lanes"][i]["signal"] == "MERAH" for i in (0, 1, 2))

    # Siklus 5: Kembali ke Jalur 0 (rotasi sempurna)
    step5 = engine.fail_safe_step(params, fixed_green=25)
    assert step5["lanes"][0]["signal"] == "HIJAU"


def test_failsafe_step_interlocking_safety():
    """Interlocking Safety per SRS 5.2: dilarang menyalakan HIJAU bersamaan."""
    engine = IntersectionEngine(n_lanes=4)
    params = Params()

    for _ in range(8):
        res = engine.fail_safe_step(params)
        green_lanes = [l for l in res["lanes"] if l["signal"] == "HIJAU"]
        assert len(green_lanes) == 1, "Harus tepat 1 jalur HIJAU per siklus fail-safe"
        assert res["lanes"][0]["membrane_potential"] >= 0.0


# ---- Integration Tests: Simulation Scenarios ----

def test_simulation_all_profiles(client, admin):
    """Pengujian seluruh profil skenario simulasi."""
    for profile in ("NORMAL", "RUSH_HOUR", "EMERGENCY", "NIGHT"):
        r = client.post("/api/admin/simulations", headers=admin, json={
            "profil": profile, "jumlah_siklus": 10, "seed": 42
        })
        assert r.status_code == 200
        data = r.json()
        assert data["profil"] == profile
        assert data["siklus"] == 10
        assert len(data["total_spike_per_jalur"]) == 4
        assert len(data["rata_rata_hijau_per_jalur"]) == 4


def test_simulation_weather_noise(client, admin):
    """Simulasi skenario dengan injeksi gangguan cuaca ekstrem."""
    r = client.post("/api/admin/simulations", headers=admin, json={
        "profil": "RUSH_HOUR",
        "jumlah_siklus": 15,
        "inject_weather_noise": True,
        "seed": 99,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["ringkasan_skenario"]["cuaca_ekstrem_noise"] is True
    assert data["ringkasan_skenario"]["interlocking_safety_terpenuhi"] is True


def test_simulation_sensor_failure_triggers_failsafe(client, admin):
    """Simulasi sensor failure mengaktifkan mekanisme fail-safe fallback."""
    r = client.post("/api/admin/simulations", headers=admin, json={
        "profil": "NORMAL",
        "jumlah_siklus": 16,
        "simulasi_sensor_failure": True,
        "seed": 12,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["siklus_sensor_offline"] == 4
    assert data["siklus_fail_safe"] == 4
    assert data["mode_fail_safe_aktif"] is True
    assert "Fail-Safe Fixed-Timer Interlocking" in data["mekanisme_keamanan"]
    assert data["ringkasan_skenario"]["total_siklus_fail_safe"] == 4
    assert data["ringkasan_skenario"]["total_siklus_adaptif"] == 12


def test_simulation_scenarios_metadata_endpoint(client, admin):
    """GET /api/admin/simulations/scenarios mengembalikan metadata skenario."""
    r = client.get("/api/admin/simulations/scenarios", headers=admin)
    assert r.status_code == 200
    data = r.json()
    assert "profil_tersedia" in data
    assert len(data["profil_tersedia"]) == 4
    assert "opsi_gangguan" in data
    assert "SRS 5.2" in data["standar_keamanan"]


def test_simulation_history_endpoint(client, admin):
    """GET /api/admin/simulations/history mencatat riwayat simulasi."""
    client.post("/api/admin/simulations", headers=admin, json={"profil": "NORMAL", "jumlah_siklus": 5})
    r = client.get("/api/admin/simulations/history", headers=admin)
    assert r.status_code == 200
    history = r.json()
    assert len(history) >= 1
    assert history[0]["profil_skenario"] == "NORMAL"
    assert history[0]["jumlah_siklus"] == 5


# ---- Operational Fail-Safe Endpoints ----

def test_failsafe_status_all_intersections(client, admin):
    """GET /api/monitoring/fail-safe/status mengembalikan status seluruh persimpangan."""
    r = client.get("/api/monitoring/fail-safe/status", headers=admin)
    assert r.status_code == 200
    data = r.json()
    assert data["total_persimpangan"] == 5
    assert data["persimpangan_adaptif"] == 5
    assert data["persimpangan_failsafe"] == 0

    # Jadikan satu simpang offline
    svc.hub.sources[2] = OfflineSensorSource()
    client.post("/api/monitoring/refresh", headers=admin)

    r2 = client.get("/api/monitoring/fail-safe/status", headers=admin)
    data2 = r2.json()
    assert data2["persimpangan_failsafe"] == 1
    p2 = next(s for s in data2["status"] if s["id_persimpangan"] == 2)
    assert p2["mode_operasi"] == "FAIL_SAFE"


def test_execute_failsafe_cycle_endpoint(client, admin):
    """POST /api/monitoring/fail-safe/{id} mengeksekusi satu siklus fail-safe."""
    r = client.post("/api/monitoring/fail-safe/1", headers=admin, params={"fixed_green": 30})
    assert r.status_code == 200
    data = r.json()
    assert data["fail_safe_active"] is True
    assert data["period"] == "FAIL_SAFE_FIXED_TIMER"
    # Tepat 1 jalur HIJAU dengan durasi 30 detik
    hijau_lanes = [l for l in data["lanes"] if l["signal"] == "HIJAU"]
    assert len(hijau_lanes) == 1
    assert hijau_lanes[0]["duration"] == 30
    assert "Mode Fail-Safe" in hijau_lanes[0]["reason"]


def test_failsafe_persists_to_history(client, admin):
    """Siklus fail-safe mencatat keputusan sinyal ke database operasional."""
    client.post("/api/monitoring/fail-safe/1", headers=admin, params={"fixed_green": 20})
    h = client.get("/api/monitoring/history/1", headers=admin).json()
    assert len(h["keputusan"]) >= 4
    assert any(k["warna"] == "HIJAU" for k in h["keputusan"])


def test_failsafe_nonexistent_intersection(client, admin):
    """Eksekusi fail-safe pada persimpangan yang tidak ada mengembalikan 404."""
    r = client.post("/api/monitoring/fail-safe/9999", headers=admin)
    assert r.status_code == 404


def test_failsafe_accessible_by_petugas(client, petugas):
    """Petugas Lalu Lintas memiliki akses ke status dan eksekusi fail-safe."""
    assert client.get("/api/monitoring/fail-safe/status", headers=petugas).status_code == 200
    assert client.post("/api/monitoring/fail-safe/1", headers=petugas).status_code == 200

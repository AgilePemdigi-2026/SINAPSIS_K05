"""Pengujian Stabilitas Telemetri 5 Persimpangan & Mekanisme Fail-Safe Saat Gangguan Sensor.

Sesuai tugas revisi Ryandar (Monitoring, Simulasi & Failsafe):
1. Menguji stabilitas telemetri siklus lalu lintas dan congestion alert saat 5 simpang berjalan bersamaan (monitoring.py, simulation_service.py).
2. Memastikan mekanisme failsafe berjalan mulus apabila salah satu dari 5 simpang mengalami gangguan sensor/CCTV.
"""
import pytest
from app.services import monitoring_service as svc
from app.services.sensor_source import OfflineSensorSource, SyntheticSensorSource


def test_five_intersections_concurrent_telemetry_stability(client, petugas):
    """
    Tugas 1: Menguji stabilitas telemetri siklus lalu lintas saat 5 simpang berjalan bersamaan.
    Memastikan seluruh 5 simpang memiliki telemetri lengkap (lengan, sinyal, durasi, prediksi).
    """
    # Jalankan refresh data beberapa kali berturut-turut untuk menguji stabilitas konkurensi
    for cycle_num in range(3):
        r = client.post("/api/monitoring/refresh", headers=petugas)
        assert r.status_code == 200
        data = r.json()
        assert data["pesan"] == "Data lalu lintas berhasil dimuat ulang."
        assert len(data["simpang"]) == 5, f"Harus memuat tepat 5 simpang pada siklus {cycle_num + 1}"

        # Periksa integritas data telemetri per simpang
        for s in data["simpang"]:
            assert s["id_persimpangan"] in (1, 2, 3, 4, 5)
            assert s["nama_lokasi"] in ("Simpang Gubeng", "Simpang Pemuda", "Simpang Raya", "Simpang Wonokromo", "Simpang Kertajaya")
            assert s["sensor_offline"] is False
            assert s["status"] in ("Lancar", "Padat", "Kritis")
            assert s["jumlah_kendaraan"] >= 0
            assert len(s["jalur"]) >= 3
            # Setiap lajur harus memiliki sinyal lampu (HIJAU / MERAH) dan durasi valid
            assert any(j["sinyal"] == "HIJAU" for j in s["jalur"])
            assert all(j["durasi"] > 0 for j in s["jalur"])


def test_multi_intersection_congestion_alert(client, admin):
    """
    Tugas 1: Menguji pemicuan congestion alert saat beberapa persimpangan padat/kritis bersamaan.
    """
    # Simulasikan lonjakan volume kendaraan ekstrem pada Simpang Gubeng (id=1) dan Simpang Wonokromo (id=4)
    client.post("/api/monitoring/cycle", headers=admin,
                json={"id_persimpangan": 1, "vehicle_counts": [19, 4, 4, 3]})
    client.post("/api/monitoring/cycle", headers=admin,
                json={"id_persimpangan": 4, "vehicle_counts": [18, 5, 3, 2]})

    r = client.get("/api/monitoring/dashboard", headers=admin)
    assert r.status_code == 200
    data = r.json()

    # Congestion alert harus aktif dan mencakup kedua simpang kritis
    assert data["congestion_alert"] is True
    assert "Simpang Gubeng" in data["pesan_alert"]
    assert "Simpang Wonokromo" in data["pesan_alert"]

    # Periksa bahwa alert tercatat di modul notifikasi alerts
    alerts_r = client.get("/api/monitoring/alerts", headers=admin)
    assert alerts_r.status_code == 200
    alerts = alerts_r.json()["alerts"]
    kritis_pids = [a["id_persimpangan"] for a in alerts if a["severity"] == "KRITIS"]
    assert 1 in kritis_pids
    assert 4 in kritis_pids


def test_one_of_five_intersections_failsafe_isolation(client, admin, petugas):
    """
    Tugas 2: Memastikan mekanisme failsafe berjalan mulus apabila salah satu dari 5 simpang
    mengalami gangguan sensor/CCTV, TANPA mengganggu 4 persimpangan lainnya.
    """
    # Gangguan sensor pada Simpang Raya (id=3)
    svc.hub.sources[3] = OfflineSensorSource()

    # Lakukan refresh sistem
    r = client.post("/api/monitoring/refresh", headers=petugas)
    assert r.status_code == 200
    data = r.json()

    # Pesan sensor offline aktif di dashboard
    assert data["pesan_sensor"] == "Data pemantauan tidak tersedia untuk beberapa simpang."

    # Simpang 3 harus berstatus Sensor Offline
    s3 = next(s for s in data["simpang"] if s["id_persimpangan"] == 3)
    assert s3["status"] == "Sensor Offline"
    assert s3["sensor_offline"] is True

    # 4 Simpang lainnya (Gubeng, Pemuda, Wonokromo, Kertajaya) HARUS TETAP NORMAL
    normal_simpang = [s for s in data["simpang"] if s["id_persimpangan"] != 3]
    assert len(normal_simpang) == 4
    for ns in normal_simpang:
        assert ns["sensor_offline"] is False
        assert ns["status"] in ("Lancar", "Padat", "Kritis")
        assert ns["jumlah_kendaraan"] > 0

    # Eksekusi mode Fail-Safe untuk Simpang 3
    fs_r = client.post("/api/monitoring/fail-safe/3", headers=admin, params={"fixed_green": 20})
    assert fs_r.status_code == 200
    fs_data = fs_r.json()
    assert fs_data["fail_safe_active"] is True
    assert fs_data["period"] == "FAIL_SAFE_FIXED_TIMER"

    # Verifikasi Interlocking Safety pada simpang 3: tepat 1 lajur HIJAU, lainnya MERAH
    hijau = [l for l in fs_data["lanes"] if l["signal"] == "HIJAU"]
    merah = [l for l in fs_data["lanes"] if l["signal"] == "MERAH"]
    assert len(hijau) == 1
    assert len(merah) == len(fs_data["lanes"]) - 1
    assert hijau[0]["duration"] == 20

    # Periksa status fail-safe jaringan: 4 adaptif, 1 failsafe
    st = client.get("/api/monitoring/fail-safe/status", headers=admin).json()
    assert st["total_persimpangan"] == 5
    assert st["persimpangan_adaptif"] == 4
    assert st["persimpangan_failsafe"] == 1


def test_sensor_recovery_returns_to_adaptive_smoothly(client, admin, petugas):
    """
    Tugas 2: Memastikan pemulihan sensor/CCTV mengembalikan simpang ke mode adaptif AI secara mulus.
    """
    # 1. Simpang 5 (Kertajaya) offline
    svc.hub.sources[5] = OfflineSensorSource()
    d1 = client.post("/api/monitoring/refresh", headers=petugas).json()
    assert d1["pesan_sensor"] is not None
    s5_off = next(s for s in d1["simpang"] if s["id_persimpangan"] == 5)
    assert s5_off["sensor_offline"] is True

    # 2. Kamera/Sensor Simpang 5 pulih
    svc.hub.sources[5] = SyntheticSensorSource("NORMAL", seed=50)
    d2 = client.post("/api/monitoring/refresh", headers=petugas).json()

    # Pesan sensor offline hilang
    assert d2["pesan_sensor"] is None
    s5_recovered = next(s for s in d2["simpang"] if s["id_persimpangan"] == 5)
    assert s5_recovered["sensor_offline"] is False
    assert s5_recovered["status"] in ("Lancar", "Padat", "Kritis")
    assert s5_recovered["jumlah_kendaraan"] > 0


def test_network_simulation_five_intersections_with_selective_failure(client, admin):
    """
    Tugas 1 & 2: Pengujian simulasi jaringan 5 persimpangan sekaligus pada simulation_service.py
    dengan injeksi kegagalan sensor pada salah satu persimpangan.
    """
    r = client.post("/api/admin/simulations/network", headers=admin, json={
        "profil": "RUSH_HOUR",
        "jumlah_siklus": 10,
        "gangguan_simpang_ids": [2],  # Simpang Pemuda mengalami gangguan
        "inject_weather_noise": True,
        "seed": 100,
    })
    assert r.status_code == 200
    res = r.json()
    assert res["total_persimpangan"] == 5
    assert res["persimpangan_aktif_ai"] == 4
    assert res["persimpangan_fail_safe"] == 1
    assert "Simpang Pemuda" in res["simpang_terdampak_gangguan"]
    assert res["stabilitas_telemetri"] is True
    assert res["interlocking_safety_terpenuhi"] is True
    assert res["total_siklus_keseluruhan"] == 50  # 10 siklus * 5 simpang
    assert res["total_siklus_failsafe"] == 10     # 10 siklus untuk simpang 2
    assert res["total_siklus_adaptif"] == 40      # 10 siklus * 4 simpang

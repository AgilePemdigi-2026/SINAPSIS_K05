"""Fitur Pantau Kondisi Lalu Lintas."""
from app.services import monitoring_service as svc
from app.services.sensor_source import CsvSensorSource, OfflineSensorSource


def test_dashboard_after_refresh(client, petugas):
    r = client.post("/api/monitoring/refresh", headers=petugas)
    assert r.status_code == 200
    d = r.json()
    assert d["pesan"] == "Data lalu lintas berhasil dimuat ulang."
    assert len(d["simpang"]) == 4 and all(s["jumlah_kendaraan"] > 0 for s in d["simpang"])


def test_congestion_alert_when_critical(client, admin):
    client.post("/api/monitoring/cycle", headers=admin, json={"id_persimpangan": 1, "vehicle_counts": [19, 3, 3, 3]})
    d = client.get("/api/monitoring/dashboard", headers=admin).json()
    assert d["congestion_alert"] is True
    assert d["pesan_alert"].startswith("Peringatan: Kemacetan Terdeteksi di Persimpangan Simpang Gubeng")


def test_sensor_offline_and_recovery(client, admin):
    svc.hub.sources[2] = OfflineSensorSource()
    d = client.post("/api/monitoring/refresh", headers=admin).json()
    offline = [s for s in d["simpang"] if s["status"] == "Sensor Offline"]
    assert len(offline) == 1 and offline[0]["id_persimpangan"] == 2
    assert d["pesan_sensor"] == "Data pemantauan tidak tersedia untuk beberapa simpang."
    # sensor pulih -> Refresh Data kembali normal
    from app.services.sensor_source import SyntheticSensorSource
    svc.hub.sources[2] = SyntheticSensorSource("NORMAL", seed=1)
    d = client.post("/api/monitoring/refresh", headers=admin).json()
    assert d["pesan_sensor"] is None


def test_manual_cycle_validation_and_persistence(client, admin):
    bad = client.post("/api/monitoring/cycle", headers=admin, json={"id_persimpangan": 1, "vehicle_counts": [1, 2]})
    assert bad.status_code == 422
    ok = client.post("/api/monitoring/cycle", headers=admin, json={"id_persimpangan": 1, "vehicle_counts": [12, 5, 8, 3], "simulated_hour": 20})
    assert ok.status_code == 200 and ok.json()["period"] == "JAM SIBUK"
    h = client.get("/api/monitoring/history/1", headers=admin).json()
    assert len(h["deteksi"]) == 4 and len(h["keputusan"]) == 4


def test_csv_source_maps_four_junctions():
    src = CsvSensorSource()
    r = src.read()
    assert len(r["counts"]) == 4 and all(0 <= c <= 20 for c in r["counts"]) and 0 <= r["hour"] <= 23

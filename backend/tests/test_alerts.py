"""Fitur 10 — Congestion Alert & Sensor Offline: unit + integration tests."""
from app.services import monitoring_service as svc
from app.services import alert_service
from app.services.sensor_source import OfflineSensorSource, SyntheticSensorSource


# ---- Alert Service Unit Tests ----

def test_congestion_alert_generated_kritis(client, admin):
    """Alert KRITIS dibuat saat densitas >= 85%."""
    # Inject counts yang membuat simpang 1 kritis (19/20 = 95%)
    client.post("/api/monitoring/cycle", headers=admin,
                json={"id_persimpangan": 1, "vehicle_counts": [19, 3, 3, 3]})
    r = client.get("/api/monitoring/dashboard", headers=admin)
    assert r.status_code == 200
    data = r.json()
    # Dashboard harus menampilkan congestion alert
    assert data["congestion_alert"] is True
    assert "Peringatan: Kemacetan Terdeteksi di Persimpangan" in data["pesan_alert"]
    # Alert summary harus ada
    assert data["alert_summary"]["total_aktif"] >= 1
    assert data["alert_summary"]["congestion_aktif"] >= 1


def test_congestion_alert_peringatan_dini(client, admin):
    """Alert PERINGATAN_DINI dibuat saat densitas >= 80% tapi < 85%."""
    # 16/20 = 80% → Peringatan Dini
    client.post("/api/monitoring/cycle", headers=admin,
                json={"id_persimpangan": 1, "vehicle_counts": [16, 3, 3, 3]})
    r = client.get("/api/monitoring/dashboard", headers=admin)
    data = r.json()
    # Mungkin belum Kritis tapi ada peringatan dini di alerts
    alerts_r = client.get("/api/monitoring/alerts", headers=admin)
    assert alerts_r.status_code == 200
    alerts_data = alerts_r.json()
    # Cari alert peringatan dini
    dini_alerts = [a for a in alerts_data["alerts"]
                   if a["severity"] == "PERINGATAN_DINI" and a["id_persimpangan"] == 1]
    assert len(dini_alerts) >= 1
    assert "Peringatan Dini" in dini_alerts[0]["pesan"]


def test_sensor_offline_alert_generated(client, admin):
    """Alert SENSOR_OFFLINE dibuat saat sensor mati."""
    svc.hub.sources[2] = OfflineSensorSource()
    r = client.post("/api/monitoring/refresh", headers=admin)
    assert r.status_code == 200
    data = r.json()
    assert data["pesan_sensor"] == "Data pemantauan tidak tersedia untuk beberapa simpang."
    # Harus ada sensor offline alert
    alerts_r = client.get("/api/monitoring/alerts", headers=admin)
    alerts_data = alerts_r.json()
    offline_alerts = [a for a in alerts_data["alerts"]
                      if a["tipe"] == "SENSOR_OFFLINE" and a["id_persimpangan"] == 2]
    assert len(offline_alerts) >= 1
    assert "Sensor Offline" in offline_alerts[0]["pesan"]


def test_sensor_offline_alert_recovery(client, admin):
    """Setelah sensor pulih, alert sensor offline lama tetap ada tapi tidak ada alert baru."""
    svc.hub.sources[2] = OfflineSensorSource()
    client.post("/api/monitoring/refresh", headers=admin)
    # Pulihkan sensor
    svc.hub.sources[2] = SyntheticSensorSource("NORMAL", seed=1)
    client.post("/api/monitoring/refresh", headers=admin)
    # Dashboard tidak lagi menampilkan pesan sensor
    d = client.get("/api/monitoring/dashboard", headers=admin).json()
    assert d["pesan_sensor"] is None


# ---- Alert Endpoints Tests ----

def test_get_active_alerts(client, admin):
    """GET /api/monitoring/alerts mengembalikan alert aktif."""
    # Trigger a congestion alert dulu
    client.post("/api/monitoring/cycle", headers=admin,
                json={"id_persimpangan": 1, "vehicle_counts": [19, 3, 3, 3]})
    client.get("/api/monitoring/dashboard", headers=admin)
    r = client.get("/api/monitoring/alerts", headers=admin)
    assert r.status_code == 200
    data = r.json()
    assert "alerts" in data
    assert "summary" in data
    assert len(data["alerts"]) >= 1


def test_get_alerts_history(client, admin):
    """GET /api/monitoring/alerts/history mengembalikan riwayat."""
    client.post("/api/monitoring/cycle", headers=admin,
                json={"id_persimpangan": 1, "vehicle_counts": [19, 3, 3, 3]})
    client.get("/api/monitoring/dashboard", headers=admin)
    r = client.get("/api/monitoring/alerts/history", headers=admin)
    assert r.status_code == 200
    data = r.json()
    assert "alerts" in data
    assert len(data["alerts"]) >= 1


def test_acknowledge_alert(client, admin):
    """POST /api/monitoring/alerts/{id}/acknowledge berhasil."""
    # Create alert
    client.post("/api/monitoring/cycle", headers=admin,
                json={"id_persimpangan": 1, "vehicle_counts": [19, 3, 3, 3]})
    client.get("/api/monitoring/dashboard", headers=admin)
    # Get alerts
    alerts = client.get("/api/monitoring/alerts", headers=admin).json()["alerts"]
    assert len(alerts) >= 1
    alert_id = alerts[0]["id_alert"]
    # Acknowledge
    r = client.post(f"/api/monitoring/alerts/{alert_id}/acknowledge", headers=admin)
    assert r.status_code == 200
    assert r.json()["pesan"] == "Alert berhasil di-acknowledge."
    assert r.json()["alert"]["acknowledged"] is True
    # Setelah acknowledge, alert tidak lagi di daftar aktif
    active = client.get("/api/monitoring/alerts", headers=admin).json()["alerts"]
    assert all(a["id_alert"] != alert_id for a in active)


def test_acknowledge_nonexistent_alert(client, admin):
    """Acknowledge alert yang tidak ada mengembalikan 404."""
    r = client.post("/api/monitoring/alerts/9999/acknowledge", headers=admin)
    assert r.status_code == 404


def test_alerts_require_auth(client):
    """Endpoint alert membutuhkan autentikasi."""
    r = client.get("/api/monitoring/alerts")
    assert r.status_code in (401, 403)


def test_alert_deduplication(client, admin):
    """Alert tidak duplikat untuk persimpangan yang sama dalam waktu singkat."""
    # Trigger 2x congestion di simpang yang sama
    client.post("/api/monitoring/cycle", headers=admin,
                json={"id_persimpangan": 1, "vehicle_counts": [19, 3, 3, 3]})
    client.get("/api/monitoring/dashboard", headers=admin)
    client.post("/api/monitoring/cycle", headers=admin,
                json={"id_persimpangan": 1, "vehicle_counts": [19, 3, 3, 3]})
    client.get("/api/monitoring/dashboard", headers=admin)
    # Harus tetap hanya 1 alert KRITIS untuk simpang 1
    alerts = client.get("/api/monitoring/alerts", headers=admin).json()["alerts"]
    kritis_1 = [a for a in alerts
                if a["tipe"] == "CONGESTION" and a["severity"] == "KRITIS" and a["id_persimpangan"] == 1]
    assert len(kritis_1) == 1


def test_dashboard_includes_alert_summary(client, admin):
    """Dashboard response includes alert_summary field."""
    r = client.post("/api/monitoring/refresh", headers=admin)
    assert r.status_code == 200
    data = r.json()
    assert "alert_summary" in data
    assert "total_aktif" in data["alert_summary"]
    assert "congestion_aktif" in data["alert_summary"]
    assert "sensor_offline_aktif" in data["alert_summary"]


"""Step definitions untuk alerts.feature (Fitur 10: Congestion Alert & Sensor Offline)."""
from pytest_bdd import given, parsers, scenarios, then, when

from app.services import monitoring_service as svc
from app.services.sensor_source import OfflineSensorSource

scenarios("features/alerts.feature")


# Step `sensor persimpangan {pid} sedang offline` sudah ada di test_monitoring_bdd.py
# tapi pytest-bdd perlu definisi di file yang sama, jadi kita definisikan ulang
@given(parsers.parse("sensor persimpangan {pid:d} sedang offline"))
def sensor_offline(pid):
    svc.hub.sources[pid] = OfflineSensorSource()


# --- Re-use step definitions dari monitoring feature ---

@when(parsers.parse('saya menjalankan siklus manual di persimpangan {pid:d} dengan kendaraan "{counts}"'),
      target_fixture="response")
def siklus_manual(client, headers, pid, counts):
    return client.post("/api/monitoring/cycle", headers=headers,
                       json={"id_persimpangan": pid, "vehicle_counts": [int(c) for c in counts.split(",")]})


@when("saya membuka dashboard", target_fixture="dashboard")
def buka_dashboard(client, headers):
    return client.get("/api/monitoring/dashboard", headers=headers).json()


@when("saya menekan Refresh Data", target_fixture="response")
def refresh(client, headers):
    return client.post("/api/monitoring/refresh", headers=headers)


@then(parsers.parse('peringatan kemacetan aktif untuk "{nama}"'))
def cek_alert(dashboard, nama):
    assert dashboard["congestion_alert"] is True
    assert nama in dashboard["pesan_alert"]


@then(parsers.parse('persimpangan {pid:d} berstatus "{status}"'))
def cek_status_simpang(response, pid, status):
    item = next(s for s in response.json()["simpang"] if s["id_persimpangan"] == pid)
    assert item["status"] == status


@then(parsers.parse('pesan sensor adalah "{pesan}"'))
def cek_pesan_sensor(response, pesan):
    assert response.json()["pesan_sensor"] == pesan


# --- Alert-specific step definitions ---

@when("saya mengambil daftar alert aktif", target_fixture="alerts_response")
def ambil_alerts(client, headers):
    return client.get("/api/monitoring/alerts", headers=headers)


@when("saya acknowledge alert pertama", target_fixture="ack_response")
def acknowledge_first(client, headers, alerts_response):
    alerts = alerts_response.json()["alerts"]
    assert len(alerts) > 0, "Tidak ada alert untuk di-acknowledge"
    alert_id = alerts[0]["id_alert"]
    return client.post(f"/api/monitoring/alerts/{alert_id}/acknowledge", headers=headers)


@then("alert summary menunjukkan congestion aktif")
def cek_alert_summary(dashboard):
    assert "alert_summary" in dashboard
    assert dashboard["alert_summary"]["congestion_aktif"] >= 1


@then(parsers.parse("terdapat alert sensor offline untuk persimpangan {pid:d}"))
def cek_sensor_offline_alert(client, headers, pid):
    r = client.get("/api/monitoring/alerts", headers=headers)
    alerts = r.json()["alerts"]
    offline_alerts = [a for a in alerts if a["tipe"] == "SENSOR_OFFLINE" and a["id_persimpangan"] == pid]
    assert len(offline_alerts) >= 1, f"Tidak ada alert SENSOR_OFFLINE untuk persimpangan {pid}"


@then("daftar alert tidak kosong")
def cek_alerts_not_empty(alerts_response):
    data = alerts_response.json()
    assert len(data["alerts"]) > 0


@then("alert berhasil di-acknowledge")
def cek_acknowledge(ack_response):
    assert ack_response.status_code == 200
    assert ack_response.json()["pesan"] == "Alert berhasil di-acknowledge."
    assert ack_response.json()["alert"]["acknowledged"] is True

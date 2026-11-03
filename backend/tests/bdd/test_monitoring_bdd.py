from pytest_bdd import given, parsers, scenarios, then, when

from app.services import monitoring_service as svc
from app.services.sensor_source import OfflineSensorSource

scenarios("features/monitoring.feature")


@given(parsers.parse("sensor persimpangan {pid:d} sedang offline"))
def sensor_offline(pid):
    svc.hub.sources[pid] = OfflineSensorSource()


@when("saya menekan Refresh Data", target_fixture="response")
def refresh(client, headers):
    return client.post("/api/monitoring/refresh", headers=headers)


@when(parsers.parse('saya menjalankan siklus manual di persimpangan {pid:d} dengan kendaraan "{counts}"'),
      target_fixture="response")
def siklus_manual(client, headers, pid, counts):
    return client.post("/api/monitoring/cycle", headers=headers,
                       json={"id_persimpangan": pid, "vehicle_counts": [int(c) for c in counts.split(",")]})


@when("saya membuka dashboard", target_fixture="dashboard")
def buka_dashboard(client, headers):
    return client.get("/api/monitoring/dashboard", headers=headers).json()


@then(parsers.parse('pesan respons adalah "{pesan}"'))
def cek_pesan(response, pesan):
    assert response.json()["pesan"] == pesan


@then(parsers.parse("dashboard menampilkan {n:d} persimpangan"))
def cek_jumlah(response, n):
    assert len(response.json()["simpang"]) == n


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
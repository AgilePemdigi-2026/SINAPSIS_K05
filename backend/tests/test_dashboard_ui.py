"""Dashboard Pemantauan (F2): halaman, mode tanpa login Sprint 1, dan payload untuk diagram."""
import pytest

from app.core.config import settings
from app.main import FRONTEND_DIR


@pytest.fixture()
def public(monkeypatch):
    monkeypatch.setattr(settings, "DASHBOARD_PUBLIC", True)


@pytest.mark.skipif(FRONTEND_DIR is None, reason="folder frontend tidak ada (jalankan dari repo lengkap)")
def test_dashboard_page_and_assets_served(client):
    page = client.get("/dashboard")
    assert page.status_code == 200 and "text/html" in page.headers["content-type"]
    assert "Diagram skematik persimpangan aktif" in page.text and "Refresh Data" in page.text
    assert client.get("/static/dashboard.js").status_code == 200
    assert client.get("/static/dashboard.css").status_code == 200
    assert client.get("/").json()["dashboard"] == "/dashboard"


def test_public_mode_opens_only_monitoring_and_prediction(client, public):
    assert client.get("/api/monitoring/dashboard").status_code == 200
    r = client.post("/api/monitoring/refresh")
    assert r.status_code == 200 and r.json()["pesan"] == "Data lalu lintas berhasil dimuat ulang."
    assert client.get("/api/prediction/1").status_code == 200
    # fitur lain tetap wajib login
    assert client.post("/api/monitoring/cycle", json={"id_persimpangan": 1}).status_code == 401
    assert client.get("/api/admin/users").status_code == 401
    assert client.post("/api/emergency/search", json={"tujuan": "Jalan Darmo"}).status_code == 401


def test_locked_mode_requires_login(client):
    assert client.get("/api/monitoring/dashboard").status_code == 401
    assert client.post("/api/monitoring/refresh").status_code == 401


def test_dashboard_payload_has_lane_details_after_refresh(client, public):
    d = client.post("/api/monitoring/refresh").json()
    assert d["kapasitas_jalur"] == settings.MAX_VEHICLES and d["waktu_data"]
    pilot = d["simpang"][0]
    assert [l["arah"] for l in pilot["jalur"]] == ["Utara", "Selatan", "Timur", "Barat"]
    lane = pilot["jalur"][0]
    assert {"jumlah_kendaraan", "densitas_pct", "sinyal", "durasi", "spike", "peringkat", "prediksi_rasio"} <= set(lane)
    assert pilot["jalur_terpadat"]["jumlah"] == max(l["jumlah_kendaraan"] for l in pilot["jalur"])
    assert pilot["model_prediksi"] and pilot["prediksi_maks_pct"] is not None   # simpang pilot sudah punya riwayat 24 jam
    assert d["ambang_peringatan_dini_pct"] == 80
    assert d["simpang"][1]["model_prediksi"] is None                              # simpang lain belum punya riwayat


def test_payload_before_any_cycle_has_empty_details(client, public):
    d = client.get("/api/monitoring/dashboard").json()
    assert all(s["jalur"] == [] and s["status"] == "Belum ada data" for s in d["simpang"])


def test_critical_and_offline_states_reach_payload(client, public):
    from app.services import monitoring_service as svc
    from app.services.sensor_source import OfflineSensorSource
    client.post("/api/monitoring/refresh")
    h = {"Authorization": "Bearer " + client.post("/api/auth/login", json={
        "username": "admin_sinapsis", "password": "adminSecure2026"}).json()["access_token"]}
    client.post("/api/monitoring/cycle", headers=h, json={"id_persimpangan": 1, "vehicle_counts": [19, 3, 3, 3], "simulated_hour": 20})
    d = client.get("/api/monitoring/dashboard").json()
    assert d["congestion_alert"] and d["simpang"][0]["status"] == "Kritis" and d["simpang"][0]["jalur_terpadat"]["arah"] == "Utara"
    svc.hub.sources[2] = OfflineSensorSource()
    d = client.post("/api/monitoring/refresh").json()
    off = d["simpang"][1]
    assert off["status"] == "Sensor Offline" and off["data_usang"] is True and off["status_algoritma"] == "Sensor Offline"
    assert d["pesan_sensor"] == "Data pemantauan tidak tersedia untuk beberapa simpang."


def test_dashboard_page_explains_when_frontend_missing(client, monkeypatch):
    import app.main as main
    monkeypatch.setattr(main, "FRONTEND_DIR", None)
    r = client.get("/dashboard")
    assert r.status_code == 404 and "frontend" in r.json()["detail"].lower()

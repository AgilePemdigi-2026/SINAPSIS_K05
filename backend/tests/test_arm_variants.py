"""Variasi lengan persimpangan: 4 (perempatan) dan 3 (pertigaan, arah mana pun) di registrasi, siklus, dan dashboard."""
import shutil
import subprocess
from pathlib import Path

import pytest

from app.services.arms import arm_type, normalize_arms

URL = "/api/admin/intersections"
DASH = "/api/monitoring/dashboard"
JS_TEST = Path(__file__).parent / "js" / "arm_detect.test.js"


def _add(client, admin, nama, lengan=None, **extra):
    body = {"nama_lokasi": nama, **extra}
    if lengan is not None:
        body["lengan"] = lengan
    return client.post(URL, headers=admin, json=body)


def _dash_item(client, admin, nama):
    return next(s for s in client.get(DASH, headers=admin).json()["simpang"] if s["nama_lokasi"] == nama)


def test_default_is_four_arms(client, admin):
    r = _add(client, admin, "Simpang Default")
    assert r.status_code == 201 and r.json()["jumlah_lengan"] == 4
    assert [j["arah"] for j in _dash_item(client, admin, "Simpang Default")["jalur"]] == ["Utara", "Selatan", "Timur", "Barat"]


@pytest.mark.parametrize("lengan,tipe", [
    (["Utara", "Selatan", "Timur"], "Pertigaan (3 lengan)"),
    (["Utara", "Selatan", "Barat"], "Pertigaan (3 lengan)"),
    (["Barat", "Timur", "Selatan"], "Pertigaan (3 lengan)"),
    (["Utara", "Timur", "Barat"], "Pertigaan (3 lengan)"),
    (["Utara", "Selatan", "Timur", "Barat"], "Perempatan (4 lengan)"),
])
def test_register_varied_arms_gets_data_for_those_arms_only(client, admin, lengan, tipe):
    nama = "Simpang " + "-".join(lengan)
    r = _add(client, admin, nama, lengan)
    assert r.status_code == 201
    body = r.json()
    assert body["jumlah_lengan"] == len(lengan) and body["tipe"] == tipe and body["data_awal"] is True
    item = _dash_item(client, admin, nama)
    expected = [a for a in ["Utara", "Selatan", "Timur", "Barat"] if a in lengan]  # urutan kanonik
    assert [j["arah"] for j in item["jalur"]] == expected
    assert item["jumlah_lengan"] == len(lengan) and item["tipe"] == tipe and item["status"] != "Belum ada data"
    assert item["jumlah_kendaraan"] == sum(j["jumlah_kendaraan"] for j in item["jalur"])
    listed = next(i for i in client.get(URL, headers=admin).json() if i["nama_lokasi"] == nama)
    assert listed["jumlah_lengan"] == len(lengan) and listed["tipe"] == tipe


def test_varied_intersection_keeps_working_after_refresh_and_cycle(client, admin):
    _add(client, admin, "Simpang T", ["Utara", "Timur", "Barat"])
    for _ in range(3):
        assert client.post("/api/monitoring/refresh", headers=admin).status_code == 200
    item = _dash_item(client, admin, "Simpang T")
    assert len(item["jalur"]) == 3 and sum(1 for j in item["jalur"] if j["sinyal"] == "HIJAU") == 1


@pytest.mark.parametrize("lengan,pesan", [
    (["Utara"], "minimal punya 3"),
    (["Utara", "Selatan"], "minimal punya 3"),
    (["Timur", "Barat"], "minimal punya 3"),
    ([], "minimal punya 3"),
    (["Utara", "Utara", "Timur"], "duplikat"),
    (["Utara", "Atas"], "tidak dikenal"),
])
def test_invalid_arms_rejected(client, admin, lengan, pesan):
    r = _add(client, admin, "Simpang Salah", lengan)
    assert r.status_code == 422 and pesan in r.json()["detail"].lower()
    assert all(i["nama_lokasi"] != "Simpang Salah" for i in client.get(URL, headers=admin).json())


def test_manual_cycle_validates_count_per_intersection(client, admin):
    pid = _add(client, admin, "Simpang Manual", ["Utara", "Selatan", "Barat"]).json()["id_persimpangan"]
    bad = client.post("/api/monitoring/cycle", headers=admin, json={"id_persimpangan": pid, "vehicle_counts": [1, 2, 3, 4]})
    assert bad.status_code == 422 and "tepat 3" in bad.json()["detail"]
    ok = client.post("/api/monitoring/cycle", headers=admin, json={"id_persimpangan": pid, "vehicle_counts": [5, 6, 7]})
    assert ok.status_code == 200 and len(ok.json()["lanes"]) == 3


def test_arm_helpers():
    assert normalize_arms(None) == ["Utara", "Selatan", "Timur", "Barat"]
    assert normalize_arms(["Barat", "Timur", "Utara"]) == ["Utara", "Timur", "Barat"]
    assert arm_type(["Utara", "Timur", "Barat"]) == "Pertigaan (3 lengan)"
    assert arm_type(["Utara", "Selatan", "Timur", "Barat"]) == "Perempatan (4 lengan)"
    with pytest.raises(ValueError):
        normalize_arms(["Utara", "Selatan"])


def test_registration_page_has_arm_picker_and_detector(client):
    page = client.get("/admin/intersections/add").text
    assert page.count('name="lengan"') == 4 and 'id="armPreview"' in page and "/static/arm_detect.js" in page
    assert client.get("/static/arm_detect.js").status_code == 200


def test_dashboard_diagram_draws_only_present_arms(client):
    js = client.get("/static/dashboard.js").text
    assert "drawRoads(s, arms)" in js and "arms.indexOf(name)" in js


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js tidak terpasang")
def test_arm_detection_js_unit():
    r = subprocess.run(["node", str(JS_TEST)], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr + r.stdout


def test_prediction_endpoint_before_first_cycle_does_not_break_arm_count(client, admin):
    """Membuka /api/prediction sebelum siklus pertama tidak boleh memaksa sumber 4 lengan pada simpang 3 lengan."""
    from app.services import monitoring_service as svc
    pid = _add(client, admin, "Simpang Prediksi", ["Utara", "Selatan", "Barat"]).json()["id_persimpangan"]
    svc.hub.sources.pop(pid, None)  # simulasi server baru menyala: sumber belum dibuat
    assert client.get(f"/api/prediction/{pid}", headers=admin).status_code == 200
    assert client.post("/api/monitoring/refresh", headers=admin).status_code == 200
    assert len(_dash_item(client, admin, "Simpang Prediksi")["jalur"]) == 3

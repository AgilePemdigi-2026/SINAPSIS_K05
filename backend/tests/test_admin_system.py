"""Kelola Sistem: halaman Parameter Sistem (REQ-14) dan Pengguna (REQ-15) + API pendukung."""
import re

import pytest

PARAM = "/api/admin/parameters"
USERS = "/api/admin/users"


@pytest.mark.parametrize("path", ["/admin/parameters", "/admin/users", "/admin/users/add"])
def test_admin_system_pages_served(client, path):
    r = client.get(path)
    assert r.status_code == 200 and "admin_system.js" in r.text
    assert client.get("/static/admin_system.js").status_code == 200


def test_page_has_spec_elements(client):
    html = client.get("/admin/parameters").text
    assert 'name="jenis_parameter"' in html and 'name="nilai"' in html and "Update Parameter" in html and "Reset Nilai" in html
    assert "Parameter Aktif" in html and "Riwayat Perubahan" in html
    users = client.get("/admin/users/add").text
    for name in ('name="nama"', 'name="username"', 'name="password"', 'name="role"'):
        assert name in users
    assert "Tambah Pengguna" in users and "Reset Isian" in users and "Petugas Lalu Lintas" in users


def test_tabs_are_enabled_on_intersection_pages(client):
    for path in ("/admin/intersections", "/admin/intersections/add"):
        html = client.get(path).text
        assert 'href="/admin/parameters"' in html and 'href="/admin/users/add"' in html
        assert "Parameter Sistem</span>" not in html  # bukan lagi tab nonaktif


def test_parameters_list_has_ui_fields(client, admin):
    rows = client.get(PARAM, headers=admin).json()
    assert {r["jenis_parameter"] for r in rows} == {"spike_threshold", "min_green_time", "max_green_time", "amber_duration"}
    for r in rows:
        assert r["label"] and r["satuan"] and r["tipe"] in ("int", "float") and "baseline" in r and len(r["rentang"]) == 2
    spike = next(r for r in rows if r["jenis_parameter"] == "spike_threshold")
    assert spike["tipe"] == "float" and spike["diubah_terakhir"] is None


def test_update_returns_transaction_id_and_history_has_name(client, admin):
    r = client.put(PARAM, headers=admin, json={"jenis_parameter": "amber_duration", "nilai": 4}).json()
    assert r["pesan"] == "Parameter konfigurasi berhasil diperbarui!" and re.fullmatch(r"TRX-\d{6}", r["id_transaksi"]) and r["waktu"]
    h = client.get(PARAM + "/history", headers=admin).json()[0]
    assert h["id_transaksi"] == r["id_transaksi"] and h["nilai"] == "4" and h["diubah_oleh_nama"]
    row = next(p for p in client.get(PARAM, headers=admin).json() if p["jenis_parameter"] == "amber_duration")
    assert row["nilai_aktif"] == 4 and row["diubah_terakhir"]


def test_min_green_must_stay_below_max(client, admin):
    r = client.put(PARAM, headers=admin, json={"jenis_parameter": "max_green_time", "nilai": 20})
    assert r.status_code == 200
    r = client.put(PARAM, headers=admin, json={"jenis_parameter": "min_green_time", "nilai": 25})
    assert r.status_code == 422 and "minimum" in r.json()["detail"].lower()


def test_user_pages_api_flow(client, admin):
    r = client.post(USERS, headers=admin, json={"nama": "Siti Aminah", "username": "sitiaminah_dishub", "password": "Rahasia2026", "role": "Administrator"})
    assert r.status_code == 201 and r.json()["role"] == "Administrator" and r.json()["redirect"] == "/admin/users"
    users = client.get(USERS, headers=admin).json()
    assert any(u["username"] == "sitiaminah_dishub" and u["role"] == "Administrator" for u in users)
    assert all("password" not in u for u in users)  # hash tidak pernah dikirim ke klien


def test_admin_pages_api_forbidden_for_petugas(client, petugas):
    assert client.get(PARAM, headers=petugas).status_code == 403
    assert client.put(PARAM, headers=petugas, json={"jenis_parameter": "amber_duration", "nilai": 4}).status_code == 403
    assert client.get(USERS, headers=petugas).status_code == 403
    assert client.post(USERS, headers=petugas, json={"nama": "x", "username": "xyz", "password": "Abcdefg1", "role": "Administrator"}).status_code == 403

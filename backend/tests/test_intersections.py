"""F5 Kelola Sistem: koordinat persimpangan (GIS), validasi, migrasi database lama, dan halaman."""
import pytest

from app.core.database import SessionLocal
from app.models import Persimpangan
from app.services.seed import DEMO_COORDS, seed

URL = "/api/admin/intersections"


def _by_name(client, headers, nama):
    return next(i for i in client.get(URL, headers=headers).json() if i["nama_lokasi"] == nama)


def test_add_intersection_with_coordinates(client, admin):
    r = client.post(URL, headers=admin, json={
        "nama_lokasi": "Simpang Uji", "deskripsi": "Arah timur-barat", "latitude": -7.2655, "longitude": 112.752,
        "detektor_virtual": False})
    assert r.status_code == 201
    item = _by_name(client, admin, "Simpang Uji")
    assert (item["latitude"], item["longitude"]) == (-7.2655, 112.752)
    assert item["detektor_virtual"] is False and len(item["jalur"]) == 4


def test_add_intersection_without_coordinates_defaults(client, admin):
    assert client.post(URL, headers=admin, json={"nama_lokasi": "Simpang Polos"}).status_code == 201
    item = _by_name(client, admin, "Simpang Polos")
    assert item["latitude"] is None and item["longitude"] is None and item["detektor_virtual"] is True


@pytest.mark.parametrize("payload,pesan", [
    ({"latitude": -7.2}, "Latitude dan longitude harus diisi berpasangan."),
    ({"longitude": 112.7}, "Latitude dan longitude harus diisi berpasangan."),
    ({"latitude": 91, "longitude": 112.7}, "Latitude harus berada di antara -90 dan 90."),
    ({"latitude": -7.2, "longitude": 181}, "Longitude harus berada di antara -180 dan 180."),
])
def test_coordinate_validation(client, admin, payload, pesan):
    r = client.post(URL, headers=admin, json={"nama_lokasi": "Simpang X", **payload})
    assert r.status_code == 422 and r.json()["detail"] == pesan


def test_description_limit_is_250(client, admin):
    assert client.post(URL, headers=admin, json={"nama_lokasi": "A", "deskripsi": "x" * 250}).status_code == 201
    r = client.post(URL, headers=admin, json={"nama_lokasi": "B", "deskripsi": "x" * 251})
    assert r.status_code == 422 and "250" in r.json()["detail"]


def test_blank_name_with_spaces_is_rejected(client, admin):
    r = client.post(URL, headers=admin, json={"nama_lokasi": "   "})
    assert r.status_code == 422 and r.json()["detail"] == "Nama lokasi persimpangan wajib diisi!"


def test_intersections_endpoints_are_admin_only(client, petugas):
    assert client.get(URL, headers=petugas).status_code == 403
    assert client.post(URL, headers=petugas, json={"nama_lokasi": "X"}).status_code == 403
    assert client.get(URL).status_code == 401


def test_demo_intersections_have_coordinates(client, admin):
    for nama, (lat, lon) in DEMO_COORDS.items():
        item = _by_name(client, admin, nama)
        assert (item["latitude"], item["longitude"]) == (lat, lon)


def test_seed_backfills_coordinates_on_old_data(client):
    with SessionLocal() as db:
        p = db.query(Persimpangan).filter_by(nama_lokasi="Simpang Gubeng").one()
        p.latitude = p.longitude = None
        db.commit()
        seed(db)
        db.refresh(p)
        assert (p.latitude, p.longitude) == DEMO_COORDS["Simpang Gubeng"]


def test_ensure_schema_upgrades_old_database(tmp_path, monkeypatch):
    """Database yang dibuat sebelum F5 (tanpa kolom koordinat) harus ditambah kolomnya tanpa kehilangan data."""
    from sqlalchemy import create_engine, inspect, text
    from app.core import database

    eng = create_engine(f"sqlite:///{tmp_path / 'lama.db'}")
    with eng.begin() as c:
        c.execute(text("CREATE TABLE pengguna (id_pengguna INTEGER PRIMARY KEY, nama VARCHAR(100), username VARCHAR(50),"
                       " password VARCHAR(255), role VARCHAR(30))"))
        c.execute(text("CREATE TABLE persimpangan (id_persimpangan INTEGER PRIMARY KEY, nama_lokasi VARCHAR(100), deskripsi TEXT)"))
        c.execute(text("INSERT INTO persimpangan (nama_lokasi, deskripsi) VALUES ('Simpang Lama', 'data lama')"))
    monkeypatch.setattr(database, "engine", eng)
    database.ensure_schema()
    database.ensure_schema()  # idempoten
    cols = {c["name"] for c in inspect(eng).get_columns("persimpangan")}
    assert {"latitude", "longitude", "detektor_virtual"} <= cols
    assert {"reset_token", "reset_token_expires"} <= {c["name"] for c in inspect(eng).get_columns("pengguna")}
    with eng.connect() as c:
        row = c.execute(text("SELECT nama_lokasi, latitude, detektor_virtual FROM persimpangan")).one()
    assert row[0] == "Simpang Lama" and row[1] is None and bool(row[2]) is True


def test_admin_pages_and_assets_served(client):
    for path in ("/admin/intersections", "/admin/intersections/add"):
        r = client.get(path)
        assert r.status_code == 200 and "text/html" in r.headers["content-type"]
        assert "Registrasi" in r.text or "Persimpangan Terdaftar" in r.text
    page = client.get("/admin/intersections/add").text
    for needle in ("Nama Lokasi", "Latitude", "Longitude", "Deskripsi", "Aktifkan Detektor Loop Virtual",
                   "Simpan Persimpangan", "Batal", "Export Table"):
        assert needle in page, needle
    assert client.get("/static/admin_intersections.js").status_code == 200
    assert client.get("/static/admin.css").status_code == 200


def test_dashboard_links_to_kelola_sistem(client):
    assert 'href="/admin/intersections"' in client.get("/dashboard").text

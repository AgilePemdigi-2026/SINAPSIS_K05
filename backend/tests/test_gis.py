"""Unit test untuk Modul GIS & Persimpangan (Ryan) — BAB V User Stories.

Fitur yang diuji:
  - Fitur 2: Pantau Kondisi Lalu Lintas (Peta Real-Time, Alert Kemacetan, Status Sensor)
  - Fitur 3: Kelola Sistem (Tambah Persimpangan Baru & Validasi)
  - Fitur 4: Permintaan Rute Darurat (Dijkstra, Aktivasi Koridor Hijau)
  - Autentikasi & RBAC untuk fitur GIS
"""
import pytest
from app.main import app
from app.routers import intersections

# Daftarkan intersections router ke app untuk pengujian jika belum terdaftar
if intersections.router not in app.routes:
    app.include_router(intersections.router)


def test_gis_map_data_seed_when_empty(client, admin):
    """Pengujian Fitur 2: Saat DB kosong, seed default wireframe (Simpang A, B, C, D) dikembalikan."""
    from app.core.database import SessionLocal
    from app.models.intersection import DetailRute, Jalur, Persimpangan

    # Kosongkan data persimpangan untuk menguji mode default seed
    with SessionLocal() as db:
        db.query(DetailRute).delete()
        db.query(Jalur).delete()
        db.query(Persimpangan).delete()
        db.commit()

    r = client.get("/api/intersections", headers=admin)
    assert r.status_code == 200
    data = r.json()

    # Periksa ketersediaan data peta dan daftar simpang
    items = data.get("traffic-density-map") or data.get("traffic_density_map")
    assert items is not None
    assert len(items) == 4

    names = [i["nama_lokasi"] for i in items]
    assert "Simpang A" in names
    assert "Simpang B" in names
    assert "Simpang C" in names
    assert "Simpang D" in names

    # Simpang C berstatus KRITIS (520 kend/menit) dan memicu congestion-alert
    simpang_c = next(i for i in items if i["nama_lokasi"] == "Simpang C")
    assert simpang_c["status"] == "KRITIS"
    assert simpang_c["kendaraan_per_menit"] == 520

    alert = data.get("congestion-alert") or data.get("congestion_alert")
    assert alert is not None
    assert "Peringatan: Kemacetan Terdeteksi di Persimpangan" in alert or "PERINGATAN KEMACETAN" in alert


def test_gis_refresh_data(client, admin):
    """Pengujian Fitur 2: Tombol 'Refresh Data' mengembalikan pesan sukses."""
    r = client.post("/api/intersections/refresh", headers=admin)
    assert r.status_code == 200
    data = r.json()
    assert data["pesan"] == "Data lalu lintas berhasil dimuat ulang."


def test_gis_sensor_offline_warning(client, admin):
    """Pengujian Fitur 2: Peringatan jika ada sensor yang mati/offline."""
    from app.core.database import SessionLocal
    from app.models.intersection import Persimpangan

    with SessionLocal() as db:
        p = db.query(Persimpangan).first()
        if p:
            p.status_sensor = "Sensor Offline"
            p.aktif_loop_virtual = False
            db.commit()

    r = client.get("/api/intersections", headers=admin)
    assert r.status_code == 200
    data = r.json()
    warning = data.get("sensor_warning") or data.get("pesan_sensor")
    assert warning == "Data pemantauan tidak tersedia untuk beberapa simpang."


def test_gis_add_intersection_success(client, admin):
    """Pengujian Fitur 3: Tambah persimpangan baru berhasil dengan 4 jalur otomatis."""
    payload = {
        "nama_lokasi": "Simpang Sudirman - Thamrin",
        "deskripsi": "Simpang protokol utama DKI Jakarta",
        "kode_simpang": "SIMPANG-JKT-01",
        "latitude": -6.2088,
        "longitude": 106.8456,
        "aktif_loop_virtual": True,
    }
    r = client.post("/api/intersections", headers=admin, json=payload)
    assert r.status_code == 201
    data = r.json()
    assert data["pesan"] == "Persimpangan baru berhasil ditambahkan!"
    assert data["nama_lokasi"] == "Simpang Sudirman - Thamrin"

    # Periksa 4 jalur otomatis: Utara, Selatan, Timur, Barat
    arah_list = [j["arah"] for j in data["jalur"]]
    assert sorted(arah_list) == sorted(["Utara", "Selatan", "Timur", "Barat"])


def test_gis_add_intersection_empty_name_validation(client, admin):
    """Pengujian Fitur 3: Validasi nama lokasi persimpangan kosong (HTTP 400)."""
    payload = {
        "nama_lokasi": "   ",
        "deskripsi": "Tanpa nama",
    }
    r = client.post("/api/intersections", headers=admin, json=payload)
    assert r.status_code == 400
    assert r.json()["detail"] == "Nama lokasi persimpangan wajib diisi!"


def test_gis_add_intersection_rbac_petugas_forbidden(client, petugas):
    """Pengujian RBAC: Petugas tidak boleh menambah persimpangan (403)."""
    payload = {"nama_lokasi": "Simpang Terlarang"}
    r = client.post("/api/intersections", headers=petugas, json=payload)
    assert r.status_code == 403


def test_gis_emergency_route_search_success(client, petugas):
    """Pengujian Fitur 4: Pencarian rute darurat optimal via Dijkstra."""
    payload = {
        "lokasi_awal": "RSUD Dr. Soetomo",
        "tujuan": "Jalan Darmo",
        "level_prioritas": "High",
    }
    r = client.post("/api/intersections/emergency-route", headers=petugas, json=payload)
    assert r.status_code == 200
    data = r.json()
    assert data["pesan"] == "Rute Darurat Optimal Ditemukan"
    assert data["status"] == "Diajukan"
    assert len(data["rute"]) >= 2
    assert data["rute"][0] == "RSUD Dr. Soetomo"
    assert data["rute"][-1] == "Jalan Darmo"
    assert data["jumlah_persimpangan"] > 0


def test_gis_emergency_route_empty_destination_validation(client, petugas):
    """Pengujian Fitur 4: Validasi lokasi tujuan kosong (HTTP 400)."""
    payload = {
        "lokasi_awal": "RSUD Dr. Soetomo",
        "tujuan": "",
        "level_prioritas": "High",
    }
    r = client.post("/api/intersections/emergency-route", headers=petugas, json=payload)
    assert r.status_code == 400
    assert r.json()["detail"] == "Lokasi tujuan wajib diisi!"


def test_gis_emergency_route_activate_corridor(client, petugas):
    """Pengujian Fitur 4: Aktivasi koridor hijau darurat."""
    # Cari rute terlebih dahulu
    payload = {
        "lokasi_awal": "RSUD Dr. Soetomo",
        "tujuan": "Jalan Darmo",
        "level_prioritas": "High",
    }
    search_res = client.post("/api/intersections/emergency-route", headers=petugas, json=payload)
    assert search_res.status_code == 200
    id_rute = search_res.json()["id_rute"]

    # Aktifkan koridor
    act_res = client.post(f"/api/intersections/emergency-route/{id_rute}/activate", headers=petugas)
    assert act_res.status_code == 200
    data = act_res.json()
    assert data["pesan"] == "Koridor hijau darurat berhasil diaktifkan!"
    assert data["status"] == "Aktif"
    assert data["waktu_aktivasi"] is not None


def test_gis_emergency_route_rbac_admin_forbidden(client, admin):
    """Pengujian RBAC: Administrator tidak boleh membuat permintaan rute darurat (403)."""
    payload = {
        "lokasi_awal": "RSUD Dr. Soetomo",
        "tujuan": "Jalan Darmo",
        "level_prioritas": "High",
    }
    r = client.post("/api/intersections/emergency-route", headers=admin, json=payload)
    assert r.status_code == 403

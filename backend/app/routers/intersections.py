"""Router API GIS & Persimpangan — endpoint peta, status simpang, rute darurat.

Pemilik: Ryan (GIS & Persimpangan).

Endpoint:
  GET  /api/intersections                          : data peta & status simpang
  POST /api/intersections/refresh                   : refresh data lalu lintas
  POST /api/intersections                           : tambah persimpangan baru (Admin)
  POST /api/intersections/emergency-route           : cari rute darurat (Petugas)
  POST /api/intersections/emergency-route/{id}/activate : aktifkan koridor hijau
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import (
    ROLE_ADMIN,
    ROLE_PETUGAS,
    get_current_user,
    optional_roles,
    require_roles,
)
from app.schemas import IntersectionGISCreate, EmergencySearch
from app.services import gis_service

router = APIRouter(prefix="/api/intersections", tags=["GIS & Persimpangan"])

_admin = require_roles(ROLE_ADMIN)
_petugas = require_roles(ROLE_PETUGAS)
_view = optional_roles(ROLE_ADMIN, ROLE_PETUGAS)


# ---------------------------------------------------------------------------
# GET  /api/intersections  — data peta & daftar status persimpangan
# ---------------------------------------------------------------------------
@router.get("")
def get_intersections(db: Session = Depends(get_db), _=Depends(_view)):
    """Mengambil data peta (traffic-density-map), daftar simpang
    (intersection-status-list), status sensor, dan alert kemacetan.

    Sesuai Fitur 2 (Pantau Kondisi Lalu Lintas) dan Gambar 4.1.
    """
    return gis_service.get_intersection_map_data(db)


# ---------------------------------------------------------------------------
# POST /api/intersections/refresh  — tombol "Refresh Data"
# ---------------------------------------------------------------------------
@router.post("/refresh")
def refresh_data(db: Session = Depends(get_db), _=Depends(_view)):
    """Muat ulang data lalu lintas.

    Mengembalikan: {"pesan": "Data lalu lintas berhasil dimuat ulang.", ...}
    """
    return gis_service.refresh_traffic_data(db)


# ---------------------------------------------------------------------------
# POST /api/intersections  — tambah persimpangan baru (Admin only)
# ---------------------------------------------------------------------------
@router.post("", status_code=201)
def add_intersection(
    req: IntersectionGISCreate,
    db: Session = Depends(get_db),
    _=Depends(_admin),
):
    """Tambah persimpangan baru + otomatis 4 jalur (Fitur 3 / User Story 5.3).

    Validasi: nama_lokasi tidak boleh kosong.
    Mengembalikan: {"pesan": "Persimpangan baru berhasil ditambahkan!", ...}
    """
    try:
        result = gis_service.add_intersection(
            db=db,
            nama_lokasi=req.nama_lokasi,
            deskripsi=req.deskripsi,
            kode_simpang=req.kode_simpang,
            latitude=req.latitude,
            longitude=req.longitude,
            aktif_loop_virtual=req.aktif_loop_virtual,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return result


# ---------------------------------------------------------------------------
# POST /api/intersections/emergency-route — cari rute darurat (Petugas)
# ---------------------------------------------------------------------------
@router.post("/emergency-route")
def search_emergency_route(
    req: EmergencySearch,
    db: Session = Depends(get_db),
    user=Depends(_petugas),
):
    """Cari rute darurat optimal via Dijkstra (Fitur 4 / User Story 5.4).

    Validasi: tujuan tidak boleh kosong.
    Mengembalikan: {"pesan": "Rute Darurat Optimal Ditemukan", ...}
    """
    try:
        result = gis_service.search_emergency_route(
            db=db,
            id_pengguna=user.id_pengguna,
            lokasi_awal=req.lokasi_awal or "",
            tujuan=req.tujuan or "",
            level_prioritas=req.level_prioritas,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    if "error" in result:
        status_code = result.get("status_code", 404)
        raise HTTPException(status_code, result["error"])

    return result


# ---------------------------------------------------------------------------
# POST /api/intersections/emergency-route/{id_rute}/activate — koridor hijau
# ---------------------------------------------------------------------------
@router.post("/emergency-route/{id_rute}/activate")
def activate_corridor(
    id_rute: int,
    db: Session = Depends(get_db),
    _=Depends(_petugas),
):
    """Aktifkan koridor hijau darurat (Fitur 4).

    Mengembalikan: {"pesan": "Koridor hijau darurat berhasil diaktifkan!", ...}
    """
    result = gis_service.activate_green_corridor(db, id_rute)
    if "error" in result:
        status_code = result.get("status_code", 400)
        raise HTTPException(status_code, result["error"])
    return result


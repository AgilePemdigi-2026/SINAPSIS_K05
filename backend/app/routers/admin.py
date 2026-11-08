"""Fitur Kelola Sistem (khusus Administrator): persimpangan, parameter AI, pengguna, simulasi."""
import logging
import math
import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import ROLE_ADMIN, ROLE_PETUGAS, PASS_RULE, hash_password, require_roles
from app.models import Jalur, KonfigurasiSistem, Pengguna, Persimpangan
from app.schemas import IntersectionCreate, ParameterUpdate, SimulationRequest, UserCreate
from app.services import monitoring_service as svc
from app.services.sensor_source import SyntheticSensorSource
from app.services.simulation_service import run_simulation
from app.core.timeutil import utcnow

router = APIRouter(prefix="/api/admin", tags=["Kelola Sistem"])
_admin = require_roles(ROLE_ADMIN)


# ---- Persimpangan ----------------------------------------------------------
DESKRIPSI_MAX = 250  # SRS 3.1.2 / Hi-Fi: textarea "Deskripsi & Karakteristik Arus" maks. 250 karakter


def _intersection_dict(p: Persimpangan) -> dict:
    return {"id_persimpangan": p.id_persimpangan, "nama_lokasi": p.nama_lokasi, "deskripsi": p.deskripsi,
            "latitude": p.latitude, "longitude": p.longitude, "detektor_virtual": bool(p.detektor_virtual),
            "jalur": [{"id_jalur": j.id_jalur, "arah": j.arah} for j in p.jalur]}


@router.get("/intersections")
def list_intersections(db: Session = Depends(get_db), _=Depends(_admin)):
    return [_intersection_dict(p)
            for p in db.scalars(select(Persimpangan).order_by(Persimpangan.id_persimpangan)).all()]


@router.post("/intersections", status_code=201)
def add_intersection(req: IntersectionCreate, db: Session = Depends(get_db), _=Depends(_admin)):
    nama = (req.nama_lokasi or "").strip()
    if not nama:
        raise HTTPException(422, "Nama lokasi persimpangan wajib diisi!")
    if len(nama) > 100:
        raise HTTPException(422, "Nama lokasi maksimal 100 karakter.")
    deskripsi = (req.deskripsi or "").strip() or None
    if deskripsi and len(deskripsi) > DESKRIPSI_MAX:
        raise HTTPException(422, f"Deskripsi maksimal {DESKRIPSI_MAX} karakter.")
    lat, lon = req.latitude, req.longitude
    if (lat is None) != (lon is None):
        raise HTTPException(422, "Latitude dan longitude harus diisi berpasangan.")
    if lat is not None and not (-90 <= lat <= 90 and math.isfinite(lat)):
        raise HTTPException(422, "Latitude harus berada di antara -90 dan 90.")
    if lon is not None and not (-180 <= lon <= 180 and math.isfinite(lon)):
        raise HTTPException(422, "Longitude harus berada di antara -180 dan 180.")
    p = Persimpangan(nama_lokasi=nama, deskripsi=deskripsi, latitude=lat, longitude=lon,
                     detektor_virtual=True if req.detektor_virtual is None else req.detektor_virtual,
                     jalur=[Jalur(arah=a) for a in settings.LANE_NAMES])  # 1 persimpangan = 4 jalur
    db.add(p)
    db.commit()
    # Satu siklus simulasi langsung dijalankan agar simpang baru punya data (status, jumlah kendaraan, diagram)
    # tanpa menunggu "Muat ulang"; kegagalan simulasi tidak membatalkan pendaftaran.
    try:
        data_awal = svc.run_cycle(db, p) is not None
    except Exception:
        db.rollback()
        logging.getLogger(__name__).exception("Siklus awal persimpangan %s gagal", p.id_persimpangan)
        data_awal = False
    return {"pesan": "Persimpangan baru berhasil ditambahkan!", "id_persimpangan": p.id_persimpangan,
            "data_awal": data_awal, "redirect": "/admin/intersections"}


# ---- Parameter sistem AI ---------------------------------------------------
@router.get("/parameters")
def list_parameters(db: Session = Depends(get_db), _=Depends(_admin)):
    p = svc.load_params(db)
    now = {"spike_threshold": p.spike_threshold, "min_green_time": p.min_green,
           "max_green_time": p.max_green, "amber_duration": p.amber}
    return [{"jenis_parameter": k, "nilai_aktif": now[k], "keterangan": v[3], "rentang": [v[1], v[2]]}
            for k, v in svc.PARAM_KEYS.items()]


@router.put("/parameters")
def update_parameter(req: ParameterUpdate, db: Session = Depends(get_db), user=Depends(_admin)):
    spec = svc.PARAM_KEYS.get(req.jenis_parameter)
    if spec is None:
        raise HTTPException(422, f"Jenis parameter tidak dikenal. Pilihan: {', '.join(svc.PARAM_KEYS)}")
    tipe, lo, hi, _ = spec
    if not lo <= req.nilai <= hi:
        raise HTTPException(422, f"Nilai {req.jenis_parameter} harus antara {lo} dan {hi}.")
    nilai = tipe(req.nilai)
    cfg = svc.load_params(db)
    new_min = nilai if req.jenis_parameter == "min_green_time" else cfg.min_green
    new_max = nilai if req.jenis_parameter == "max_green_time" else cfg.max_green
    if new_min >= new_max:
        raise HTTPException(422, "Durasi hijau minimum harus lebih kecil dari maksimum.")
    db.add(KonfigurasiSistem(id_pengguna=user.id_pengguna, jenis_parameter=req.jenis_parameter,
                             nilai=str(nilai), waktu_perubahan=utcnow()))
    db.commit()
    return {"pesan": "Parameter konfigurasi berhasil diperbarui!", "jenis_parameter": req.jenis_parameter, "nilai": nilai}


@router.get("/parameters/history")
def parameter_history(db: Session = Depends(get_db), _=Depends(_admin)):
    rows = db.scalars(select(KonfigurasiSistem).order_by(KonfigurasiSistem.waktu_perubahan.desc(),
                                                         KonfigurasiSistem.id_konfigurasi.desc()).limit(50)).all()
    return [{"jenis_parameter": r.jenis_parameter, "nilai": r.nilai, "diubah_oleh": r.id_pengguna,
             "waktu": r.waktu_perubahan.isoformat()} for r in rows]


# ---- Pengguna --------------------------------------------------------------
_PASS_RULE = PASS_RULE


@router.get("/users")
def list_users(db: Session = Depends(get_db), _=Depends(_admin)):
    return [{"id_pengguna": u.id_pengguna, "nama": u.nama, "username": u.username, "role": u.role}
            for u in db.scalars(select(Pengguna).order_by(Pengguna.id_pengguna)).all()]


@router.post("/users", status_code=201)
def add_user(req: UserCreate, db: Session = Depends(get_db), _=Depends(_admin)):
    nama, username, password, role = (req.nama or "").strip(), (req.username or "").strip(), req.password or "", (req.role or "").strip()
    if not all([nama, username, password, role]):
        raise HTTPException(422, "Semua field wajib diisi!")
    if role not in (ROLE_ADMIN, ROLE_PETUGAS):
        raise HTTPException(422, f"Role harus '{ROLE_ADMIN}' atau '{ROLE_PETUGAS}'.")
    if not re.fullmatch(r"[A-Za-z0-9_.]{3,50}", username):
        raise HTTPException(422, "Username 3-50 karakter alfanumerik (boleh _ dan .).")
    if not _PASS_RULE.match(password):
        raise HTTPException(422, "Password minimal 8 karakter, mengandung huruf kapital dan angka.")
    if db.scalar(select(Pengguna).where(Pengguna.username == username)):
        raise HTTPException(409, "Username sudah digunakan.")
    u = Pengguna(nama=nama, username=username, password=hash_password(password), role=role)
    db.add(u)
    db.commit()
    return {"pesan": "Akun pengguna berhasil dibuat!", "id_pengguna": u.id_pengguna, "redirect": "/admin/users"}


# ---- Simulasi skenario -----------------------------------------------------
@router.post("/simulations")
def simulate(req: SimulationRequest, db: Session = Depends(get_db), user=Depends(_admin)):
    if req.profil not in SyntheticSensorSource.PROFILES:
        raise HTTPException(422, f"Profil tidak dikenal. Pilihan: {', '.join(SyntheticSensorSource.PROFILES)}")
    if not 1 <= req.jumlah_siklus <= 500:
        raise HTTPException(422, "jumlah_siklus harus antara 1 dan 500.")
    return run_simulation(db, user.id_pengguna, req.profil, req.jumlah_siklus,
                          req.inject_weather_noise, req.simulasi_sensor_failure, req.seed)

"""Fitur Pantau Kondisi Lalu Lintas (REQ-7..10): dashboard, refresh, siklus manual, riwayat."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import ROLE_ADMIN, ROLE_PETUGAS, optional_roles, require_roles
from app.models import Deteksi, Jalur, KeputusanSinyal, Persimpangan
from app.schemas import ManualCycleRequest
from app.services import monitoring_service as svc

router = APIRouter(prefix="/api/monitoring", tags=["Pantau Lalu Lintas"])
_both = require_roles(ROLE_ADMIN, ROLE_PETUGAS)
_view = optional_roles(ROLE_ADMIN, ROLE_PETUGAS)  # terbuka tanpa login saat DASHBOARD_PUBLIC=true


@router.get("/dashboard")
def get_dashboard(db: Session = Depends(get_db), _=Depends(_view)):
    return svc.dashboard(db)


@router.post("/refresh")
def refresh(db: Session = Depends(get_db), _=Depends(_view)):
    """Muat ulang data: jalankan satu siklus di semua persimpangan; coba sambung ulang sensor."""
    for p in db.scalars(select(Persimpangan)).all():
        svc.run_cycle(db, p)
    data = svc.dashboard(db)
    data["pesan"] = "Data lalu lintas berhasil dimuat ulang."
    return data


@router.post("/cycle")
def run_one_cycle(req: ManualCycleRequest, db: Session = Depends(get_db), _=Depends(_both)):
    p = db.get(Persimpangan, req.id_persimpangan)
    if p is None:
        raise HTTPException(404, "Persimpangan tidak ditemukan.")
    if req.vehicle_counts is not None and len(req.vehicle_counts) != 4:
        raise HTTPException(422, "vehicle_counts harus berisi tepat 4 nilai (Utara, Selatan, Timur, Barat).")
    result = svc.run_cycle(db, p, req.vehicle_counts, req.simulated_hour)
    if result is None:
        raise HTTPException(503, "Data pemantauan tidak tersedia untuk beberapa simpang.")
    return result


@router.get("/history/{id_persimpangan}")
def history(id_persimpangan: int, limit: int = 20, db: Session = Depends(get_db), _=Depends(_view)):
    p = db.get(Persimpangan, id_persimpangan)
    if p is None:
        raise HTTPException(404, "Persimpangan tidak ditemukan.")
    lane_ids = [j.id_jalur for j in p.jalur]
    dets = db.scalars(select(Deteksi).where(Deteksi.id_jalur.in_(lane_ids))
                      .order_by(Deteksi.waktu_deteksi.desc(), Deteksi.id_deteksi.desc()).limit(limit * 4)).all()
    decs = db.scalars(select(KeputusanSinyal).where(KeputusanSinyal.id_jalur.in_(lane_ids))
                      .order_by(KeputusanSinyal.waktu_keputusan.desc(), KeputusanSinyal.id_keputusan.desc()).limit(limit * 4)).all()
    return {
        "deteksi": [{"id_jalur": d.id_jalur, "waktu": d.waktu_deteksi.isoformat(), "jumlah_kendaraan": d.jumlah_kendaraan} for d in dets],
        "keputusan": [{"id_jalur": k.id_jalur, "waktu": k.waktu_keputusan.isoformat(), "warna": k.warna_sinyal, "durasi": k.durasi_detik} for k in decs],
    }

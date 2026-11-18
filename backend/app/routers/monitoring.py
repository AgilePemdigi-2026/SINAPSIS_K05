"""Fitur Pantau Kondisi Lalu Lintas (REQ-7..10): dashboard, refresh, siklus manual, riwayat."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import ROLE_ADMIN, ROLE_PETUGAS, optional_roles, require_roles
from app.models import Deteksi, Jalur, KeputusanSinyal, Persimpangan
from app.schemas import ManualCycleRequest
from app.services import monitoring_service as svc
from app.services.green_corridor_service import (
    ACTIVE_CORRIDORS,
    INTERSECTION_OVERRIDES,
    get_intersection_override,
)

router = APIRouter(prefix="/api/monitoring", tags=["Pantau Lalu Lintas"])
_both = require_roles(ROLE_ADMIN, ROLE_PETUGAS)
_view = optional_roles(ROLE_ADMIN, ROLE_PETUGAS)  # terbuka tanpa login saat DASHBOARD_PUBLIC=true


def _apply_green_corridor_sync(payload: dict) -> dict:
    """Menyinkronkan status override Green Corridor ke data persimpangan untuk Dashboard & GIS."""
    if not isinstance(payload, dict):
        return payload

    payload["green_corridor"] = {
        "active_count": len(ACTIVE_CORRIDORS),
        "active_corridors": list(ACTIVE_CORRIDORS.values()),
        "overrides": INTERSECTION_OVERRIDES,
    }

    # Cari list persimpangan di dalam payload dashboard (mendukung key 'persimpangan' atau 'intersections')
    items = payload.get("persimpangan") or payload.get("intersections") or []
    for item in items:
        if not isinstance(item, dict):
            continue
        raw_id = item.get("kode") or item.get("id_persimpangan") or item.get("id")
        if raw_id is None:
            continue

        # Cek kecocokan ID langsung (mis. "SIMPANG-01") atau format numerik (mis. 1 -> "SIMPANG-01")
        candidates = [str(raw_id).strip().upper()]
        if str(raw_id).isdigit():
            candidates.append(f"SIMPANG-{int(raw_id):02d}")

        override = next((get_intersection_override(c) for c in candidates if get_intersection_override(c)), None)
        if override:
            item["mode_kontrol"] = "EMERGENCY_OVERRIDE"
            item["status_lampu"] = "GREEN"
            item["green_corridor_override"] = override
            # Timpa status lampu per jalur/arm jika tersedia di dict simpang
            for arm in item.get("jalur", []) or item.get("arms", []):
                if isinstance(arm, dict):
                    arm["warna_sinyal"] = "GREEN"
                    arm["status"] = "GREEN"
        else:
            item.setdefault("mode_kontrol", "AI_ADAPTIVE")

    return payload


@router.get("/dashboard")
def get_dashboard(db: Session = Depends(get_db), _=Depends(_view)):
    return _apply_green_corridor_sync(svc.dashboard(db))


@router.post("/refresh")
def refresh(db: Session = Depends(get_db), _=Depends(_view)):
    """Muat ulang data: jalankan satu siklus di semua persimpangan; coba sambung ulang sensor."""
    for p in db.scalars(select(Persimpangan)).all():
        svc.run_cycle(db, p)
    data = _apply_green_corridor_sync(svc.dashboard(db))
    data["pesan"] = "Data lalu lintas berhasil dimuat ulang."
    return data


@router.post("/cycle")
def run_one_cycle(req: ManualCycleRequest, db: Session = Depends(get_db), _=Depends(_both)):
    p = db.get(Persimpangan, req.id_persimpangan)
    if p is None:
        raise HTTPException(404, "Persimpangan tidak ditemukan.")
    arms = [j.arah for j in sorted(p.jalur, key=lambda j: j.id_jalur)]
    if req.vehicle_counts is not None and len(req.vehicle_counts) != len(arms):
        raise HTTPException(422, f"vehicle_counts harus berisi tepat {len(arms)} nilai ({', '.join(arms)}).")
    result = svc.run_cycle(db, p, req.vehicle_counts, req.simulated_hour)
    if result is None:
        raise HTTPException(503, "Data pemantauan tidak tersedia untuk beberapa simpang.")

    override = get_intersection_override(f"SIMPANG-{p.id_persimpangan:02d}") or get_intersection_override(str(p.id_persimpangan))
    if override and isinstance(result, dict):
        result["mode_kontrol"] = "EMERGENCY_OVERRIDE"
        result["green_corridor_override"] = override
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
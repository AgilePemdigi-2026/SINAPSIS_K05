"""Fitur Pantau Kondisi Lalu Lintas (REQ-7..10): dashboard, refresh, siklus manual, riwayat, alert."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import ROLE_ADMIN, ROLE_PETUGAS, optional_roles, require_roles
from app.models import Deteksi, Jalur, KeputusanSinyal, Persimpangan
from app.schemas import ManualCycleRequest
from app.services import monitoring_service as svc
from app.services import alert_service

router = APIRouter(prefix="/api/monitoring", tags=["Pantau Lalu Lintas"])
_both = require_roles(ROLE_ADMIN, ROLE_PETUGAS)
_view = optional_roles(ROLE_ADMIN, ROLE_PETUGAS)  # terbuka tanpa login saat DASHBOARD_PUBLIC=true


@router.get("/dashboard")
def get_dashboard(db: Session = Depends(get_db), _=Depends(_view)):
    data = svc.dashboard(db)
    # Generate alert otomatis dari data dashboard
    alert_service.generate_alerts(db, data)
    data["alert_summary"] = alert_service.get_alert_summary(db)
    return data


@router.post("/refresh")
def refresh(db: Session = Depends(get_db), _=Depends(_view)):
    """Muat ulang data: jalankan satu siklus di semua persimpangan; coba sambung ulang sensor."""
    for p in db.scalars(select(Persimpangan)).all():
        svc.run_cycle(db, p)
    data = svc.dashboard(db)
    data["pesan"] = "Data lalu lintas berhasil dimuat ulang."
    # Generate alert otomatis dari data dashboard
    alert_service.generate_alerts(db, data)
    data["alert_summary"] = alert_service.get_alert_summary(db)
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


# ---- Endpoint Alert (Fitur 10: Congestion Alert & Sensor Offline) ----

@router.get("/alerts")
def get_alerts(db: Session = Depends(get_db), _=Depends(_both)):
    """Ambil semua alert aktif (belum di-acknowledge)."""
    alerts = alert_service.get_active_alerts(db)
    summary = alert_service.get_alert_summary(db)
    return {"alerts": alerts, "summary": summary}


@router.get("/alerts/history")
def get_alerts_history(limit: int = 50, db: Session = Depends(get_db), _=Depends(_both)):
    """Riwayat semua alert (aktif maupun sudah ditangani)."""
    return {"alerts": alert_service.get_alert_history(db, limit)}


@router.post("/alerts/{alert_id}/acknowledge")
def acknowledge(alert_id: int, db: Session = Depends(get_db), user=Depends(_both)):
    """Tandai alert sebagai sudah ditangani oleh petugas."""
    result = alert_service.acknowledge_alert(db, alert_id, user.id_pengguna)
    if result is None:
        raise HTTPException(404, "Alert tidak ditemukan.")
    return {"pesan": "Alert berhasil di-acknowledge.", "alert": result}

"""Fitur Permintaan Rute Darurat (khusus Petugas Lalu Lintas): cari rute, aktifkan/batalkan koridor hijau."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import ROLE_PETUGAS, require_roles
from app.models import DetailRute, Jalur, Persimpangan, RuteDarurat
from app.schemas import EmergencySearch
from app.services import monitoring_service as svc
from app.services.routing_service import dijkstra, load_graph, resolve_node
from app.core.timeutil import utcnow

router = APIRouter(prefix="/api/emergency", tags=["Rute Darurat"])
_petugas = require_roles(ROLE_PETUGAS)
PRIORITAS = {"High", "Medium", "Low"}


def _serialize(rute: RuteDarurat, db: Session, nodes: list[str] | None = None, total: float | None = None) -> dict:
    detail = []
    for d in rute.detail:
        j = db.get(Jalur, d.id_jalur)
        detail.append({"urutan": d.urutan, "id_jalur": d.id_jalur, "arah": j.arah,
                       "persimpangan": j.persimpangan.nama_lokasi})
    out = {"id_rute": rute.id_rute, "tujuan": rute.tujuan, "level_prioritas": rute.level_prioritas,
           "status": rute.status, "jumlah_persimpangan": len(detail), "jalur_dilewati": detail}
    if nodes is not None:
        out["rute"] = nodes
        out["estimasi_menit"] = max(1, round(total / 60))
    return out


@router.post("/search")
def search_route(req: EmergencySearch, db: Session = Depends(get_db), user=Depends(_petugas)):
    asal, tujuan = (req.lokasi_awal or "").strip(), (req.tujuan or "").strip()
    if not tujuan:
        raise HTTPException(422, "Lokasi tujuan wajib diisi!")
    if not asal:
        raise HTTPException(422, "Lokasi awal wajib diisi!")
    if req.level_prioritas not in PRIORITAS:
        raise HTTPException(422, f"Level prioritas harus salah satu dari: {', '.join(sorted(PRIORITAS))}.")

    graph = load_graph()
    src, dst = resolve_node(graph, asal), resolve_node(graph, tujuan)
    if src is None or dst is None:
        raise HTTPException(404, "Lokasi tidak valid atau tidak ditemukan di peta.")
    plan = dijkstra(graph, src, dst, svc.congestion_by_name(db))
    if plan is None:
        raise HTTPException(404, "Rute tidak ditemukan.")

    rute = RuteDarurat(id_pengguna=user.id_pengguna, tujuan=dst, level_prioritas=req.level_prioritas, status="Diajukan")
    db.add(rute)
    db.flush()
    urutan = 0
    for step in plan.steps:  # hanya simpul yang merupakan persimpangan terkendali
        p = db.scalar(select(Persimpangan).where(Persimpangan.nama_lokasi == step["node"]))
        if p is None:
            continue
        jalur = next((j for j in p.jalur if j.arah == step["arah_masuk"]), None)
        if jalur is not None:
            urutan += 1
            db.add(DetailRute(id_rute=rute.id_rute, id_jalur=jalur.id_jalur, urutan=urutan))
    db.commit()
    db.refresh(rute)
    res = _serialize(rute, db, plan.nodes, plan.total_time_s)
    res["pesan"] = "Rute Darurat Optimal Ditemukan"
    return res


@router.post("/{id_rute}/activate")
def activate(id_rute: int, db: Session = Depends(get_db), _=Depends(_petugas)):
    rute = db.get(RuteDarurat, id_rute)
    if rute is None:
        raise HTTPException(404, "Rute tidak ditemukan.")
    if rute.status != "Diajukan":
        raise HTTPException(409, f"Rute berstatus '{rute.status}', hanya rute 'Diajukan' yang dapat diaktifkan.")
    rute.status, rute.waktu_aktivasi = "Aktif", utcnow()
    db.commit()
    # Terapkan koridor langsung: jalankan satu siklus di persimpangan yang dilewati
    affected = {db.get(Jalur, d.id_jalur).persimpangan for d in rute.detail}
    for p in affected:
        svc.run_cycle(db, p)
    res = _serialize(rute, db)
    res["pesan"] = "Koridor hijau darurat berhasil diaktifkan!"
    return res


@router.post("/{id_rute}/cancel")
def cancel(id_rute: int, db: Session = Depends(get_db), _=Depends(_petugas)):
    rute = db.get(RuteDarurat, id_rute)
    if rute is None:
        raise HTTPException(404, "Rute tidak ditemukan.")
    if rute.status not in ("Diajukan", "Aktif"):
        raise HTTPException(409, f"Rute berstatus '{rute.status}' tidak dapat dibatalkan.")
    rute.status = "Dibatalkan"
    db.commit()
    res = _serialize(rute, db)
    res["pesan"] = "Pratinjau rute ditutup tanpa mengaktifkan koridor hijau."
    return res


@router.post("/{id_rute}/complete")
def complete(id_rute: int, db: Session = Depends(get_db), _=Depends(_petugas)):
    rute = db.get(RuteDarurat, id_rute)
    if rute is None or rute.status != "Aktif":
        raise HTTPException(404, "Rute aktif tidak ditemukan.")
    rute.status = "Selesai"
    db.commit()
    return {"pesan": "Rute darurat selesai.", **_serialize(rute, db)}


@router.get("")
def list_routes(db: Session = Depends(get_db), _=Depends(_petugas)):
    rows = db.scalars(select(RuteDarurat).order_by(RuteDarurat.id_rute.desc()).limit(50)).all()
    return [_serialize(r, db) for r in rows]

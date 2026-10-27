"""Prediksi kepadatan jam berikutnya (model terlatih: gradient boosting + jaringan spiking LIF)."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import ROLE_ADMIN, ROLE_PETUGAS, optional_roles
from app.ml.predictor import get_predictor
from app.models import Persimpangan
from app.services import monitoring_service as svc

router = APIRouter(prefix="/api/prediction", tags=["Prediksi AI"])
_both = optional_roles(ROLE_ADMIN, ROLE_PETUGAS)  # terbuka tanpa login saat DASHBOARD_PUBLIC=true


@router.get("/model-info")
def model_info(_=Depends(_both)):
    """Ringkasan evaluasi model (dari data/models/metrics.json) — data uji kronologis."""
    p = get_predictor()
    if p is None:
        raise HTTPException(503, "Model prediksi belum tersedia. Jalankan: python scripts/train_models.py")
    m = p.metrics
    hasil = m.get("hasil", {})
    return {"model_aktif": p.name, "model_terbaik_menurut_validasi": m.get("model_terbaik_menurut_validasi"),
            "split": m.get("split"),
            "ringkasan_uji": {n: {"mae": r["test"]["mae"], "wape": r["test"]["wape"],
                                  "f1_peringatan_dini": r["peringatan_dini_uji"]["f1"]} for n, r in hasil.items()}}


@router.get("/{id_persimpangan}")
def predict(id_persimpangan: int, db: Session = Depends(get_db), _=Depends(_both)):
    p = db.get(Persimpangan, id_persimpangan)
    if p is None:
        raise HTTPException(404, "Persimpangan tidak ditemukan.")
    svc.hub.source_for(id_persimpangan)  # pastikan riwayat awal (CSV) terisi
    return svc.prediction_payload(p)

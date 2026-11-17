"""Fitur 10 — Congestion Alert & Sensor Offline notification service.

Tanggung jawab:
  - Membangkitkan NotifikasiAlert dari data dashboard (congestion & sensor offline).
  - Menyediakan query alert aktif, riwayat, dan acknowledge.
  - Dua level congestion: PERINGATAN_DINI (>=80%) dan KRITIS (>=85%).
"""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.timeutil import utcnow
from app.models import NotifikasiAlert, Persimpangan

# ---- Konstanta severity & ambang batas ----
SEVERITY_PERINGATAN_DINI = "PERINGATAN_DINI"
SEVERITY_KRITIS = "KRITIS"
SEVERITY_OFFLINE = "OFFLINE"

TIPE_CONGESTION = "CONGESTION"
TIPE_SENSOR_OFFLINE = "SENSOR_OFFLINE"

# Ambang batas congestion (rasio terhadap MAX_VEHICLES)
THRESHOLD_PERINGATAN_DINI = 0.80  # ≥80% → Peringatan Dini
THRESHOLD_KRITIS = settings.EMERGENCY_RATIO  # ≥85% → Kritis

# Jangan buat alert duplikat untuk persimpangan yang sama dalam jendela waktu ini
DEDUP_WINDOW_MINUTES = 5


def _has_recent_alert(db: Session, tipe: str, id_persimpangan: int, severity: str) -> bool:
    """Cek apakah sudah ada alert serupa dalam DEDUP_WINDOW_MINUTES terakhir."""
    cutoff = utcnow() - timedelta(minutes=DEDUP_WINDOW_MINUTES)
    return db.scalar(
        select(func.count(NotifikasiAlert.id_alert))
        .where(
            NotifikasiAlert.tipe == tipe,
            NotifikasiAlert.id_persimpangan == id_persimpangan,
            NotifikasiAlert.severity == severity,
            NotifikasiAlert.waktu_dibuat >= cutoff,
        )
    ) > 0


def generate_alerts(db: Session, dashboard_data: dict) -> list[dict]:
    """Analisis data dashboard dan buat NotifikasiAlert untuk kondisi baru.

    Dipanggil setelah setiap refresh/cycle. Mengembalikan daftar alert baru
    yang dibangkitkan pada pemanggilan ini.
    """
    new_alerts: list[dict] = []

    for simpang in dashboard_data.get("simpang", []):
        pid = simpang["id_persimpangan"]
        nama = simpang["nama_lokasi"]

        # --- Congestion Alert ---
        if simpang.get("densitas_maks_pct") is not None:
            densitas_pct = simpang["densitas_maks_pct"]
            ratio = densitas_pct / 100.0

            if ratio >= THRESHOLD_KRITIS:
                severity = SEVERITY_KRITIS
                pesan = f"Peringatan: Kemacetan Terdeteksi di Persimpangan {nama}"
            elif ratio >= THRESHOLD_PERINGATAN_DINI:
                severity = SEVERITY_PERINGATAN_DINI
                pesan = f"Peringatan Dini: Kepadatan Tinggi di Persimpangan {nama} ({densitas_pct}%)"
            else:
                severity = None

            if severity and not _has_recent_alert(db, TIPE_CONGESTION, pid, severity):
                alert = NotifikasiAlert(
                    tipe=TIPE_CONGESTION,
                    severity=severity,
                    id_persimpangan=pid,
                    nama_lokasi=nama,
                    pesan=pesan,
                    densitas_pct=densitas_pct,
                )
                db.add(alert)
                new_alerts.append({
                    "tipe": TIPE_CONGESTION,
                    "severity": severity,
                    "id_persimpangan": pid,
                    "nama_lokasi": nama,
                    "pesan": pesan,
                    "densitas_pct": densitas_pct,
                })

        # --- Sensor Offline Alert ---
        if simpang.get("sensor_offline"):
            if not _has_recent_alert(db, TIPE_SENSOR_OFFLINE, pid, SEVERITY_OFFLINE):
                pesan_offline = f"Sensor Offline: Data pemantauan tidak tersedia untuk {nama}"
                alert = NotifikasiAlert(
                    tipe=TIPE_SENSOR_OFFLINE,
                    severity=SEVERITY_OFFLINE,
                    id_persimpangan=pid,
                    nama_lokasi=nama,
                    pesan=pesan_offline,
                    densitas_pct=None,
                )
                db.add(alert)
                new_alerts.append({
                    "tipe": TIPE_SENSOR_OFFLINE,
                    "severity": SEVERITY_OFFLINE,
                    "id_persimpangan": pid,
                    "nama_lokasi": nama,
                    "pesan": pesan_offline,
                })

    if new_alerts:
        db.commit()

    return new_alerts


def get_active_alerts(db: Session) -> list[dict]:
    """Ambil semua alert yang belum di-acknowledge, diurutkan terbaru dulu."""
    rows = db.scalars(
        select(NotifikasiAlert)
        .where(NotifikasiAlert.acknowledged == False)  # noqa: E712
        .order_by(NotifikasiAlert.waktu_dibuat.desc())
    ).all()
    return [_alert_dict(r) for r in rows]


def get_alert_history(db: Session, limit: int = 50) -> list[dict]:
    """Ambil riwayat semua alert (aktif maupun sudah di-acknowledge)."""
    rows = db.scalars(
        select(NotifikasiAlert)
        .order_by(NotifikasiAlert.waktu_dibuat.desc())
        .limit(limit)
    ).all()
    return [_alert_dict(r) for r in rows]


def acknowledge_alert(db: Session, alert_id: int, id_pengguna: int) -> dict | None:
    """Tandai alert sebagai sudah diakui/ditangani oleh petugas."""
    alert = db.get(NotifikasiAlert, alert_id)
    if alert is None:
        return None
    if alert.acknowledged:
        return _alert_dict(alert)
    alert.acknowledged = True
    alert.waktu_acknowledged = utcnow()
    alert.id_pengguna_ack = id_pengguna
    db.commit()
    return _alert_dict(alert)


def get_alert_summary(db: Session) -> dict:
    """Ringkasan alert untuk badge/notifikasi di dashboard."""
    total_active = db.scalar(
        select(func.count(NotifikasiAlert.id_alert))
        .where(NotifikasiAlert.acknowledged == False)  # noqa: E712
    )
    congestion_active = db.scalar(
        select(func.count(NotifikasiAlert.id_alert))
        .where(NotifikasiAlert.acknowledged == False, NotifikasiAlert.tipe == TIPE_CONGESTION)  # noqa: E712
    )
    sensor_active = db.scalar(
        select(func.count(NotifikasiAlert.id_alert))
        .where(NotifikasiAlert.acknowledged == False, NotifikasiAlert.tipe == TIPE_SENSOR_OFFLINE)  # noqa: E712
    )
    return {
        "total_aktif": total_active or 0,
        "congestion_aktif": congestion_active or 0,
        "sensor_offline_aktif": sensor_active or 0,
    }


def _alert_dict(alert: NotifikasiAlert) -> dict:
    return {
        "id_alert": alert.id_alert,
        "tipe": alert.tipe,
        "severity": alert.severity,
        "id_persimpangan": alert.id_persimpangan,
        "nama_lokasi": alert.nama_lokasi,
        "pesan": alert.pesan,
        "densitas_pct": alert.densitas_pct,
        "waktu_dibuat": alert.waktu_dibuat.isoformat(),
        "acknowledged": alert.acknowledged,
        "waktu_acknowledged": alert.waktu_acknowledged.isoformat() if alert.waktu_acknowledged else None,
        "id_pengguna_ack": alert.id_pengguna_ack,
    }


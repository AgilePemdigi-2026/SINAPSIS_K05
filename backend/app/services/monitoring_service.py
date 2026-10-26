"""Orkestrasi siklus pemantauan: sensor -> neuromorfik -> simpan ke database."""
from __future__ import annotations

from collections import deque
from datetime import datetime, timedelta

import numpy as np

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import (
    AktivitasNeuron, Deteksi, DetailRute, Jalur, KeputusanSinyal,
    KonfigurasiSistem, Persimpangan, RuteDarurat,
)
from app.ml.dataset import WINDOW
from app.ml.predictor import get_predictor
from app.services.neuromorphic import IntersectionEngine, Params
from app.services.sensor_source import CsvSensorSource, SensorOffline, SensorSource, SyntheticSensorSource
from app.core.timeutil import utcnow

PARAM_KEYS = {
    # kunci: (tipe, min, max, keterangan)
    "spike_threshold": (float, 0.05, 1.0, "Ambang batas spike LIF (rasio 0.05-1.0)"),
    "min_green_time": (int, 5, 60, "Durasi hijau minimum (detik)"),
    "max_green_time": (int, 20, 180, "Durasi hijau maksimum (detik)"),
    "amber_duration": (int, 2, 10, "Durasi kuning (detik)"),
}


def load_params(db: Session) -> Params:
    """Ambil nilai parameter terbaru dari KonfigurasiSistem (fallback ke default)."""
    p = Params()
    for key in PARAM_KEYS:
        row = db.scalars(
            select(KonfigurasiSistem)
            .where(KonfigurasiSistem.jenis_parameter == key)
            .order_by(KonfigurasiSistem.waktu_perubahan.desc(), KonfigurasiSistem.id_konfigurasi.desc())
        ).first()
        if row:
            setattr(p, {"min_green_time": "min_green", "max_green_time": "max_green", "amber_duration": "amber"}.get(key, key),
                    PARAM_KEYS[key][0](row.nilai))
    return p


class SensorHub:
    """Menyimpan sumber sensor & engine neuron per persimpangan (state runtime)."""

    def __init__(self):
        self.sources: dict[int, SensorSource] = {}
        self.engines: dict[int, IntersectionEngine] = {}
        self.offline: set[int] = set()
        self.history: dict[int, deque] = {}  # rasio kepadatan per langkah (maks 24), tiap elemen = 4 jalur
        self.last_ts: dict[int, datetime] = {}

    def reset(self):
        self.__init__()

    def source_for(self, id_persimpangan: int) -> SensorSource:
        if id_persimpangan not in self.sources:
            # simpang pertama memutar dataset CSV; lainnya data sintetis
            if id_persimpangan == settings.PILOT_INTERSECTION_ID:  # simpang pilot: putar ulang CSV, riwayat 24 jam pertama diisi lebih dulu
                src = CsvSensorSource(start=WINDOW)
                self.history[id_persimpangan] = deque(
                    ([c / settings.MAX_VEHICLES for c in r["counts"]] for r in src.rows[:WINDOW]), maxlen=WINDOW)
                self.last_ts[id_persimpangan] = datetime.strptime(src.rows[WINDOW - 1]["timestamp"], "%Y-%m-%d %H:%M:%S")
            else:
                src = SyntheticSensorSource("NORMAL")
            self.sources[id_persimpangan] = src
        return self.sources[id_persimpangan]

    def push(self, id_persimpangan: int, counts: list[int], ts: datetime | None) -> None:
        """Catat satu langkah (dianggap 1 jam) ke riwayat untuk model prediksi."""
        h = self.history.setdefault(id_persimpangan, deque(maxlen=WINDOW))
        h.append([min(1.0, max(0.0, c / settings.MAX_VEHICLES)) for c in counts])
        self.last_ts[id_persimpangan] = ts or (self.last_ts.get(id_persimpangan, datetime.now()) + timedelta(hours=1))

    def predict(self, id_persimpangan: int):
        """Return (nama_model, rasio[4]) atau None bila model/riwayat belum tersedia."""
        pred, h = get_predictor(), self.history.get(id_persimpangan)
        if pred is None or h is None or len(h) < WINDOW:
            return None
        ts = self.last_ts[id_persimpangan] + timedelta(hours=1)
        return pred.name, pred.predict_next(np.array(h).T, ts)

    def engine_for(self, id_persimpangan: int) -> IntersectionEngine:
        return self.engines.setdefault(id_persimpangan, IntersectionEngine(len(settings.LANE_NAMES)))


hub = SensorHub()


def _corridor_lanes(db: Session, persimpangan: Persimpangan) -> set[int]:
    """Indeks jalur (0..3) pada persimpangan ini yang dilewati rute darurat berstatus Aktif."""
    ids = {j.id_jalur: i for i, j in enumerate(sorted(persimpangan.jalur, key=lambda j: j.id_jalur))}
    rows = db.scalars(
        select(DetailRute.id_jalur)
        .join(RuteDarurat, RuteDarurat.id_rute == DetailRute.id_rute)
        .where(RuteDarurat.status == "Aktif", DetailRute.id_jalur.in_(ids.keys()))
    ).all()
    return {ids[r] for r in rows}


def run_cycle(db: Session, persimpangan: Persimpangan, counts: list[int] | None = None, hour: int | None = None) -> dict | None:
    """
    Jalankan satu siklus untuk satu persimpangan.
    Return None jika sensor offline (dan tandai persimpangan offline di hub).
    """
    ts = None
    source = hub.source_for(persimpangan.id_persimpangan)  # juga menyiapkan riwayat awal simpang pilot
    if counts is None:
        try:
            reading = source.read()
        except SensorOffline:
            hub.offline.add(persimpangan.id_persimpangan)
            return None
        counts, hour = reading["counts"], reading["hour"] if hour is None else hour
        if reading.get("timestamp"):
            ts = datetime.strptime(reading["timestamp"], "%Y-%m-%d %H:%M:%S")
    hub.offline.discard(persimpangan.id_persimpangan)
    hour = datetime.now().hour if hour is None else hour

    jalur = sorted(persimpangan.jalur, key=lambda j: j.id_jalur)
    hub.push(persimpangan.id_persimpangan, counts, ts)
    forecast = hub.predict(persimpangan.id_persimpangan)
    result = hub.engine_for(persimpangan.id_persimpangan).step(
        counts, hour, load_params(db), _corridor_lanes(db, persimpangan),
        predicted=None if forecast is None else [float(x) for x in forecast[1]],
    )
    result["prediction_model"] = None if forecast is None else forecast[0]
    now = utcnow()
    for lane in result["lanes"]:
        j = jalur[lane["lane_index"]]
        lane["id_jalur"], lane["arah"] = j.id_jalur, j.arah
        db.add(Deteksi(id_jalur=j.id_jalur, waktu_deteksi=now, jumlah_kendaraan=lane["vehicle_count"]))
        db.add(AktivitasNeuron(id_jalur=j.id_jalur, waktu=now, membrane_potential=lane["membrane_potential"],
                               status_spike=lane["spike"], threshold=lane["threshold"]))
        db.add(KeputusanSinyal(id_jalur=j.id_jalur, waktu_keputusan=now, warna_sinyal=lane["signal"],
                               durasi_detik=lane["duration"]))
    db.commit()
    result["id_persimpangan"] = persimpangan.id_persimpangan
    return result


def status_label(max_count: int) -> str:
    ratio = max_count / settings.MAX_VEHICLES
    if ratio >= settings.EMERGENCY_RATIO:
        return "Kritis"
    return "Padat" if ratio >= 0.5 else "Lancar"


def dashboard(db: Session) -> dict:
    """Ringkasan untuk halaman Pantau Kondisi Lalu Lintas."""
    items, alerts = [], []
    for p in db.scalars(select(Persimpangan).order_by(Persimpangan.id_persimpangan)).all():
        lane_ids = [j.id_jalur for j in p.jalur]
        latest = db.scalar(select(func.max(Deteksi.waktu_deteksi)).where(Deteksi.id_jalur.in_(lane_ids))) if lane_ids else None
        counts = []
        if latest:
            counts = [c for (c,) in db.execute(
                select(Deteksi.jumlah_kendaraan).where(Deteksi.id_jalur.in_(lane_ids), Deteksi.waktu_deteksi == latest)
            ).all()]
        offline = p.id_persimpangan in hub.offline
        label = "Sensor Offline" if offline else (status_label(max(counts)) if counts else "Belum ada data")
        items.append({
            "id_persimpangan": p.id_persimpangan, "nama_lokasi": p.nama_lokasi, "status": label,
            "jumlah_kendaraan": sum(counts), "sensor_offline": offline,
            "terakhir_diperbarui": latest.isoformat() if latest else None,
        })
        if label == "Kritis":
            alerts.append(p.nama_lokasi)
    any_offline = any(i["sensor_offline"] for i in items)
    return {
        "diperbarui": utcnow().isoformat(),
        "simpang": items,
        "congestion_alert": bool(alerts),
        "pesan_alert": f"Peringatan: Kemacetan Terdeteksi di Persimpangan {', '.join(alerts)}" if alerts else None,
        "pesan_sensor": "Data pemantauan tidak tersedia untuk beberapa simpang." if any_offline else None,
        "total_kendaraan": sum(i["jumlah_kendaraan"] for i in items),
    }


def congestion_by_name(db: Session) -> dict[str, float]:
    """Faktor kepadatan 0..1 per nama persimpangan (dipakai bobot Dijkstra)."""
    out = {}
    for item in dashboard(db)["simpang"]:
        if item["jumlah_kendaraan"]:
            out[item["nama_lokasi"]] = min(1.0, item["jumlah_kendaraan"] / (settings.MAX_VEHICLES * 4))
    return out


def prediction_payload(persimpangan: Persimpangan) -> dict:
    """Prediksi kepadatan jam berikutnya untuk satu persimpangan (tanpa menjalankan siklus)."""
    pred, h = get_predictor(), hub.history.get(persimpangan.id_persimpangan)
    n = len(h) if h else 0
    if pred is None:
        return {"tersedia": False, "alasan": "Model prediksi belum tersedia. Jalankan: python scripts/train_models.py"}
    forecast = hub.predict(persimpangan.id_persimpangan)
    if forecast is None:
        return {"tersedia": False, "alasan": "Riwayat belum cukup.", "riwayat": n, "dibutuhkan": WINDOW}
    name, ratios = forecast
    jalur = sorted(persimpangan.jalur, key=lambda j: j.id_jalur)
    lanes = [{"arah": j.arah, "prediksi_rasio": round(float(r), 3),
              "prediksi_kendaraan": round(float(r) * settings.MAX_VEHICLES),
              "peringatan_dini": bool(r >= pred.congestion_ratio)} for j, r in zip(jalur, ratios)]
    return {"tersedia": True, "model": name, "untuk_waktu": (hub.last_ts[persimpangan.id_persimpangan] + timedelta(hours=1)).isoformat(),
            "ambang_padat_rasio": pred.congestion_ratio, "jalur": lanes,
            "ada_peringatan_dini": any(l["peringatan_dini"] for l in lanes)}

"""
Sumber data sensor (pengganti kamera CCTV karena proyek ini murni software).

Semua sumber mengikuti antarmuka `SensorSource.read()` sehingga pipeline di
monitoring_service tidak peduli datanya dari CSV, sintetis, atau video.
"""
from __future__ import annotations

import csv
import random
from abc import ABC, abstractmethod
from pathlib import Path

from app.core.config import settings

DATA_CSV = Path(__file__).resolve().parents[2] / "data" / "traffic.csv"


class SensorOffline(Exception):
    """Dilempar saat sumber data tidak tersedia (skenario 'Sensor Offline')."""


class SensorSource(ABC):
    @abstractmethod
    def read(self) -> dict:
        """Return {'counts': [u, s, t, b], 'hour': int}."""


class SyntheticSensorSource(SensorSource):
    """Data sintetis per profil skenario (Normal / Rush Hour / Emergency / Night)."""

    PROFILES = {
        "NORMAL": ([8, 7, 4, 3], 2.5, 10),
        "RUSH_HOUR": ([16, 16, 16, 16], 1.5, 20),
        "EMERGENCY": ([18, 5, 4, 3], 1.0, 20),
        "NIGHT": ([2, 2, 2, 2], 1.0, 4),
    }

    def __init__(self, profile: str = "NORMAL", noise: bool = False, seed: int | None = None):
        if profile not in self.PROFILES:
            raise ValueError(f"profil tidak dikenal: {profile}")
        self.profile, self.noise = profile, noise
        self.rng = random.Random(seed)

    def read(self) -> dict:
        means, sd, hour = self.PROFILES[self.profile]
        sd = sd * (2 if self.noise else 1)
        counts = [max(0, min(settings.MAX_VEHICLES, round(self.rng.gauss(m, sd)))) for m in means]
        return {"counts": counts, "hour": hour}


class CsvSensorSource(SensorSource):
    """
    Memutar ulang dataset Traffic Prediction (traffic.csv): 4 junction -> 4 jalur.
    Jumlah kendaraan per jam diskalakan ke 0..MAX_VEHICLES memakai persentil-95 tiap junction.
    """

    def __init__(self, path: Path = DATA_CSV, start: int = 0):
        self.rows: list[dict] = []  # satu entri per timestamp yang memiliki 4 junction lengkap
        by_time: dict[str, dict[int, int]] = {}
        with open(path, newline="") as f:
            for r in csv.DictReader(f):
                by_time.setdefault(r["DateTime"], {})[int(r["Junction"])] = int(r["Vehicles"])
        p95: dict[int, float] = {}
        for j in (1, 2, 3, 4):
            vals = sorted(v[j] for v in by_time.values() if j in v)
            p95[j] = vals[int(len(vals) * 0.95) - 1]
        for ts in sorted(by_time):
            v = by_time[ts]
            if all(j in v for j in (1, 2, 3, 4)):
                counts = [min(settings.MAX_VEHICLES, round(v[j] / p95[j] * settings.MAX_VEHICLES)) for j in (1, 2, 3, 4)]
                self.rows.append({"counts": counts, "hour": int(ts[11:13]), "timestamp": ts})
        if not self.rows:
            raise ValueError("CSV tidak memuat timestamp dengan 4 junction lengkap")
        self.pos = start % len(self.rows)

    def read(self) -> dict:
        row = self.rows[self.pos]
        self.pos = (self.pos + 1) % len(self.rows)
        return row


class OfflineSensorSource(SensorSource):
    """Mensimulasikan kamera/sensor mati."""

    def read(self) -> dict:
        raise SensorOffline("sensor offline")


class VideoSensorSource(SensorSource):
    """
    Menghitung kendaraan dari file video memakai YOLOv8 (opsional).
    Membutuhkan: pip install ultralytics opencv-python-headless
    Satu pemanggilan read() memproses satu frame; frame dibagi ke 4 jalur menurut kuadran gambar.
    """

    VEHICLE_CLASSES = {"car", "motorcycle", "bus", "truck"}

    def __init__(self, video_path: str, weights: str = "yolov8n.pt", hour: int = 8):
        try:
            import cv2
            from ultralytics import YOLO
        except ImportError as e:  # pragma: no cover
            raise RuntimeError("Fitur video butuh 'ultralytics' dan 'opencv-python-headless'") from e
        self._cv2 = cv2
        self.model = YOLO(weights)
        self.cap = cv2.VideoCapture(video_path)
        if not self.cap.isOpened():
            raise SensorOffline(f"video tidak bisa dibuka: {video_path}")
        self.hour = hour

    def read(self) -> dict:  # pragma: no cover
        ok, frame = self.cap.read()
        if not ok:
            self.cap.set(self._cv2.CAP_PROP_POS_FRAMES, 0)
            ok, frame = self.cap.read()
            if not ok:
                raise SensorOffline("frame video tidak terbaca")
        h, w = frame.shape[:2]
        counts = [0, 0, 0, 0]  # Utara, Selatan, Timur, Barat
        for box in self.model.predict(frame, verbose=False)[0].boxes:
            if self.model.names[int(box.cls)] not in self.VEHICLE_CLASSES:
                continue
            x, y = float(box.xywh[0][0]), float(box.xywh[0][1])
            lane = (0 if y < h / 2 else 1) if abs(y - h / 2) / h > abs(x - w / 2) / w else (2 if x > w / 2 else 3)
            counts[lane] += 1
        return {"counts": [min(settings.MAX_VEHICLES, c) for c in counts], "hour": self.hour}

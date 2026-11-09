"""Deteksi kendaraan dari frame menggunakan YOLOv8.

Dependensi YOLO bersifat opsional. Modul ini dapat diimpor oleh aplikasi utama
tanpa memasang ``ultralytics``; dependensi baru dibutuhkan saat model dimuat.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import Any, TypedDict

import numpy as np

from app.core.config import settings


VEHICLE_CLASSES = frozenset({"car", "bus", "truck", "motorcycle"})
LANE_NAMES = tuple(settings.LANE_NAMES)


class BoundingBox(TypedDict):
    x1: float
    y1: float
    x2: float
    y2: float


class VehicleDetection(TypedDict):
    class_name: str
    confidence: float
    bbox: BoundingBox
    lane: str


class DetectionResult(TypedDict):
    total: int
    counts: dict[str, int]
    detections: list[VehicleDetection]


LaneMapper = Callable[[float, float, int, int], str]


def load_model(weights: str | Path = "yolov8n.pt") -> Any:
    """Load and return a YOLOv8 model.

    The import is deliberately local so non-video deployments do not require
    the optional YOLO dependencies during application startup.
    """
    try:
        from ultralytics import YOLO
    except ImportError as error:  # pragma: no cover - depends on environment
        raise RuntimeError(
            "YOLO membutuhkan paket 'ultralytics'. "
            "Pasang juga 'opencv-python-headless' bila membaca video."
        ) from error
    return YOLO(str(weights))


def quadrant_lane(center_x: float, center_y: float, width: int, height: int) -> str:
    """Map a bounding-box center to Utara/Selatan/Timur/Barat."""
    vertical_distance = abs(center_y - height / 2) / max(height, 1)
    horizontal_distance = abs(center_x - width / 2) / max(width, 1)
    if vertical_distance > horizontal_distance:
        return LANE_NAMES[0] if center_y < height / 2 else LANE_NAMES[1]
    return LANE_NAMES[2] if center_x > width / 2 else LANE_NAMES[3]


class YoloVehicleService:
    """Run YOLOv8 vehicle detection on individual camera frames."""

    def __init__(
        self,
        weights: str | Path = "yolov8n.pt",
        model: Any | None = None,
        confidence: float = 0.15,
        lane_mapper: LaneMapper = quadrant_lane,
    ) -> None:
        if not 0 <= confidence <= 1:
            raise ValueError("confidence harus berada di antara 0 dan 1")
        self.model = model if model is not None else load_model(weights)
        self.confidence = confidence
        self.lane_mapper = lane_mapper

    def detect(self, frame: np.ndarray) -> DetectionResult:
        """Detect vehicles in ``frame`` and return counts plus bounding boxes."""
        if not isinstance(frame, np.ndarray) or frame.ndim < 2:
            raise ValueError("frame harus berupa numpy.ndarray berdimensi minimal 2")

        height, width = frame.shape[:2]
        counts = {lane: 0 for lane in LANE_NAMES}
        detections: list[VehicleDetection] = []
        result = self.model.predict(source=frame, conf=self.confidence, verbose=False)[0]
        names = self._class_names(result)

        for box in result.boxes:
            class_name = names.get(self._scalar_int(box.cls), "")
            if class_name not in VEHICLE_CLASSES:
                continue

            x1, y1, x2, y2 = self._box_coordinates(box)
            center_x = (x1 + x2) / 2
            center_y = (y1 + y2) / 2
            lane = self.lane_mapper(center_x, center_y, width, height)
            if lane not in counts:
                raise ValueError(f"lane_mapper menghasilkan jalur tidak dikenal: {lane}")
            counts[lane] += 1
            detections.append({
                "class_name": class_name,
                "confidence": round(self._scalar_float(box.conf), 4),
                "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
                "lane": lane,
            })

        return {"total": len(detections), "counts": counts, "detections": detections}

    @staticmethod
    def draw_detections(
        frame: np.ndarray,
        result: DetectionResult,
    ) -> np.ndarray:
        """Draw detection boxes and labels on a copy of an OpenCV BGR frame."""
        try:
            import cv2
        except ImportError as error:  # pragma: no cover - depends on environment
            raise RuntimeError(
                "Visualisasi deteksi membutuhkan paket 'opencv-python-headless'."
            ) from error

        annotated_frame = frame.copy()
        color = (0, 255, 0)
        for detection in result["detections"]:
            bbox = detection["bbox"]
            x1, y1 = int(round(bbox["x1"])), int(round(bbox["y1"]))
            x2, y2 = int(round(bbox["x2"])), int(round(bbox["y2"]))
            label = f"{detection['class_name']} {detection['confidence']:.2f}"
            cv2.rectangle(annotated_frame, (x1, y1), (x2, y2), color, 2)
            cv2.putText(
                annotated_frame,
                label,
                (x1, max(y1 - 10, 20)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                color,
                2,
                cv2.LINE_AA,
            )
        return annotated_frame

    @staticmethod
    def _class_names(result: Any) -> dict[int, str]:
        names = getattr(result, "names", {})
        if isinstance(names, Mapping):
            return {int(key): str(value) for key, value in names.items()}
        if isinstance(names, Sequence) and not isinstance(names, (str, bytes)):
            return dict(enumerate(map(str, names)))
        return {}

    @staticmethod
    def _scalar_float(value: Any) -> float:
        if hasattr(value, "item") and callable(value.item):
            return float(value.item())
        return float(value[0] if hasattr(value, "__len__") else value)

    @staticmethod
    def _scalar_int(value: Any) -> int:
        if hasattr(value, "item"):
            return int(value.item())
        return int(value[0] if hasattr(value, "__len__") else value)

    @classmethod
    def _box_coordinates(cls, box: Any) -> tuple[float, float, float, float]:
        coordinates = box.xyxy[0]
        return tuple(cls._scalar_float(coordinates[index]) for index in range(4))  # type: ignore[return-value]
"""Deteksi kendaraan dari frame menggunakan YOLOv8.

Dependensi YOLO bersifat opsional. Modul ini dapat diimpor oleh aplikasi utama
tanpa memasang ``ultralytics``; dependensi baru dibutuhkan saat model dimuat.
"""
from __future__ import annotations

import os
import re
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import Any, TypedDict
from uuid import uuid4

import numpy as np

from app.core.config import settings


VEHICLE_CLASSES = frozenset({"car", "bus", "truck", "motorcycle"})
LANE_NAMES = tuple(settings.LANE_NAMES)
STANDARD_FRAME_SIZE = (640, 640)


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
    try:
        return YOLO(str(weights))
    except Exception as error:
        raise RuntimeError(
            f"Model YOLOv8 gagal dimuat dari '{weights}'. "
            "Pastikan ultralytics terpasang, bobot .pt tersedia, dan server dapat membacanya."
        ) from error


def save_annotated_snapshot(
    encoded_image: bytes,
    lane: str | None = None,
    intersection_id: int | None = None,
) -> str | None:
    """Simpan snapshot anotasi ke disk; None berarti pemanggil memakai Base64."""
    if not encoded_image:
        return None

    upload_dir = Path(
        os.getenv(
            "VISION_UPLOAD_DIR",
            str(Path(__file__).resolve().parents[1] / "static" / "uploads"),
        )
    )
    try:
        os.makedirs(upload_dir, exist_ok=True)
        safe_lane = re.sub(r"[^A-Za-z0-9_-]+", "-", lane or "lane").strip("-")
        prefix = f"{intersection_id}-" if intersection_id is not None else ""
        filename = f"{prefix}{safe_lane}-{uuid4().hex}.jpg"
        output_path = upload_dir / filename
        output_path.write_bytes(encoded_image)
        if not output_path.is_file():
            return None
    except (OSError, PermissionError) as error:
        print(f"Warning: penyimpanan snapshot vision gagal ({error}). Menggunakan Base64 fallback.")
        return None
    except Exception as error:
        print(f"Warning: penyimpanan snapshot vision tidak tersedia ({error}). Menggunakan Base64 fallback.")
        return None

    url_prefix = os.getenv("VISION_UPLOAD_URL_PREFIX", "/static/uploads").rstrip("/")
    return f"{url_prefix}/{filename}"


def process_annotated_video(
    video_bytes: bytes,
    filename: str | None,
    service: "YoloVehicleService",
    lane: str,
    intersection_id: int | None = None,
    sample_interval_seconds: float = 0.5,
) -> dict[str, Any]:
    """Proses video, buat file MP4 berbounding box, dan hitung metrik kendaraan."""
    if not video_bytes:
        raise ValueError("File video kosong.")

    try:
        import cv2
    except ImportError as error:
        raise RuntimeError(
            "Pemrosesan video membutuhkan paket 'opencv-python-headless'."
        ) from error

    upload_dir = Path(
        os.getenv(
            "VISION_UPLOAD_DIR",
            str(Path(__file__).resolve().parents[1] / "static" / "uploads"),
        )
    )
    try:
        os.makedirs(upload_dir, exist_ok=True)
    except (OSError, PermissionError) as error:
        raise RuntimeError(
            f"Direktori penyimpanan video tidak dapat dibuat atau ditulis: {error}"
        ) from error

    original_name = re.sub(r"[^A-Za-z0-9_.-]+", "-", filename or "video")
    original_suffix = Path(original_name).suffix.casefold() or ".mp4"
    allowed_suffixes = {".mp4", ".avi", ".mov", ".m4v"}
    if original_suffix not in allowed_suffixes:
        raise ValueError("Format video harus MP4, AVI, atau MOV.")

    safe_lane = re.sub(r"[^A-Za-z0-9_-]+", "-", lane).strip("-") or "lane"
    prefix = f"{intersection_id}-" if intersection_id is not None else ""
    token = uuid4().hex
    source_path = upload_dir / f"{prefix}{safe_lane}-{token}-source{original_suffix}"
    output_path = upload_dir / f"{prefix}{safe_lane}-{token}-annotated.mp4"
    try:
        source_path.write_bytes(video_bytes)
    except (OSError, PermissionError) as error:
        raise RuntimeError(
            f"Penyimpanan file video gagal; server memakai direktori read-only: {error}"
        ) from error

    capture = cv2.VideoCapture(str(source_path))
    if not capture.isOpened():
        source_path.unlink(missing_ok=True)
        raise ValueError("File video tidak dapat dibaca oleh OpenCV.")

    fps = float(capture.get(cv2.CAP_PROP_FPS))
    if fps <= 0:
        fps = 30.0
    sample_interval = max(round(fps * sample_interval_seconds), 1)

    writer: Any | None = None
    peak_count = 0
    sampled_total = 0
    sampled_frames = 0
    frame_index = 0
    current_detection: DetectionResult | None = None
    latest_detections: list[dict[str, Any]] = []
    latest_counts = {lane_name: 0 for lane_name in LANE_NAMES}
    peak_counts = {lane_name: 0 for lane_name in LANE_NAMES}

    try:
        while True:
            read_ok, frame = capture.read()
            if not read_ok:
                break

            prepared = YoloVehicleService.prepare_frame(frame)
            if writer is None:
                height, width = prepared.shape[:2]
                writer = cv2.VideoWriter(
                    str(output_path),
                    cv2.VideoWriter_fourcc(*"mp4v"),
                    fps,
                    (width, height),
                )
                if not writer.isOpened():
                    writer.release()
                    writer = None
                    raise RuntimeError(
                        "OpenCV gagal membuat file video hasil anotasi MP4."
                    )

            if frame_index % sample_interval == 0:
                detection = service.detect(prepared)
                current_detection = detection
                latest_detections = detection["detections"]
                latest_counts = {
                    lane_name: sum(
                        1 for item in latest_detections
                        if item["lane"] == lane_name
                    )
                    for lane_name in LANE_NAMES
                }
                for lane_name in LANE_NAMES:
                    peak_counts[lane_name] = max(
                        peak_counts[lane_name],
                        latest_counts[lane_name],
                    )
                lane_count = latest_counts.get(lane, 0)
                peak_count = max(peak_count, lane_count)
                sampled_total += lane_count
                sampled_frames += 1

            annotated = (
                service.draw_detections(prepared, current_detection)
                if frame_index % sample_interval == 0 and current_detection is not None
                else prepared
            )
            writer.write(annotated)
            frame_index += 1
    finally:
        capture.release()
        if writer is not None:
            writer.release()

    if frame_index == 0:
        source_path.unlink(missing_ok=True)
        output_path.unlink(missing_ok=True)
        raise ValueError("Video tidak memiliki frame yang dapat diproses.")

    average_count = (
        round(sampled_total / sampled_frames, 2)
        if sampled_frames
        else 0.0
    )
    url_prefix = os.getenv("VISION_UPLOAD_URL_PREFIX", "/static/uploads").rstrip("/")

    if output_path.is_file() and output_path.stat().st_size > 0:
        video_url = f"{url_prefix}/{output_path.name}"
        video_path = str(output_path)
        fallback = None
    else:
        video_url = f"{url_prefix}/{source_path.name}"
        video_path = str(source_path)
        fallback = "source-video"

    return {
        "total": peak_count,
        "counts": peak_counts,
        "detections": latest_detections,
        "average": average_count,
        "peak": peak_count,
        "sampled_frames": sampled_frames,
        "frames_processed": frame_index,
        "video_url": video_url,
        "video_path": video_path,
        "fallback": fallback,
    }


def quadrant_lane(center_x: float, center_y: float, width: int, height: int) -> str:
    """Map a center using normalized 0.0-1.0 X/Y coordinates."""
    x_ratio = center_x / max(width, 1)
    y_ratio = center_y / max(height, 1)
    vertical_distance = abs(y_ratio - 0.5)
    horizontal_distance = abs(x_ratio - 0.5)
    if vertical_distance > horizontal_distance:
        return LANE_NAMES[0] if y_ratio < 0.5 else LANE_NAMES[1]
    return LANE_NAMES[2] if x_ratio > 0.5 else LANE_NAMES[3]


class YoloVehicleService:
    """Run YOLOv8 vehicle detection on individual camera frames."""

    def __init__(
        self,
        weights: str | Path = "yolov8n.pt",
        model: Any | None = None,
        confidence: float = 0.15,
        lane_mapper: LaneMapper = quadrant_lane,
        fixed_lane: str | None = None,
    ) -> None:
        if not 0 <= confidence <= 1:
            raise ValueError("confidence harus berada di antara 0 dan 1")
        if fixed_lane is not None and fixed_lane not in LANE_NAMES:
            raise ValueError(f"fixed_lane tidak dikenal: {fixed_lane}")
        self.model = model if model is not None else load_model(weights)
        self.confidence = confidence
        self.lane_mapper = lane_mapper
        self.fixed_lane = fixed_lane

    def detect(self, frame: np.ndarray) -> DetectionResult:
        """Detect vehicles in ``frame`` and return counts plus bounding boxes."""
        if not isinstance(frame, np.ndarray) or frame.ndim < 2:
            raise ValueError("frame harus berupa numpy.ndarray berdimensi minimal 2")

        frame = self.prepare_frame(frame)
        height, width = frame.shape[:2]
        counts = {lane: 0 for lane in LANE_NAMES}
        detections: list[VehicleDetection] = []
        try:
            prediction = self.model.predict(
                source=frame,
                conf=self.confidence,
                verbose=False,
            )
            if not prediction:
                raise RuntimeError("YOLOv8 tidak menghasilkan hasil prediksi.")
            result = prediction[0]
        except RuntimeError:
            raise
        except Exception as error:
            raise RuntimeError(
                "Inferensi YOLOv8 gagal dijalankan pada frame gambar."
            ) from error
        names = self._class_names(result)

        for box in result.boxes:
            class_name = names.get(self._scalar_int(box.cls), "")
            if class_name not in VEHICLE_CLASSES:
                continue

            x1, y1, x2, y2 = self._box_coordinates(box)
            center_x = (x1 + x2) / 2
            center_y = (y1 + y2) / 2
            lane = (
                self.fixed_lane
                if self.fixed_lane is not None
                else self.lane_mapper(center_x, center_y, width, height)
            )
            if lane not in counts:
                raise ValueError(f"lane_mapper menghasilkan jalur tidak dikenal: {lane}")
            detections.append({
                "class_name": class_name,
                "confidence": round(self._scalar_float(box.conf), 4),
                "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
                "lane": lane,
            })

        counts = {
            lane_name: sum(
                1 for detection in detections
                if detection["lane"] == lane_name
            )
            for lane_name in LANE_NAMES
        }
        return {
            "total": len(detections),
            "counts": counts,
            "detections": detections,
        }

    @staticmethod
    def prepare_frame(frame: np.ndarray) -> np.ndarray:
        """Resize every input to the deterministic YOLO inference size."""
        try:
            import cv2
        except ImportError as error:  # pragma: no cover - optional vision dependency
            raise RuntimeError("Inferensi YOLO membutuhkan paket 'opencv-python-headless'.") from error
        return cv2.resize(frame, STANDARD_FRAME_SIZE, interpolation=cv2.INTER_AREA)

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

        annotated_frame = YoloVehicleService.prepare_frame(frame)
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
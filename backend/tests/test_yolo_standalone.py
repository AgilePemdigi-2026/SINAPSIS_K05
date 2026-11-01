"""Smoke test mandiri untuk service deteksi YOLOv8.

Jalankan dari root repository dengan:
    python backend/tests/test_yolo_standalone.py

Skrip ini membutuhkan ``ultralytics`` dan bobot ``yolov8n.pt``. Jika bobot
belum ada, Ultralytics akan mengunduhnya saat ``load_model`` dipanggil.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2


# Allow direct execution without installing the backend as a package.
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.yolo_service import VEHICLE_CLASSES, load_model


def main() -> None:
    """Load YOLOv8, detect vehicles in utara.jpg, and print the result."""
    image_path = (Path(__file__).resolve().parent / "pictures" / "utara.jpg").resolve()
    frame = cv2.imread(str(image_path))
    if frame is None:
        print(f"ERROR: gambar tidak dapat dibaca atau tidak ditemukan: {image_path}")
        return

    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    print("Loading YOLOv8 model: yolov8n.pt")
    model = load_model("yolov8n.pt")

    confidence = 0.25
    raw_result = model.predict(source=frame_rgb, conf=confidence, imgsz=640, verbose=False)[0]
    print(f"Raw YOLO detections: {len(raw_result.boxes)}")

    detections = []
    vehicle_count = 0
    names = raw_result.names
    print("Detected objects:")
    for box in raw_result.boxes:
        class_id = int(box.cls[0])
        label = names[class_id]
        confidence_value = float(box.conf[0])
        print(f"- {label}: confidence={confidence_value:.4f}")

        if label not in VEHICLE_CLASSES:
            continue
        vehicle_count += 1
        x1, y1, x2, y2 = (float(value) for value in box.xyxy[0])
        detections.append({
            "class_name": label,
            "confidence": round(confidence_value, 4),
            "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
        })

    object_classes = [
        names[int(box.cls[0])]
        for box in raw_result.boxes
    ]
    print(f"Total kendaraan terdeteksi: {vehicle_count}")
    print(f"Kelas objek terdeteksi: {object_classes}")

    print(json.dumps({
        "image": str(image_path),
        "total": vehicle_count,
        "counts": {"all": vehicle_count},
        "detections": detections,
    }, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
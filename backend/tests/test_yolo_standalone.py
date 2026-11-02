"""Smoke test mandiri untuk service deteksi YOLOv8.

Jalankan dari root repository dengan:
    python backend/tests/test_yolo_standalone.py

Skrip ini membutuhkan ``ultralytics`` dan bobot ``yolov8n.pt``. Jika bobot
belum ada, Ultralytics akan mengunduhnya saat service dibuat.
"""
from __future__ import annotations

import sys
from pathlib import Path

import cv2


# Allow direct execution without installing the backend as a package.
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.yolo_service import YoloVehicleService


def main() -> None:
    """Run vehicle detection for every camera image in the pictures folder."""
    tests_dir = Path(__file__).resolve().parent
    pictures_dir = tests_dir / "pictures"
    result_dir = tests_dir / "result_test"
    result_dir.mkdir(parents=True, exist_ok=True)

    lane_names = ("Utara", "Selatan", "Timur", "Barat")
    lane_by_stem = {lane.casefold(): lane for lane in lane_names}
    image_extensions = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
    image_paths = sorted(
        path
        for path in pictures_dir.iterdir()
        if path.is_file() and path.suffix.casefold() in image_extensions
    )
    if not image_paths:
        raise FileNotFoundError(f"Tidak ada file gambar di folder: {pictures_dir}")

    confidence = 0.15
    service = YoloVehicleService(confidence=confidence)
    print(f"Confidence threshold: {confidence}")
    combined_counts = {lane: 0 for lane in lane_names}
    intersection_total = 0

    for image_path in image_paths:
        lane = lane_by_stem.get(image_path.stem.casefold())
        if lane is None:
            raise ValueError(
                f"Nama file harus sesuai lajur {lane_names}: {image_path.name}"
            )

        frame = cv2.imread(str(image_path))
        if frame is None:
            raise OSError(f"Gambar tidak dapat dibaca: {image_path}")

        result = service.detect(frame)
        detected_count = result["total"]
        intersection_total += detected_count
        combined_counts[lane] += detected_count

        print(f"{image_path.name} ({lane}): {detected_count} kendaraan")
        for index, detection in enumerate(result["detections"], start=1):
            print(
                f"- {index}. {detection['class_name']} "
                f"(confidence={detection['confidence']:.4f})"
            )

        annotated_frame = frame.copy()
        box_color = (0, 255, 0)
        for detection in result["detections"]:
            bbox = detection["bbox"]
            x1, y1 = int(round(bbox["x1"])), int(round(bbox["y1"]))
            x2, y2 = int(round(bbox["x2"])), int(round(bbox["y2"]))
            label = f"{detection['class_name']} {detection['confidence']:.2f}"
            cv2.rectangle(annotated_frame, (x1, y1), (x2, y2), box_color, 2)
            cv2.putText(
                annotated_frame,
                label,
                (x1, max(y1 - 10, 20)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                box_color,
                2,
                cv2.LINE_AA,
            )

        output_path = result_dir / f"{lane}_detected.jpg"
        if not cv2.imwrite(str(output_path), annotated_frame):
            raise OSError(f"Gambar hasil deteksi gagal disimpan: {output_path}")
        print(f"  Hasil visualisasi disimpan: {output_path.resolve()}")

    print("\nRingkasan total kendaraan persimpangan:")
    print(f"Total kendaraan: {intersection_total}")
    print(f"Rincian per lajur: {combined_counts}")


if __name__ == "__main__":
    main()
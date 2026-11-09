"""Smoke test mandiri untuk service deteksi YOLOv8.

Jalankan dari root repository dengan:
    python backend/tests/test_yolo_standalone.py

Skrip ini membutuhkan ``ultralytics`` dan bobot ``yolov8n.pt``. Jika bobot
belum ada, Ultralytics akan mengunduhnya saat service dibuat.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

import cv2


# Allow direct execution without installing the backend as a package.
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.yolo_service import DetectionResult, YoloVehicleService

VIDEO_SAMPLE_SECONDS = 1.0
MAX_VIDEO_SAMPLES = 50


def _print_detections(result: DetectionResult) -> None:
    """Print the detected vehicle classes and confidence values."""
    for index, detection in enumerate(result["detections"], start=1):
        print(
            f"- {index}. {detection['class_name']} "
            f"(confidence={detection['confidence']:.4f})"
        )


def _process_image(
    service: YoloVehicleService,
    image_path: Path,
    result_dir: Path,
    lane: str,
) -> int:
    frame = cv2.imread(str(image_path))
    if frame is None:
        raise OSError(f"Gambar tidak dapat dibaca: {image_path}")

    result = service.detect(frame)
    detected_count = result["total"]
    print(f"{image_path.name} ({lane}): {detected_count} kendaraan")
    _print_detections(result)

    annotated_frame = service.draw_detections(frame, result)
    output_path = result_dir / f"{lane}_detected.jpg"
    if not cv2.imwrite(str(output_path), annotated_frame):
        raise OSError(f"Gambar hasil deteksi gagal disimpan: {output_path}")
    print(f"  Hasil visualisasi disimpan: {output_path.resolve()}")
    return detected_count


def _process_video(
    service: YoloVehicleService,
    video_path: Path,
    result_dir: Path,
    lane: str,
) -> int:
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise OSError(f"Video tidak dapat dibuka: {video_path}")

    writer: cv2.VideoWriter | None = None
    total_detected = 0
    sampled_frame_count = 0
    source_frame_count = 0
    try:
        fps = capture.get(cv2.CAP_PROP_FPS)
        if fps <= 0:
            fps = 30.0

        sample_interval = max(round(fps * VIDEO_SAMPLE_SECONDS), 1)
        output_path = result_dir / f"{lane}_detected.mp4"
        while True:
            read_success, frame = capture.read()
            if not read_success:
                break
            source_frame_count += 1
            if (source_frame_count - 1) % sample_interval != 0:
                continue

            if writer is None:
                height, width = frame.shape[:2]
                writer = cv2.VideoWriter(
                    str(output_path),
                    cv2.VideoWriter_fourcc(*"mp4v"),
                    fps / sample_interval,
                    (width, height),
                )
                if not writer.isOpened():
                    raise OSError(f"Video hasil deteksi gagal dibuat: {output_path}")

            result = service.detect(frame)
            total_detected += result["total"]
            sampled_frame_count += 1
            writer.write(service.draw_detections(frame, result))
            if sampled_frame_count >= MAX_VIDEO_SAMPLES:
                break
    finally:
        capture.release()
        if writer is not None:
            writer.release()

    if sampled_frame_count == 0:
        raise OSError(f"Video tidak memiliki frame yang dapat dibaca: {video_path}")

    print(
        f"{video_path.name} ({lane}): {total_detected} kendaraan "
        f"terdeteksi dari {sampled_frame_count} frame sampel "
        f"(interval {sample_interval} frame, dibaca {source_frame_count} frame)"
    )
    print(f"  Hasil visualisasi disimpan: {output_path.resolve()}")
    return total_detected


def main() -> None:
    """Run vehicle detection for every image and video in the pictures folder."""
    tests_dir = Path(__file__).resolve().parent
    pictures_dir = tests_dir / "pictures"
    result_dir = tests_dir / "result_test"
    result_dir.mkdir(parents=True, exist_ok=True)

    lane_names = ("Utara", "Selatan", "Timur", "Barat")
    lane_by_stem = {lane.casefold(): lane for lane in lane_names}
    image_extensions = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
    video_extensions = {".mp4"}
    input_paths = sorted(
        path
        for path in pictures_dir.iterdir()
        if path.is_file()
        and path.suffix.casefold() in image_extensions | video_extensions
    )
    if not input_paths:
        raise FileNotFoundError(
            f"Tidak ada file gambar atau video di folder: {pictures_dir}"
        )

    confidence = 0.15
    service = YoloVehicleService(confidence=confidence)
    print(f"Confidence threshold: {confidence}")
    combined_counts = {lane: 0 for lane in lane_names}
    intersection_total = 0
    processing_started_at = time.perf_counter()

    for input_path in input_paths:
        lane = lane_by_stem.get(input_path.stem.casefold())
        if lane is None:
            raise ValueError(
                f"Nama file harus sesuai lajur {lane_names}: {input_path.name}"
            )

        if input_path.suffix.casefold() in video_extensions:
            detected_count = _process_video(service, input_path, result_dir, lane)
        else:
            detected_count = _process_image(service, input_path, result_dir, lane)
        intersection_total += detected_count
        combined_counts[lane] += detected_count

    print("\nRingkasan total kendaraan persimpangan:")
    print(f"Total kendaraan: {intersection_total}")
    print(f"Rincian per lajur: {combined_counts}")
    print(
        f"Waktu total pemrosesan: "
        f"{time.perf_counter() - processing_started_at:.2f} detik"
    )


if __name__ == "__main__":
    main()
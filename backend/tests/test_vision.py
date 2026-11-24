"""Integrasi endpoint vision dengan persistensi Deteksi dan siklus LIF."""
from types import SimpleNamespace

import cv2
import numpy as np
import sys
from types import ModuleType

from app.routers import vision
from app.services import yolo_service
from app.services.yolo_service import YoloVehicleService


class FakeBox:
    cls = np.array([2])
    conf = np.array([0.91])
    xyxy = np.array([[10.0, 10.0, 80.0, 80.0]])


class FakeModel:
    names = {2: "car"}

    def predict(self, **kwargs):
        return [SimpleNamespace(names=self.names, boxes=[FakeBox()])]


class ShapeTrackingModel(FakeModel):
    def __init__(self):
        self.seen_shape = None

    def predict(self, **kwargs):
        self.seen_shape = kwargs["source"].shape
        return super().predict(**kwargs)


def test_yolo_service_normalizes_frame_size_before_inference():
    model = ShapeTrackingModel()
    YoloVehicleService(model=model).detect(np.zeros((120, 240, 3), dtype=np.uint8))
    assert model.seen_shape == (640, 640, 3)


def test_yolo_counts_are_derived_from_lane_detection_elements():
    class MultiLaneBoxModel(FakeModel):
        def predict(self, **kwargs):
            boxes = [
                SimpleNamespace(
                    cls=np.array([2]),
                    conf=np.array([0.91]),
                    xyxy=np.array([[500.0, 300.0, 580.0, 380.0]]),
                ),
                SimpleNamespace(
                    cls=np.array([2]),
                    conf=np.array([0.88]),
                    xyxy=np.array([[520.0, 320.0, 600.0, 400.0]]),
                ),
                SimpleNamespace(
                    cls=np.array([2]),
                    conf=np.array([0.85]),
                    xyxy=np.array([[40.0, 300.0, 100.0, 360.0]]),
                ),
            ]
            return [SimpleNamespace(names=self.names, boxes=boxes)]

    frame = np.zeros((640, 640, 3), dtype=np.uint8)
    result = YoloVehicleService(model=MultiLaneBoxModel()).detect(frame)

    assert sum(result["counts"].values()) == len(result["detections"])
    assert result["counts"]["Barat"] == sum(
        1 for detection in result["detections"]
        if detection["lane"] == "Barat"
    )
    assert result["counts"]["Timur"] == sum(
        1 for detection in result["detections"]
        if detection["lane"] == "Timur"
    )


def test_fixed_lane_assigns_all_detected_boxes_to_requested_slot():
    frame = np.zeros((640, 640, 3), dtype=np.uint8)

    result = YoloVehicleService(
        model=FakeModel(),
        fixed_lane="Barat",
    ).detect(frame)

    assert result["total"] == 1
    assert result["counts"]["Barat"] == 1
    assert all(result["counts"][lane] == 0 for lane in ("Utara", "Selatan", "Timur"))
    assert all(detection["lane"] == "Barat" for detection in result["detections"])


def test_vision_upload_persists_lane_and_updates_dashboard(client, admin, monkeypatch):
    service = YoloVehicleService(model=FakeModel(), confidence=0.15)
    monkeypatch.setattr(vision, "get_yolo_service", lambda: service)

    ok, encoded = cv2.imencode(".jpg", np.zeros((120, 120, 3), dtype=np.uint8))
    assert ok
    response = client.post(
        "/api/vision/detect",
        headers=admin,
        data={"lane": "Utara", "id_persimpangan": "1"},
        files={"frame": ("frame.jpg", encoded.tobytes(), "image/jpeg")},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 1
    assert body["counts"]["Utara"] == 1
    assert body["ai_cycle"]["lanes"][0]["vehicle_count"] == 1
    assert body["annotated_image"].startswith("data:image/jpeg;base64,")

    annotated = client.post(
        "/api/vision/detect-image?lane=Utara&id_persimpangan=1",
        headers=admin,
        files={"frame": ("frame.jpg", encoded.tobytes(), "image/jpeg")},
    )
    assert annotated.status_code == 200
    assert annotated.headers["content-type"].startswith("image/jpeg")

    dashboard = client.get("/api/monitoring/dashboard", headers=admin).json()
    pilot = next(item for item in dashboard["simpang"] if item["id_persimpangan"] == 1)
    north = next(lane for lane in pilot["jalur"] if lane["arah"] == "Utara")
    assert north["jumlah_kendaraan"] == 1
    assert pilot["jumlah_kendaraan"] >= 1
    assert pilot["counts"]["Utara"] == 1
    assert pilot["snapshots"]["Utara"].startswith("data:image/jpeg;base64,")


def test_vision_upload_uses_base64_when_disk_storage_fails(client, admin, monkeypatch):
    service = YoloVehicleService(model=FakeModel(), confidence=0.15)
    monkeypatch.setattr(vision, "get_yolo_service", lambda: service)
    monkeypatch.setattr(vision, "save_annotated_snapshot", lambda *args, **kwargs: None)

    ok, encoded = cv2.imencode(".jpg", np.zeros((120, 120, 3), dtype=np.uint8))
    assert ok
    response = client.post(
        "/api/vision/detect-image?lane=Utara&id_persimpangan=1",
        headers=admin,
        files={"frame": ("frame.jpg", encoded.tobytes(), "image/jpeg")},
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    body = response.json()
    assert body["fallback"] == "base64"
    assert body["annotated_image"].startswith("data:image/jpeg;base64,")

    dashboard = client.get("/api/monitoring/dashboard", headers=admin).json()
    pilot = next(item for item in dashboard["simpang"] if item["id_persimpangan"] == 1)
    assert pilot["snapshots"]["Utara"].startswith("data:image/jpeg;base64,")


def test_vision_upload_model_load_failure_returns_informative_error(client, admin, monkeypatch):
    monkeypatch.setattr(
        vision,
        "get_yolo_service",
        lambda: (_ for _ in ()).throw(
            RuntimeError(
                "Model YOLOv8 gagal dimuat dari 'yolov8n.pt'. "
                "Pastikan ultralytics terpasang dan bobot tersedia."
            )
        ),
    )

    ok, encoded = cv2.imencode(".jpg", np.zeros((120, 120, 3), dtype=np.uint8))
    assert ok
    response = client.post(
        "/api/vision/detect-image?lane=Utara&id_persimpangan=1",
        headers=admin,
        files={"frame": ("frame.jpg", encoded.tobytes(), "image/jpeg")},
    )

    assert response.status_code == 503
    assert "Model YOLOv8 gagal dimuat" in response.json()["detail"]


def test_detect_video_returns_annotated_video_url(client, admin, monkeypatch, tmp_path):
    service = YoloVehicleService(model=FakeModel(), confidence=0.15)
    monkeypatch.setattr(vision, "get_yolo_service", lambda: service)

    source_video = tmp_path / "traffic.mp4"
    writer = cv2.VideoWriter(
        str(source_video),
        cv2.VideoWriter_fourcc(*"mp4v"),
        10,
        (120, 120),
    )
    assert writer.isOpened()
    for _ in range(6):
        writer.write(np.zeros((120, 120, 3), dtype=np.uint8))
    writer.release()
    video_bytes = source_video.read_bytes()

    response = client.post(
        "/api/vision/detect-video?lane=Utara&id_persimpangan=1",
        headers=admin,
        files={"video": ("traffic.mp4", video_bytes, "video/mp4")},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["peak"] >= 1
    assert body["counts"]["Utara"] == body["peak"]
    assert body["video_url"].startswith("/static/uploads/")
    assert body["frames_processed"] == 6


def test_yolo_model_load_failure_is_informative(monkeypatch):
    fake_ultralytics = ModuleType("ultralytics")

    class BrokenYOLO:
        def __init__(self, weights):
            raise FileNotFoundError("bobot tidak ditemukan")

    fake_ultralytics.YOLO = BrokenYOLO
    monkeypatch.setitem(sys.modules, "ultralytics", fake_ultralytics)

    try:
        yolo_service.load_model("yolov8n.pt")
    except RuntimeError as error:
        assert "Model YOLOv8 gagal dimuat" in str(error)
        assert "yolov8n.pt" in str(error)
    else:
        raise AssertionError("Model YOLO yang gagal dimuat harus memunculkan RuntimeError")

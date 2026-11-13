"""Integrasi endpoint vision dengan persistensi Deteksi dan siklus LIF."""
from types import SimpleNamespace

import cv2
import numpy as np

from app.routers import vision
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
    assert pilot["snapshots"]["Utara"].startswith("data:image/jpeg;base64,")

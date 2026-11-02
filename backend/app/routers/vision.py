"""API deteksi kendaraan berbasis frame kamera dan YOLOv8."""
from __future__ import annotations

import base64
from functools import lru_cache

import numpy as np
from fastapi import (
    APIRouter,
    File,
    Form,
    HTTPException,
    Response,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)

from app.services.yolo_service import LANE_NAMES, YoloVehicleService


router = APIRouter(prefix="/api/vision", tags=["Computer Vision"])


@lru_cache(maxsize=1)
def get_yolo_service() -> YoloVehicleService:
    """Create the detector only when the first frame is received."""
    return YoloVehicleService(confidence=0.15)


def decode_frame(data: bytes) -> np.ndarray:
    """Decode an uploaded image into a BGR OpenCV frame."""
    if not data:
        raise HTTPException(status_code=400, detail="Frame kosong.")
    try:
        import cv2
    except ImportError as error:  # pragma: no cover - depends on environment
        raise HTTPException(
            status_code=503,
            detail="Pemrosesan frame membutuhkan paket 'opencv-python-headless'.",
        ) from error
    frame = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=415, detail="Frame bukan gambar yang valid.")
    return frame


def validate_lane(lane: str) -> str:
    """Validate and return a configured intersection lane name."""
    if lane not in LANE_NAMES:
        allowed_lanes = ", ".join(LANE_NAMES)
        raise HTTPException(
            status_code=400,
            detail=f"Lajur tidak dikenal: {lane}. Gunakan: {allowed_lanes}.",
        )
    return lane


@router.post("/detect")
async def detect_frame(
    frame: UploadFile = File(...),
    lane: str | None = Form(None),
):
    """Detect vehicles from one uploaded JPEG/PNG frame."""
    if frame.content_type and not frame.content_type.startswith("image/"):
        raise HTTPException(status_code=415, detail="Gunakan content-type gambar.")
    try:
        if lane is None:
            service = get_yolo_service()
        else:
            selected_lane = validate_lane(lane)

            def custom_lane_mapper(
                center_x: float,
                center_y: float,
                width: int,
                height: int,
            ) -> str:
                return selected_lane

            base_service = get_yolo_service()
            service = YoloVehicleService(
                model=base_service.model,
                confidence=base_service.confidence,
                lane_mapper=custom_lane_mapper,
            )
        result = service.detect(decode_frame(await frame.read()))
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    return result


@router.post("/detect-image", response_class=Response)
async def detect_image(
    frame: UploadFile = File(...),
    lane: str | None = Form(None),
):
    """Detect vehicles and return the uploaded frame with annotated boxes."""
    if frame.content_type and not frame.content_type.startswith("image/"):
        raise HTTPException(status_code=415, detail="Gunakan content-type gambar.")

    try:
        if lane is None:
            service = get_yolo_service()
        else:
            selected_lane = validate_lane(lane)

            def custom_lane_mapper(
                center_x: float,
                center_y: float,
                width: int,
                height: int,
            ) -> str:
                return selected_lane

            base_service = get_yolo_service()
            service = YoloVehicleService(
                model=base_service.model,
                confidence=base_service.confidence,
                lane_mapper=custom_lane_mapper,
            )

        frame_array = decode_frame(await frame.read())
        result = service.detect(frame_array)
        annotated_frame = service.draw_detections(frame_array, result)

        import cv2

        encoded, encoded_image = cv2.imencode(".jpg", annotated_frame)
        if not encoded:
            raise HTTPException(
                status_code=500,
                detail="Gambar hasil deteksi gagal dikodekan.",
            )
    except ImportError as error:  # pragma: no cover - depends on environment
        raise HTTPException(
            status_code=503,
            detail="Pemrosesan gambar membutuhkan paket 'opencv-python-headless'.",
        ) from error
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    return Response(content=encoded_image.tobytes(), media_type="image/jpeg")


@router.post("/detect-intersection")
async def detect_intersection(
    frame_utara: UploadFile | None = File(None),
    frame_selatan: UploadFile | None = File(None),
    frame_timur: UploadFile | None = File(None),
    frame_barat: UploadFile | None = File(None),
):
    """Detect and aggregate vehicles from multiple intersection cameras."""
    frames_by_lane: dict[str, UploadFile | None] = {
        "Utara": frame_utara,
        "Selatan": frame_selatan,
        "Timur": frame_timur,
        "Barat": frame_barat,
    }
    if not any(frames_by_lane.values()):
        raise HTTPException(status_code=400, detail="Minimal satu frame diperlukan.")

    base_service = get_yolo_service()
    counts = {lane: 0 for lane in LANE_NAMES}
    detections = []
    visualizations: dict[str, str] = {}

    try:
        import cv2

        for selected_lane, frame_upload in frames_by_lane.items():
            if frame_upload is None:
                continue
            if (
                frame_upload.content_type
                and not frame_upload.content_type.startswith("image/")
            ):
                raise HTTPException(
                    status_code=415,
                    detail=f"Gunakan content-type gambar untuk {frame_upload.filename}.",
                )

            def custom_lane_mapper(
                center_x: float,
                center_y: float,
                width: int,
                height: int,
                lane: str = selected_lane,
            ) -> str:
                return lane

            service = YoloVehicleService(
                model=base_service.model,
                confidence=base_service.confidence,
                lane_mapper=custom_lane_mapper,
            )
            frame = decode_frame(await frame_upload.read())
            result = service.detect(frame)
            annotated_frame = service.draw_detections(frame, result)
            encoded, encoded_image = cv2.imencode(".jpg", annotated_frame)
            if not encoded:
                raise HTTPException(
                    status_code=500,
                    detail=f"Gambar hasil deteksi gagal dikodekan untuk lajur {selected_lane}.",
                )

            counts[selected_lane] += result["total"]
            detections.extend(result["detections"])
            encoded_image_base64 = base64.b64encode(
                encoded_image.tobytes()
            ).decode("ascii")
            visualizations[selected_lane] = (
                f"data:image/jpeg;base64,{encoded_image_base64}"
            )
    except ImportError as error:  # pragma: no cover - depends on environment
        raise HTTPException(
            status_code=503,
            detail="Visualisasi gambar membutuhkan paket 'opencv-python-headless'.",
        ) from error
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    return {
        "total": sum(counts.values()),
        "counts": counts,
        "detections": detections,
        "visualizations": visualizations,
    }


@router.websocket("/stream")
async def stream_frames(websocket: WebSocket):
    """Process binary image frames sent repeatedly over a WebSocket."""
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_bytes()
            try:
                result = get_yolo_service().detect(decode_frame(data))
            except HTTPException as error:
                await websocket.send_json({"error": error.detail})
                continue
            except RuntimeError as error:
                await websocket.send_json({"error": str(error)})
                await websocket.close(code=1011)
                return
            await websocket.send_json(result)
    except WebSocketDisconnect:
        return
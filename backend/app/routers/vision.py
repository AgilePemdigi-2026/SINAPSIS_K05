"""API deteksi kendaraan berbasis frame kamera dan YOLOv8."""
from __future__ import annotations

from functools import lru_cache

import numpy as np
from fastapi import APIRouter, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect

from app.services.yolo_service import YoloVehicleService


router = APIRouter(prefix="/api/vision", tags=["Computer Vision"])


@lru_cache(maxsize=1)
def get_yolo_service() -> YoloVehicleService:
    """Create the detector only when the first frame is received."""
    return YoloVehicleService()


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


@router.post("/detect")
async def detect_frame(frame: UploadFile = File(...)):
    """Detect vehicles from one uploaded JPEG/PNG frame."""
    if frame.content_type and not frame.content_type.startswith("image/"):
        raise HTTPException(status_code=415, detail="Gunakan content-type gambar.")
    try:
        result = get_yolo_service().detect(decode_frame(await frame.read()))
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    return result


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
"""API deteksi kendaraan berbasis frame kamera dan YOLOv8."""
from __future__ import annotations

import base64
import logging
from functools import lru_cache

import numpy as np
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models import Persimpangan
from app.services import monitoring_service as monitoring

from app.services.yolo_service import (
    LANE_NAMES,
    YoloVehicleService,
    process_annotated_video,
    save_annotated_snapshot,
)


router = APIRouter(prefix="/api/vision", tags=["Computer Vision"])
logger = logging.getLogger(__name__)


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
    id_persimpangan: int | None = Form(None),
    db: Session = Depends(get_db),
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
                fixed_lane=selected_lane,
            )
        frame_array = decode_frame(await frame.read())
        result = service.detect(frame_array)
        cycle = None
        if id_persimpangan is not None:
            if lane is None:
                raise HTTPException(status_code=400, detail="lane wajib diisi saat menyimpan deteksi.")
            intersection = db.get(Persimpangan, id_persimpangan)
            if intersection is None:
                raise HTTPException(status_code=404, detail="Persimpangan tidak ditemukan.")
            cycle = monitoring.record_vision_detection(
                db,
                intersection,
                lane,
                result["total"],
                detection_result=result,
            )

        try:
            import cv2
            encoded, annotated = cv2.imencode(".jpg", service.draw_detections(frame_array, result))
            if encoded:
                result["annotated_image"] = "data:image/jpeg;base64," + base64.b64encode(annotated.tobytes()).decode("ascii")
        except ImportError:  # pragma: no cover - optional vision dependency
            pass
        if cycle is not None:
            result["ai_cycle"] = cycle
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(
            status_code=422,
            detail=f"Data frame vision tidak valid: {error}",
        ) from error
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Inferensi YOLOv8 / pemrosesan frame gagal")
        raise HTTPException(
            status_code=500,
            detail="Gagal memproses frame pada server. Silakan coba lagi.",
        ) from error
    return result


@router.post("/detect-image")
async def detect_image(
    frame: UploadFile = File(...),
    lane: str | None = Query(None),
    id_persimpangan: int | None = Query(None),
    db: Session = Depends(get_db),
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
                fixed_lane=selected_lane,
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
        image_bytes = encoded_image.tobytes()
        data_url = "data:image/jpeg;base64," + base64.b64encode(image_bytes).decode("ascii")
        snapshot_reference = save_annotated_snapshot(
            image_bytes,
            lane=lane,
            intersection_id=id_persimpangan,
        )
        if id_persimpangan is not None:
            if lane is None:
                raise HTTPException(status_code=400, detail="lane wajib diisi saat menyimpan snapshot.")
            intersection = db.get(Persimpangan, id_persimpangan)
            if intersection is None:
                raise HTTPException(status_code=404, detail="Persimpangan tidak ditemukan.")
            monitoring.record_vision_detection(
                db,
                intersection,
                lane,
                result["total"],
                detection_result=result,
            )
            selected_lane = next((item for item in intersection.jalur if item.arah == lane), None)
            if selected_lane is None:
                raise HTTPException(status_code=400, detail="Lajur tidak ditemukan pada persimpangan.")
            # Pertahankan preview Base64 di database agar preview tetap tersedia
            # meskipun URL disk tidak dapat dilayani atau file dibersihkan server.
            selected_lane.vision_preview = data_url
            db.commit()
    except HTTPException:
        raise
    except ImportError as error:  # pragma: no cover - depends on environment
        raise HTTPException(
            status_code=503,
            detail="Pemrosesan gambar membutuhkan paket 'opencv-python-headless'.",
        ) from error
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(
            status_code=422,
            detail=f"Data frame vision tidak valid: {error}",
        ) from error
    except Exception as error:
        logger.exception("Inferensi YOLOv8 / pemrosesan gambar gagal")
        raise HTTPException(
            status_code=500,
            detail="Gagal memproses gambar pada server. Silakan coba lagi.",
        ) from error

    if snapshot_reference is None:
        return {
            "fallback": "base64",
            "annotated_image": data_url,
            "detail": "Penyimpanan disk tidak tersedia; preview dikirim sebagai Base64.",
        }
    return Response(content=image_bytes, media_type="image/jpeg")


@router.post("/detect-video")
async def detect_video(
    video: UploadFile = File(...),
    lane: str | None = Query(None),
    id_persimpangan: int | None = Query(None),
    db: Session = Depends(get_db),
):
    """Deteksi kendaraan pada file MP4/AVI/MOV per lajur menggunakan frame sampling."""
    if lane is None:
        raise HTTPException(status_code=400, detail="lane wajib diisi untuk pemrosesan video.")
    selected_lane = validate_lane(lane)

    allowed_extensions = {".mp4", ".avi", ".mov", ".m4v"}
    filename = video.filename or ""
    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if (
        video.content_type
        and not video.content_type.startswith("video/")
        and f".{suffix}" not in allowed_extensions
    ):
        raise HTTPException(
            status_code=415,
            detail="Gunakan file video dengan format MP4, AVI, atau MOV.",
        )
    if f".{suffix}" not in allowed_extensions:
        raise HTTPException(
            status_code=415,
            detail="Format video harus MP4, AVI, atau MOV.",
        )

    try:
        base_service = get_yolo_service()

        def custom_lane_mapper(
            center_x: float,
            center_y: float,
            width: int,
            height: int,
        ) -> str:
            return selected_lane

        service = YoloVehicleService(
            model=base_service.model,
            confidence=base_service.confidence,
            lane_mapper=custom_lane_mapper,
            fixed_lane=selected_lane,
        )
        video_bytes = await video.read()
        result = process_annotated_video(
            video_bytes,
            filename,
            service,
            selected_lane,
            intersection_id=id_persimpangan,
        )

        counts = {
            lane_name: result["counts"].get(lane_name, 0)
            for lane_name in LANE_NAMES
        }

        if id_persimpangan is not None:
            intersection = db.get(Persimpangan, id_persimpangan)
            if intersection is None:
                raise HTTPException(
                    status_code=404,
                    detail="Persimpangan tidak ditemukan.",
                )
            monitoring.record_vision_detection(
                db,
                intersection,
                selected_lane,
                result["peak"],
                detection_result={
                    "total": result["total"],
                    "counts": result["counts"],
                    "detections": result["detections"],
                },
            )
            selected_lane_row = next(
                (
                    item
                    for item in intersection.jalur
                    if item.arah == selected_lane
                ),
                None,
            )
            if selected_lane_row is None:
                raise HTTPException(
                    status_code=400,
                    detail="Lajur tidak ditemukan pada persimpangan.",
                )
            selected_lane_row.vision_preview = result["video_url"]
            db.commit()
    except HTTPException:
        raise
    except ImportError as error:
        raise HTTPException(
            status_code=503,
            detail="Pemrosesan video membutuhkan OpenCV.",
        ) from error
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(
            status_code=422,
            detail=f"File video tidak valid: {error}",
        ) from error
    except Exception as error:
        logger.exception("Pemrosesan video vision gagal")
        raise HTTPException(
            status_code=500,
            detail="Gagal memproses video pada server.",
        ) from error

    return {
        "total": result["peak"],
        "counts": counts,
        "average": result["average"],
        "peak": result["peak"],
        "frames_processed": result["frames_processed"],
        "sampled_frames": result["sampled_frames"],
        "video_url": result["video_url"],
        "video_path": result["video_path"],
        "fallback": result["fallback"],
        "detections": result["detections"],
    }


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

    counts = {lane: 0 for lane in LANE_NAMES}
    detections = []
    visualizations: dict[str, str] = {}

    try:
        import cv2

        base_service = get_yolo_service()
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
                fixed_lane=selected_lane,
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

            lane_detections = [
                detection
                for detection in result["detections"]
                if detection["lane"] == selected_lane
            ]
            counts[selected_lane] = len(lane_detections)
            detections.extend(lane_detections)
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
    except ValueError as error:
        raise HTTPException(
            status_code=422,
            detail=f"Data frame vision tidak valid: {error}",
        ) from error
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("Inferensi YOLOv8 / pemrosesan multi-lajur gagal")
        raise HTTPException(
            status_code=500,
            detail="Gagal memproses gambar persimpangan pada server.",
        ) from error

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
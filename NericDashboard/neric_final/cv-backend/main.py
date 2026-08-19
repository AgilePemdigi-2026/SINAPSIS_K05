"""
NERIC CV Backend — FastAPI + YOLOv8 + WebSocket
================================================
Upgrade v3:
  • LIF membrane potential per lane di-emit bersama detection payload
    → BrainActivity chart menerima data real YOLO bukan hanya simulator
  • Ambulance spawner endpoint: POST /api/cv/spawn_ambulance
  • Green wave preemption notif: saat job dimulai, broadcast node path
  • CANVAS_W / CANVAS_H sudah sinkron dengan frontend constants.js

Endpoints:
  POST /api/cv/upload          — Upload video untuk diproses YOLOv8
  POST /api/cv/spawn_ambulance — Trigger ambulance ke node tertentu
  WS   /ws/cv                  — Stream deteksi + LIF potential real-time
  GET  /api/cv/status          — Status server & model
  POST /api/cv/stop            — Stop proses video aktif
  GET  /api/health             — Health probe

Jalankan:
  pip install -r requirements.txt
  uvicorn main:app --host 0.0.0.0 --port 8001 --reload
"""

import asyncio
import json
import math
import os
import random
import shutil
import tempfile
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

try:
    from ultralytics import YOLO
    YOLO_AVAILABLE = True
except ImportError:
    YOLO_AVAILABLE = False
    YOLO = None

# ════════════════════════════════════════════════════════════════
# CONFIG
# ════════════════════════════════════════════════════════════════
MODEL_PATH              = Path(__file__).parent / "best.pt"
CONF_THRESHOLD          = 0.35
IOU_THRESHOLD           = 0.45
PROCESS_EVERY_N_FRAMES  = 5
MAX_VEHICLES_PER_LANE   = 30
BROADCAST_EVERY_N       = 6      # broadcast setiap N processed frames
SPAWN_SCALE             = 3
LANES                   = ["N", "E", "S", "W"]

VEHICLE_CLASSES = {
    "car", "truck", "bus", "motorcycle", "bicycle",
    "vehicle", "mobil", "motor", "truk",
}

# LIF config (mirror dari frontend constants.js)
LIF_DECAY     = 0.92
LIF_THRESHOLD = 1.0
LIF_NOISE     = 0.015
LIF_REFRACTORY = 8

# ════════════════════════════════════════════════════════════════
# GLOBAL STATE
# ════════════════════════════════════════════════════════════════
model: Optional[object] = None
active_job: Optional[dict] = None
connected_clients: list[WebSocket] = []

# LIF neurons state per lane (server-side LIF yang diupdate oleh YOLO count)
lif_state = {
    lane: {
        "potential":   0.15 + random.random() * 0.2,
        "refractory":  0,
        "spiked":      False,
    }
    for lane in LANES
}


# ════════════════════════════════════════════════════════════════
# LIF NEURON UPDATE
# ════════════════════════════════════════════════════════════════
def step_lif(lane: str, vehicle_count: int) -> dict:
    """
    Update LIF neuron untuk satu lane berdasarkan vehicle count.
    Returns { potential, spiked, refractory }
    """
    st = lif_state[lane]

    if st["refractory"] > 0:
        st["refractory"] -= 1
        st["potential"] = max(0.0, st["potential"] * 0.85)
        st["spiked"]    = False
        return dict(st)

    # Input current dari jumlah kendaraan
    input_current = vehicle_count * 0.012  # scale ke range 0-0.4
    noise         = (random.random() - 0.5) * LIF_NOISE * 2

    st["potential"] = st["potential"] * LIF_DECAY + input_current + noise
    st["potential"] = max(0.0, min(1.4, st["potential"]))
    st["spiked"]    = False

    if st["potential"] >= LIF_THRESHOLD:
        st["spiked"]      = True
        st["potential"]   = 0.1
        st["refractory"]  = LIF_REFRACTORY

    return {
        "potential":  round(st["potential"], 4),
        "spiked":     st["spiked"],
        "refractory": st["refractory"],
    }


# ════════════════════════════════════════════════════════════════
# LIFESPAN
# ════════════════════════════════════════════════════════════════
@asynccontextmanager
async def lifespan(app: FastAPI):
    global model
    print("[CV Backend] Starting up...")
    if not YOLO_AVAILABLE:
        print("[CV Backend] ultralytics not installed — MOCK mode")
    elif MODEL_PATH.exists():
        print(f"[CV Backend] Loading YOLOv8: {MODEL_PATH}")
        model = YOLO(str(MODEL_PATH))
        dummy = np.zeros((640, 640, 3), dtype=np.uint8)
        model.predict(dummy, verbose=False)
        print("[CV Backend] Model ready ✓")
    else:
        print(f"[CV Backend] best.pt not found → MOCK mode")
    yield
    print("[CV Backend] Shutdown")


app = FastAPI(
    title="NERIC CV Backend",
    description="YOLOv8 + LIF integration for NERIC v3",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ════════════════════════════════════════════════════════════════
# HELPERS
# ════════════════════════════════════════════════════════════════
def count_vehicles(frame: np.ndarray) -> int:
    if model is None:
        return int(np.random.poisson(8))   # MOCK
    results = model.predict(frame, conf=CONF_THRESHOLD, iou=IOU_THRESHOLD, verbose=False, device="cpu")
    count = 0
    for result in results:
        for cls_id in result.boxes.cls.tolist():
            name = model.names[int(cls_id)].lower()
            if any(v in name for v in VEHICLE_CLASSES):
                count += 1
    return count


def distribute_to_lanes(total: int, primary_lane: str) -> dict:
    primary = int(total * 0.68)
    remainder = total - primary
    others = [l for l in LANES if l != primary_lane]
    result = {l: 0 for l in LANES}
    result[primary_lane] = primary
    base = remainder // len(others)
    for i, l in enumerate(others):
        if i < len(others) - 1:
            result[l] = max(0, min(base + random.randint(-2, 3), MAX_VEHICLES_PER_LANE))
        else:
            used = sum(result[ll] for ll in others if ll != l)
            result[l] = max(0, min(remainder - used, MAX_VEHICLES_PER_LANE))
    return {l: min(v, MAX_VEHICLES_PER_LANE) for l, v in result.items()}


async def broadcast(payload: dict):
    if not connected_clients:
        return
    msg  = json.dumps(payload)
    dead = []
    for ws in connected_clients:
        try:
            await ws.send_text(msg)
        except Exception:
            dead.append(ws)
    for ws in dead:
        connected_clients.remove(ws)


# ════════════════════════════════════════════════════════════════
# WEBSOCKET
# ════════════════════════════════════════════════════════════════
@app.websocket("/ws/cv")
async def ws_cv(websocket: WebSocket):
    await websocket.accept()
    connected_clients.append(websocket)
    print(f"[WS] Client connected ({len(connected_clients)} total)")

    await websocket.send_text(json.dumps({
        "type": "connected",
        "model_loaded": model is not None,
        "mock_mode": model is None,
        "timestamp": time.time(),
    }))

    try:
        while True:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                msg = json.loads(raw)
                if msg.get("type") == "ping":
                    await websocket.send_text(json.dumps({"type": "pong"}))
            except asyncio.TimeoutError:
                await websocket.send_text(json.dumps({"type": "heartbeat"}))
    except WebSocketDisconnect:
        pass
    finally:
        if websocket in connected_clients:
            connected_clients.remove(websocket)


# ════════════════════════════════════════════════════════════════
# REST ENDPOINTS
# ════════════════════════════════════════════════════════════════
@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "model_loaded": model is not None,
        "mock_mode": model is None,
        "clients": len(connected_clients),
    }


@app.get("/api/cv/status")
async def get_status():
    return {
        "status": "online",
        "model_loaded": model is not None,
        "model_path": str(MODEL_PATH),
        "active_job": active_job["id"] if active_job else None,
        "connected_clients": len(connected_clients),
        "mock_mode": model is None,
        "lif_state": lif_state,
    }


@app.post("/api/cv/upload")
async def upload_video(
    file: UploadFile = File(...),
    lane: str = Form(default="S"),
    node_id: str = Form(default="INT_A"),
):
    """
    Upload video → YOLOv8 frame processing → broadcast via WS.

    Payload yang di-broadcast per detection event:
    {
      type: 'detection',
      job_id, node_id, lane,
      frame, total_frames, progress,
      vehicle_count,                 # total smoothed
      lane_counts: {N,E,S,W},        # scaled for spawning
      raw_lane_counts: {N,E,S,W},    # raw counts
      lif: {                         # ← NEW: LIF neuron data per lane
        N: { potential, spiked, refractory },
        ...
      },
      timestamp
    }
    """
    global active_job

    job_id  = str(uuid.uuid4())[:8]
    suffix  = Path(file.filename).suffix or ".mp4"
    tmp_dir = Path(tempfile.mkdtemp())
    tmp_path = tmp_dir / f"neric_{job_id}{suffix}"

    with open(tmp_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    size_mb = tmp_path.stat().st_size / 1024 / 1024
    print(f"[CV] Job {job_id}: {file.filename} ({size_mb:.1f}MB) node={node_id} lane={lane}")

    await broadcast({
        "type": "job_start",
        "job_id": job_id,
        "node_id": node_id,
        "lane": lane,
        "filename": file.filename,
        "timestamp": time.time(),
    })

    active_job = {"id": job_id, "node_id": node_id, "lane": lane}
    asyncio.create_task(_process_video(tmp_path, job_id, lane, node_id))

    return JSONResponse({
        "job_id": job_id,
        "message": f"Processing started — node {node_id}, lane {lane}",
        "websocket_url": "ws://localhost:8001/ws/cv",
    })


@app.post("/api/cv/spawn_ambulance")
async def spawn_ambulance(
    origin_node: str = Form(default="INT_C"),
    dest_node:   str = Form(default="ENTRY_HOSPITAL"),
    lane:        str = Form(default="W"),
):
    """
    Trigger ambulance event — broadcast green wave preemption path.
    Frontend CityGrid/MicroSimulationBoard receives this and spawns ambulance.
    """
    # Simplified path: INT_C → INT_B → INT_A → ENTRY_HOSPITAL
    route_nodes = {
        "INT_C→HOSP": ["INT_C", "INT_B", "INT_A", "ENTRY_HOSPITAL"],
        "INT_B→HOSP": ["INT_B", "INT_A", "ENTRY_HOSPITAL"],
        "INT_A→HOSP": ["INT_A", "ENTRY_HOSPITAL"],
    }
    path = route_nodes.get(f"{origin_node}→HOSP", ["INT_C", "INT_B", "INT_A", "ENTRY_HOSPITAL"])

    await broadcast({
        "type": "ambulance_spawn",
        "origin_node": origin_node,
        "dest_node": dest_node,
        "lane": lane,
        "route_path": path,        # node IDs to preempt
        "timestamp": time.time(),
    })
    return {"message": "Ambulance spawned", "path": path}


@app.post("/api/cv/stop")
async def stop_processing():
    global active_job
    if active_job:
        job_id     = active_job["id"]
        active_job = None
        await broadcast({"type": "job_stopped", "job_id": job_id})
        return {"message": f"Job {job_id} stopped"}
    return {"message": "No active job"}


# ════════════════════════════════════════════════════════════════
# BACKGROUND VIDEO PROCESSING
# ════════════════════════════════════════════════════════════════
async def _process_video(video_path: Path, job_id: str, lane: str, node_id: str):
    global active_job

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        await broadcast({"type": "error", "job_id": job_id, "message": "Cannot open video"})
        return

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps          = cap.get(cv2.CAP_PROP_FPS) or 25.0
    frame_idx    = 0
    proc_count   = 0
    buf          = []

    print(f"[CV] Processing {total_frames} frames @ {fps:.0f}fps")

    try:
        while True:
            if active_job is None or active_job.get("id") != job_id:
                print(f"[CV] Job {job_id} cancelled")
                break

            ret, frame = cap.read()
            if not ret:
                break

            frame_idx += 1
            if frame_idx % PROCESS_EVERY_N_FRAMES != 0:
                continue

            # Resize for speed
            h, w = frame.shape[:2]
            if w > 1280:
                scale = 1280 / w
                frame = cv2.resize(frame, (int(w * scale), int(h * scale)))

            count = count_vehicles(frame)
            buf.append(count)
            smoothed = int(sum(buf[-10:]) / len(buf[-10:]))

            lane_counts  = distribute_to_lanes(smoothed, lane)
            spawn_counts = {k: max(0, v // SPAWN_SCALE) for k, v in lane_counts.items()}
            progress     = frame_idx / max(total_frames, 1)

            # ── Update LIF neurons from real YOLO counts ──────────
            lif_snapshot = {}
            for ln in LANES:
                lif_snapshot[ln] = step_lif(ln, lane_counts[ln])

            proc_count += 1
            if proc_count % BROADCAST_EVERY_N == 0:
                await broadcast({
                    "type":           "detection",
                    "job_id":         job_id,
                    "node_id":        node_id,
                    "lane":           lane,
                    "frame":          frame_idx,
                    "total_frames":   total_frames,
                    "progress":       round(progress, 3),
                    "vehicle_count":  smoothed,
                    "lane_counts":    spawn_counts,
                    "raw_lane_counts": lane_counts,
                    "lif":            lif_snapshot,   # ← LIF data untuk BrainActivity
                    "timestamp":      time.time(),
                })

            await asyncio.sleep(1.0 / (fps / PROCESS_EVERY_N_FRAMES))

    except Exception as e:
        print(f"[CV] Error: {e}")
        await broadcast({"type": "error", "job_id": job_id, "message": str(e)})
    finally:
        cap.release()
        try:
            video_path.unlink(missing_ok=True)
            video_path.parent.rmdir()
        except Exception:
            pass

        if active_job and active_job.get("id") == job_id:
            active_job = None

        await broadcast({
            "type": "job_complete",
            "job_id": job_id,
            "node_id": node_id,
            "total_frames_processed": frame_idx,
            "timestamp": time.time(),
        })
        print(f"[CV] Job {job_id} complete — {frame_idx} frames")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)

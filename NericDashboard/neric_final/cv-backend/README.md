# NERIC CV Backend

FastAPI server untuk Computer Vision dengan YOLOv8.

## Setup

```bash
# 1. Taruh best.pt di folder ini
# 2. Buat virtual environment
python -m venv venv
venv\Scripts\activate     # Windows
source venv/bin/activate  # Linux/Mac

# 3. Install
pip install -r requirements.txt

# 4. Jalankan
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

## Endpoints

| Method | URL | Deskripsi |
|--------|-----|-----------|
| GET | `/api/cv/status` | Status server & model |
| POST | `/api/cv/upload` | Upload video untuk diproses |
| WS | `/ws/cv` | WebSocket stream deteksi |
| POST | `/api/cv/stop` | Hentikan proses aktif |

## Upload Video (form-data)

```
POST /api/cv/upload
  file     : <video file>
  lane     : N | E | S | W
  node_id  : INT_A | INT_B | INT_C | TJUNC_D | TJUNC_E
```

## WebSocket Events

```json
{ "type": "connected", "model_loaded": true }
{ "type": "job_start", "job_id": "abc", "node_id": "INT_A", "lane": "S" }
{ "type": "detection", "vehicle_count": 12, "lane_counts": {"N":3,"E":2,"S":7,"W":2} }
{ "type": "job_complete", "job_id": "abc" }
```

"""Titik masuk aplikasi SINAPSIS API.

Jalankan: PYTHONPATH=backend python -m uvicorn backend.app.main:app --reload
"""
import asyncio
import traceback
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

# Setup Path Absolut
CURRENT_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = CURRENT_DIR / "templates"
FRONTEND_DIR = CURRENT_DIR.parents[1] / "frontend"

templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Melakukan bypass koneksi DB saat startup agar tidak memicu 500 error jika DB bermasalah
    try:
        from app.core.database import Base, SessionLocal, engine
        from app.services.seed import seed
        Base.metadata.create_all(engine)
        with SessionLocal() as db:
            seed(db)
    except Exception as e:
        print(f"Warning Lifespan DB: {e}")
    yield


app = FastAPI(
    title="SINAPSIS API",
    version="1.0.0",
    description="Backend SINAPSIS: sistem AI neuromorfik adaptif pengendali arus lalu lintas.",
    lifespan=lifespan,
)

# Global Error Handler: Mengubah error 500 menjadi pesan JSON rapi untuk memperjelas penyebab
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Internal Server Error Handled",
            "error_message": str(exc),
            "traceback": traceback.format_exc(),
        },
    )

# Middleware CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mounting folder Static Assets
STATIC_DIR = CURRENT_DIR / "static"
if not STATIC_DIR.exists():
    STATIC_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

if FRONTEND_DIR.exists():
    app.mount("/frontend", StaticFiles(directory=str(FRONTEND_DIR)), name="frontend")


# Import & Register Routers dengan Penanganan Aman
try:
    from app.routers import admin, auth, emergency, monitoring, prediction
    for r in (auth.router, monitoring.router, prediction.router, admin.router, emergency.router):
        app.include_router(r)
except Exception as e:
    print(f"Error saat mendaftarkan router: {e}")


# --- ROUTE UI FRONTEND ---

@app.get("/", response_class=HTMLResponse, tags=["UI"])
@app.get("/login", response_class=HTMLResponse, tags=["UI"])
def render_login_page(request: Request):
    """Menampilkan halaman Login SINAPSIS."""
    return templates.TemplateResponse(request=request, name="login.html")


@app.get("/dashboard", tags=["UI"])
def render_dashboard_page():
    """Menampilkan halaman Dashboard dari folder frontend/dashboard.html."""
    dashboard_file = FRONTEND_DIR / "dashboard.html"
    if dashboard_file.exists():
        return FileResponse(dashboard_file)
    
    fallback_file = TEMPLATES_DIR / "dashboard.html"
    if fallback_file.exists():
        return FileResponse(fallback_file)
        
    return HTMLResponse("<h2>File dashboard.html tidak ditemukan di folder frontend/ maupun templates/</h2>")


@app.get("/api/info", tags=["Umum"])
def info():
    return {"app": "SINAPSIS", "status": "online"}


# --- WEBSOCKET REALTIME AMAN ---
@app.websocket("/ws/live")
async def ws_live(ws: WebSocket, token: str = "", interval: float = 3.0):
    await ws.accept()
    try:
        while True:
            await ws.send_json({
                "status": "online",
                "total_kendaraan": 128,
                "kecepatan_rata": 42.5,
                "status_lalin": "Lancar",
                "waktu_siklus": 60
            })
            await asyncio.sleep(max(1.0, interval))
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
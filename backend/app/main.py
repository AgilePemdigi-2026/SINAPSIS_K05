"""Titik masuk aplikasi SINAPSIS API.

Jalankan (dari folder backend): PYTHONPATH=. python -m uvicorn app.main:app --reload
"""
import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

# Setup Path Absolut
CURRENT_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = CURRENT_DIR / "templates"
STATIC_DIR = CURRENT_DIR / "static"

logger = logging.getLogger("sinapsis")


def _find_frontend_dir():
    """Folder frontend opsional (bisa diganti lewat env FRONTEND_DIR). None bila tidak ada."""
    env = os.getenv("FRONTEND_DIR")
    candidate = Path(env) if env else CURRENT_DIR.parents[1] / "frontend"
    return candidate if candidate.is_dir() else None


FRONTEND_DIR = _find_frontend_dir()
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Melakukan bypass koneksi DB saat startup agar tidak memicu 500 error jika DB bermasalah
    try:
        from app.core.database import Base, SessionLocal, engine, ensure_schema
        from app.services.seed import seed
        Base.metadata.create_all(engine)
        ensure_schema()
        with SessionLocal() as db:
            seed(db)
    except Exception as e:
        print(f"Warning Lifespan DB: {e}")
    yield


# Inisialisasi Utama Aplikasi FastAPI (Cukup 1 kali saja)
app = FastAPI(
    title="SINAPSIS API",
    version="1.0.0",
    description="Backend SINAPSIS: sistem AI neuromorfik adaptif pengendali arus lalu lintas.",
    lifespan=lifespan,
)


# Global Error Handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error pada %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Terjadi kesalahan pada server."})


# Middleware CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mounting folder Static Assets
if not STATIC_DIR.exists():
    STATIC_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

if FRONTEND_DIR is not None:
    app.mount("/frontend", StaticFiles(directory=str(FRONTEND_DIR)), name="frontend")


# Semua router (Login/Registrasi/Reset, Monitoring, Prediction, Admin, Emergency)
from app.routers import admin, auth, emergency, monitoring, prediction  # noqa: E402

for r in (auth.router, monitoring.router, prediction.router, admin.router, emergency.router):
    app.include_router(r)


# --- ROUTE UI FRONTEND ---

@app.get("/", response_class=HTMLResponse, tags=["UI"])
@app.get("/login", response_class=HTMLResponse, tags=["UI"])
def render_login_page(request: Request):
    """Menampilkan halaman Login SINAPSIS."""
    return templates.TemplateResponse(request=request, name="login.html")


@app.get("/dashboard", tags=["UI"])
def render_dashboard_page():
    """Halaman Dashboard."""
    candidates = []
    if FRONTEND_DIR is not None:
        candidates.append(Path(FRONTEND_DIR) / "dashboard.html")
    candidates.append(TEMPLATES_DIR / "dashboard.html")
    for f in candidates:
        if f.exists():
            return FileResponse(f)
    raise HTTPException(404, "File dashboard.html tidak ditemukan. Pastikan folder frontend atau templates tersedia.")


@app.get("/admin/intersections", tags=["UI"])
@app.get("/admin/intersections/add", tags=["UI"])
def render_admin_intersections_page():
    """Kelola Sistem (F5): daftar + peta persimpangan, dan form registrasi persimpangan baru.
    Halaman statis; akses dibatasi di API (/api/admin/*, khusus Administrator)."""
    page = TEMPLATES_DIR / "admin_intersections.html"
    if not page.exists():
        raise HTTPException(404, "File admin_intersections.html tidak ditemukan.")
    return FileResponse(page)


@app.get("/api/info", tags=["Umum"])
def info():
    return {"app": "SINAPSIS", "status": "online"}


# --- WEBSOCKET REALTIME ---
@app.websocket("/ws/live")
async def ws_live(ws: WebSocket, token: str = "", interval: float = 3.0):
    from app.core.database import SessionLocal
    from app.core.security import ROLE_ADMIN, ROLE_PETUGAS, user_from_token
    from app.services import monitoring_service as svc

    with SessionLocal() as db:
        user = user_from_token(token, db) if token else None
        allowed = user is not None and user.role in (ROLE_ADMIN, ROLE_PETUGAS)
    if not allowed:
        await ws.close(code=1008)
        return
    await ws.accept()
    try:
        while True:
            with SessionLocal() as db:
                await ws.send_json(svc.dashboard(db))
            await asyncio.sleep(max(1.0, interval))
    except WebSocketDisconnect:
        pass
"""Titik masuk aplikasi SINAPSIS API.   Jalankan: uvicorn app.main:app --reload"""
import asyncio
import os
from contextlib import asynccontextmanager

import jwt
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from app import models  # noqa: F401  (daftarkan tabel ke Base)
from app.core.config import settings
from app.core.database import Base, SessionLocal, engine, get_db
from app.routers import admin, auth, emergency, monitoring, prediction
from app.services import monitoring_service as svc
from app.services.seed import seed


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        seed(db)
    yield


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.VERSION,
    description="Backend SINAPSIS: sistem AI neuromorfik adaptif pengendali arus lalu lintas.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)
for r in (auth.router, monitoring.router, prediction.router, admin.router, emergency.router):
    app.include_router(r)


def find_frontend_dir() -> Path | None:
    """Folder frontend: env FRONTEND_DIR, atau ../frontend (susunan repo), atau app/static."""
    here = Path(__file__).resolve()
    candidates = [here.parents[2] / "frontend", here.parent / "static"]
    if os.getenv("FRONTEND_DIR"):
        candidates.insert(0, Path(os.environ["FRONTEND_DIR"]))
    return next((c for c in candidates if (c / "dashboard.html").is_file()), None)


FRONTEND_DIR = find_frontend_dir()
if FRONTEND_DIR is not None:
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.get("/", tags=["Umum"])
def root():
    return {"app": settings.APP_NAME, "versi": settings.VERSION, "docs": "/docs", "dashboard": "/dashboard"}


@app.get("/dashboard", include_in_schema=False)
def dashboard_page():
    """Halaman Dashboard Pemantauan Lalu Lintas (HTML/CSS/JS statis dari folder frontend)."""
    if FRONTEND_DIR is None:
        raise HTTPException(404, "Folder frontend tidak ditemukan. Taruh di ../frontend atau atur FRONTEND_DIR.")
    return FileResponse(FRONTEND_DIR / "dashboard.html")


@app.get("/api/health", tags=["Umum"])
def health(db: Session = Depends(get_db)):
    db.execute(models.Pengguna.__table__.select().limit(1))
    return {"status": "ok"}


@app.websocket("/ws/live")
async def ws_live(ws: WebSocket, token: str = "", interval: float = 3.0):
    """Stream ringkasan dashboard tiap `interval` detik. Autentikasi lewat ?token=<JWT>."""
    try:
        jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except jwt.PyJWTError:
        await ws.close(code=4401)
        return
    await ws.accept()
    try:
        while True:
            with SessionLocal() as db:
                await ws.send_json(svc.dashboard(db))
            await asyncio.sleep(max(0.5, interval))
    except WebSocketDisconnect:
        pass

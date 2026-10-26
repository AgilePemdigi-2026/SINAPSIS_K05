"""Fitur Login (REQ-1..4): autentikasi + token berisi role."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import ROLE_ADMIN, create_access_token, get_current_user, verify_password
from app.models import Pengguna
from app.schemas import LoginRequest

router = APIRouter(prefix="/api/auth", tags=["Login"])

MENU = {
    ROLE_ADMIN: ["Pantau Kondisi Lalu Lintas", "Kelola Sistem"],
}


@router.post("/login")
def login(req: LoginRequest, db: Session = Depends(get_db)):
    username, password = (req.username or "").strip(), req.password or ""
    if not username or not password:
        raise HTTPException(400, "Login gagal. Semua field harus diisi!")
    user = db.scalar(select(Pengguna).where(Pengguna.username == username))
    if user is None:
        raise HTTPException(401, "Login gagal. Akun tidak terdaftar.")
    if not verify_password(password, user.password):
        raise HTTPException(401, "Login gagal. Username atau password Anda salah.")
    return {
        "pesan": "Login Berhasil!",
        "access_token": create_access_token(user.id_pengguna, user.role),
        "token_type": "bearer",
        "user": {"id_pengguna": user.id_pengguna, "nama": user.nama, "username": user.username, "role": user.role},
        "menu": MENU.get(user.role, ["Pantau Kondisi Lalu Lintas", "Permintaan Rute Darurat"]),
        "redirect": "/dashboard",
    }


@router.get("/me")
def me(user=Depends(get_current_user)):
    return {"id_pengguna": user.id_pengguna, "nama": user.nama, "username": user.username, "role": user.role}

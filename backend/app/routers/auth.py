"""Router Autentikasi SINAPSIS API: Login, Registrasi, Lupa & Reset Password (bcrypt + JWT + role).

Satu-satunya sistem akun: tabel `pengguna`, kunci JWT dari settings.SECRET_KEY.
"""
import hashlib
import secrets
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import (PASS_RULE, PASS_RULE_MSG, ROLE_ADMIN, ROLE_PETUGAS, USERNAME_RULE,
                               USERNAME_RULE_MSG, bearer_scheme, create_access_token, get_current_user,
                               hash_password, user_from_token, verify_password)
from app.core.timeutil import utcnow
from app.models import Pengguna
from app.schemas import ForgotPasswordRequest, LoginRequest, RegisterRequest, ResetPasswordRequest

router = APIRouter(prefix="/api/auth", tags=["Autentikasi"])

# Menu yang tampil setelah login, sesuai role (skenario BDD "User Authentication")
MENU = {
    ROLE_ADMIN: ["Pantau Kondisi Lalu Lintas", "Kelola Sistem"],
    ROLE_PETUGAS: ["Pantau Kondisi Lalu Lintas", "Permintaan Rute Darurat"],
}


def _user_info(u: Pengguna) -> dict:
    return {"id": u.id_pengguna, "username": u.username, "nama": u.nama, "role": u.role}


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
        "redirect": "/dashboard",
        "access_token": create_access_token(user.id_pengguna, user.role),
        "token_type": "bearer",
        "role": user.role,
        "user": _user_info(user),
        "menu": MENU.get(user.role, ["Pantau Kondisi Lalu Lintas"]),
    }


@router.get("/me")
def me(user: Pengguna = Depends(get_current_user)):
    return {**_user_info(user), "menu": MENU.get(user.role, ["Pantau Kondisi Lalu Lintas"])}


# ---- Registrasi ---------------------------------------------------------------
_ROLE_ALIAS = {
    "petugas": ROLE_PETUGAS, "petugas lalu lintas": ROLE_PETUGAS,
    "admin": ROLE_ADMIN, "administrator": ROLE_ADMIN,
}


def _caller(credentials: Optional[HTTPAuthorizationCredentials], db: Session) -> Optional[Pengguna]:
    """Pengguna yang memanggil (bila membawa token valid), tanpa menolak pemanggil anonim."""
    return user_from_token(credentials.credentials, db) if credentials is not None else None


@router.post("/register", status_code=201)
def register(req: RegisterRequest, credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
             db: Session = Depends(get_db)):
    """Pendaftaran akun. Siapa pun boleh mendaftar sebagai Petugas; akun Administrator hanya bisa
    dibuat oleh Administrator yang sedang login (mencegah orang asing mendaftar sebagai admin)."""
    nama = (req.full_name or req.nama or "").strip()
    username, password = (req.username or "").strip(), req.password or ""
    if not all([nama, username, password]):
        raise HTTPException(422, "Semua field wajib diisi!")
    role = _ROLE_ALIAS.get((req.role or "petugas").strip().lower())
    if role is None:
        raise HTTPException(422, f"Role harus '{ROLE_ADMIN}' atau '{ROLE_PETUGAS}'.")
    if role == ROLE_ADMIN:
        caller = _caller(credentials, db)
        if caller is None or caller.role != ROLE_ADMIN:
            raise HTTPException(403, "Akun Administrator hanya dapat dibuat oleh Administrator.")
    if not USERNAME_RULE.fullmatch(username):
        raise HTTPException(422, USERNAME_RULE_MSG)
    if not PASS_RULE.match(password):
        raise HTTPException(422, PASS_RULE_MSG)
    if db.scalar(select(Pengguna).where(Pengguna.username == username)):
        raise HTTPException(409, "Username sudah terdaftar.")
    u = Pengguna(nama=nama, username=username, password=hash_password(password), role=role)
    db.add(u)
    db.commit()
    return {"pesan": f"Akun {u.username} ({u.role}) berhasil dibuat! Silakan login.", "id_pengguna": u.id_pengguna,
            "role": u.role}


# ---- Lupa & reset password -------------------------------------------------------
def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@router.post("/forgot-password")
def forgot_password(req: ForgotPasswordRequest, db: Session = Depends(get_db)):
    """Menerbitkan token reset (berlaku RESET_TOKEN_MINUTES menit, sekali pakai).

    Jawaban sama untuk username terdaftar maupun tidak, agar daftar akun tidak bisa ditebak.
    Token hanya dikembalikan bila settings.EXPOSE_RESET_TOKEN = true (mode demo tanpa email/SMS)."""
    username = (req.username or "").strip()
    if not username:
        raise HTTPException(400, "Username wajib diisi!")
    body = {"pesan": f"Jika username terdaftar, token reset password diterbitkan (berlaku {settings.RESET_TOKEN_MINUTES} menit)."}
    user = db.scalar(select(Pengguna).where(Pengguna.username == username))
    if user is not None:
        token = secrets.token_hex(16)
        user.reset_token = _hash_token(token)
        user.reset_token_expires = utcnow() + timedelta(minutes=settings.RESET_TOKEN_MINUTES)
        db.commit()
        if settings.EXPOSE_RESET_TOKEN:
            body["reset_token"] = token
    return body


@router.post("/reset-password")
def reset_password(req: ResetPasswordRequest, db: Session = Depends(get_db)):
    token, new_password = (req.reset_token or "").strip(), req.new_password or ""
    if not token or not new_password:
        raise HTTPException(400, "Token dan password baru wajib diisi!")
    if not PASS_RULE.match(new_password):
        raise HTTPException(422, PASS_RULE_MSG)
    user = db.scalar(select(Pengguna).where(Pengguna.reset_token == _hash_token(token)))
    if user is None or user.reset_token_expires is None:
        raise HTTPException(400, "Token reset tidak valid.")
    if utcnow() > user.reset_token_expires:
        user.reset_token, user.reset_token_expires = None, None
        db.commit()
        raise HTTPException(400, f"Token reset sudah kedaluwarsa (lebih dari {settings.RESET_TOKEN_MINUTES} menit).")
    user.password = hash_password(new_password)
    user.reset_token, user.reset_token_expires = None, None  # sekali pakai
    db.commit()
    return {"pesan": "Password berhasil diperbarui! Silakan login menggunakan password baru."}

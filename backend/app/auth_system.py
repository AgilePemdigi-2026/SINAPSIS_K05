import secrets
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException, status, Depends
from pydantic import BaseModel, Field
from passlib.context import CryptContext
from sqlalchemy import Column, Integer, String, DateTime, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker, Session
# Di dalam file backend/app/auth_system.py
from fastapi import APIRouter

# Pastikan nama variabelnya persis 'router'
router = APIRouter(prefix="/api/auth", tags=["Autentikasi & Akun"])

# ==========================================
# 1. KONFIGURASI KEAMANAN & DATABASE
# ==========================================
# Menyiapkan CryptContext dengan algoritma bcrypt untuk enkripsi password
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Koneksi ke database SQLite lokal sinapsis.db
DATABASE_URL = "sqlite:///./sinapsis.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Helper untuk mengisolasi session database per-request
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ==========================================
# 2. MODEL DATABASE (SQLAlchemy)
# ==========================================
class UserModel(Base):
    """Tabel 'users' di sinapsis.db untuk menyimpan data akun & token reset"""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    full_name = Column(String, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False)  # 'admin' atau 'petugas'
    
    # Kolom khusus untuk menangani fitur Lupa Password
    reset_token = Column(String, nullable=True)
    reset_token_expires = Column(DateTime, nullable=True)

# Generate tabel secara otomatis jika belum ada
Base.metadata.create_all(bind=engine)


# ==========================================
# 3. SCHEMA VALIDASI INPUT (Pydantic)
# ==========================================
class RegisterSchema(BaseModel):
    username: str = Field(..., example="petugas_surabaya")
    password: str = Field(..., min_length=6, example="rahasia123")
    full_name: str = Field(..., example="Muhammad Rizki Fahrezi")
    role: str = Field(..., example="petugas")  # Must be 'admin' or 'petugas'

class ForgotPasswordSchema(BaseModel):
    username: str = Field(..., example="petugas_surabaya")

class ResetPasswordSchema(BaseModel):
    reset_token: str = Field(..., example="a1b2c3d4...")
    new_password: str = Field(..., min_length=6, example="passwordBaru123")


# ==========================================
# 4. ROUTER FASTAPI & ENDPOINTS
# ==========================================
router = APIRouter(prefix="/api/auth", tags=["Autentikasi & Akun"])

# --- ENDPOINT 1: REGISTRASI AKUN BARU ---
@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(payload: RegisterSchema, db: Session = Depends(get_db)):
    # Pengecekan 1: Validasi Role
    if payload.role.lower() not in ["admin", "petugas"]:
        raise HTTPException(status_code=400, detail="Role tidak valid! Harus 'admin' atau 'petugas'.")
    
    # Pengecekan 2: Cek Username Duplikat
    existing_user = db.query(UserModel).filter(UserModel.username == payload.username).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Username sudah terdaftar.")

    # Enkripsi Password Plaintext menggunakan Bcrypt
    hashed_pwd = pwd_context.hash(payload.password)

    # Simpan ke sinapsis.db
    new_user = UserModel(
        username=payload.username,
        full_name=payload.full_name,
        password_hash=hashed_pwd,
        role=payload.role.lower()
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    return {
        "status": "success",
        "message": f"Akun {new_user.username} (Role: {new_user.role}) berhasil dibuat!"
    }


# --- ENDPOINT 2: REQUEST LUPA PASSWORD (FORGOT) ---
@router.post("/forgot-password")
def forgot_password(payload: ForgotPasswordSchema, db: Session = Depends(get_db)):
    user = db.query(UserModel).filter(UserModel.username == payload.username).first()
    if not user:
        raise HTTPException(status_code=44, detail="Username tidak ditemukan.")

    # Generate token acak yang aman (32 karakter hex)
    token = secrets.token_hex(16)
    
    # Masa berlaku token diset 15 menit dari sekarang
    expires_at = datetime.utcnow() + timedelta(minutes=15)

    user.reset_token = token
    user.reset_token_expires = expires_at
    db.commit()

    return {
        "status": "success",
        "message": "Token reset password berhasil diterbitkan (Berlaku 15 menit).",
        "reset_token": token  # Pada aplikasi asli token ini dikirim via email/SMS
    }


# --- ENDPOINT 3: EKSEKUSI RESET PASSWORD BARU ---
@router.post("/reset-password")
def reset_password(payload: ResetPasswordSchema, db: Session = Depends(get_db)):
    # Cari user berdasarkan reset_token yang valid
    user = db.query(UserModel).filter(UserModel.reset_token == payload.reset_token).first()
    
    if not user:
        raise HTTPException(status_code=400, detail="Token reset tidak valid.")
    
    # Cek apakah token sudah kadaluarsa (Expired)
    if datetime.utcnow() > user.reset_token_expires:
        raise HTTPException(status_code=400, detail="Token reset sudah kadaluarsa (lebih dari 15 menit).")

    # Hash password baru dan update ke database
    user.password_hash = pwd_context.hash(payload.new_password)
    
    # Hapus token agar tidak bisa dipakai ulang (Single-Use Token)
    user.reset_token = None
    user.reset_token_expires = None
    db.commit()

    return {
        "status": "success",
        "message": "Password berhasil diperbarui! Silakan login menggunakan password baru."
    }

import jwt  # Jika belum ada, install pyjwt: pip install pyjwt
from datetime import datetime, timedelta

# Kunci rahasia & algoritma untuk membuat JWT Token
SECRET_KEY = "sinapsis_super_secret_key_change_in_production"
ALGORITHM = "HS256"

# ==========================================
# SCHEMA UNTUK LOGIN INPUT
# ==========================================
class LoginSchema(BaseModel):
    username: str = Field(..., example="ezi_admin")
    password: str = Field(..., example="password123")

# Helper untuk membuat JWT Token
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(hours=8))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


# --- ENDPOINT 4: LOGIN AKUN (FITUR 1) ---
@router.post("/login")
def login(payload: LoginSchema, db: Session = Depends(get_db)):
    # 1. Cari user berdasarkan username di database
    user = db.query(UserModel).filter(UserModel.username == payload.username).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Username atau password salah."
        )

    # 2. Verifikasi Password Hash
    if not pwd_context.verify(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Username atau password salah."
        )

    # 3. Buat JWT Access Token jika verifikasi sukses
    access_token = create_access_token(
        data={"sub": user.username, "role": user.role, "full_name": user.full_name}
    )

    return {
        "status": "success",
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "username": user.username,
            "full_name": user.full_name,
            "role": user.role
        }
    }
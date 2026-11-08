"""Keamanan: hash password (bcrypt), token JWT, dan kontrol akses berbasis role.

- `require_roles(...)`  : wajib login dengan salah satu role -> mengembalikan objek `Pengguna`.
                          Tanpa token / token salah = 401, role tidak sesuai = 403.
- `optional_roles(...)` : dipakai endpoint pemantauan. Bila `settings.DASHBOARD_PUBLIC` = true maka
                          boleh tanpa login (mengembalikan None bila tidak ada token valid); bila false
                          maka sama ketatnya dengan `require_roles`.
"""
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.models import Pengguna

ROLE_ADMIN = "Administrator"
ROLE_PETUGAS = "Petugas Lalu Lintas"

# Aturan input akun (dipakai Registrasi, Reset Password, dan Kelola Sistem)
PASS_RULE = re.compile(r"^(?=.*[A-Z])(?=.*\d).{8,}$")
USERNAME_RULE = re.compile(r"[A-Za-z0-9_.]{3,50}")
PASS_RULE_MSG = "Password minimal 8 karakter, mengandung huruf kapital dan angka."
USERNAME_RULE_MSG = "Username 3-50 karakter alfanumerik (boleh _ dan .)."

# rounds dibaca dari settings supaya tes bisa memakai nilai kecil (BCRYPT_ROUNDS=4)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=settings.BCRYPT_ROUNDS)
bearer_scheme = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


get_password_hash = hash_password  # alias agar kode lama tetap jalan


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except ValueError:  # hash rusak / bukan bcrypt
        return False


def create_access_token(user_id: int, role: str, expires_delta: Optional[timedelta] = None) -> str:
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_MINUTES))
    return jwt.encode({"sub": str(user_id), "role": role, "exp": expire},
                      settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    """Mengembalikan payload token, atau None bila tidak valid / kedaluwarsa."""
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        return None


def user_from_token(token: str, db: Session) -> Optional[Pengguna]:
    payload = decode_token(token)
    if payload is None:
        return None
    try:
        return db.get(Pengguna, int(payload.get("sub")))
    except (TypeError, ValueError):
        return None


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail,
                         headers={"WWW-Authenticate": "Bearer"})


def get_current_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
                     db: Session = Depends(get_db)) -> Pengguna:
    if credentials is None:
        raise _unauthorized("Token autentikasi tidak ditemukan. Silakan login.")
    user = user_from_token(credentials.credentials, db)
    if user is None:
        raise _unauthorized("Token tidak valid atau telah kedaluwarsa. Silakan login ulang.")
    return user


def _flatten(roles) -> set:
    out = set()
    for r in roles:
        out.update(r) if isinstance(r, (list, tuple, set)) else out.add(r)
    return out


def require_roles(*allowed_roles):
    """Contoh: require_roles(ROLE_ADMIN) atau require_roles(ROLE_ADMIN, ROLE_PETUGAS)."""
    allowed = _flatten(allowed_roles)

    def checker(user: Pengguna = Depends(get_current_user)) -> Pengguna:
        if user.role not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail="Akses ditolak. Anda tidak memiliki hak akses untuk fitur ini.")
        return user

    return checker


def optional_roles(*allowed_roles):
    """Terbuka tanpa login hanya jika settings.DASHBOARD_PUBLIC = true (dibaca saat request)."""
    allowed = _flatten(allowed_roles)
    strict = require_roles(*allowed)

    def checker(credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
                db: Session = Depends(get_db)) -> Optional[Pengguna]:
        if not settings.DASHBOARD_PUBLIC:
            return strict(get_current_user(credentials, db))
        if credentials is None:
            return None
        user = user_from_token(credentials.credentials, db)
        return user if (user is not None and user.role in allowed) else None

    return checker
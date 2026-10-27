"""Hash password (bcrypt), JWT, dan dependency hak akses berbasis role."""
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db

ROLE_ADMIN = "Administrator"
ROLE_PETUGAS = "Petugas Lalu Lintas"

_bearer = HTTPBearer(auto_error=False)


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt(rounds=settings.BCRYPT_ROUNDS)).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except ValueError:
        return False


def create_access_token(id_pengguna: int, role: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_MINUTES)
    return jwt.encode(
        {"sub": str(id_pengguna), "role": role, "exp": exp},
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM,
    )


def get_current_user(
    cred: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
):
    from app.models import Pengguna  # hindari circular import

    if cred is None:
        raise HTTPException(401, "Belum login.")
    try:
        data = jwt.decode(cred.credentials, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(401, "Token tidak valid atau kedaluwarsa.")
    user = db.get(Pengguna, int(data["sub"]))
    if user is None:
        raise HTTPException(401, "Akun tidak ditemukan.")
    return user


def require_roles(*roles: str):
    """Dependency: hanya role tertentu yang boleh mengakses endpoint."""

    def checker(user=Depends(get_current_user)):
        if user.role not in roles:
            raise HTTPException(403, "Anda tidak memiliki hak akses ke fitur ini.")
        return user

    return checker


def optional_roles(*roles: str):
    """Seperti require_roles, tetapi terbuka tanpa login bila DASHBOARD_PUBLIC=true (mode Sprint 1)."""

    def checker(cred: HTTPAuthorizationCredentials | None = Depends(_bearer), db: Session = Depends(get_db)):
        if settings.DASHBOARD_PUBLIC:
            return None
        user = get_current_user(cred, db)
        if user.role not in roles:
            raise HTTPException(403, "Anda tidak memiliki hak akses ke fitur ini.")
        return user

    return checker

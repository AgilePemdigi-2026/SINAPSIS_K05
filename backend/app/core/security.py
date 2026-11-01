from datetime import datetime, timedelta
from typing import Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from passlib.context import CryptContext

# Role Constants
ROLE_ADMIN = "Administrator"
ROLE_PETUGAS = "Petugas Lalu Lintas"

# JWT Config
SECRET_KEY = "SINAPSIS_SUPER_SECRET_KEY_DISHUB_2026"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security_scheme = HTTPBearer(auto_error=False)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

hash_password = get_password_hash

def create_access_token(user_id: int, role: str, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = {"sub": str(user_id), "role": role}
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def get_current_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_scheme)):
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token autentikasi tidak ditemukan.",
        )
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token tidak valid atau telah kadaluwarsa.",
        )

def require_roles(*allowed_roles):
    """Mendukung pemanggilan require_roles(ROLE_ADMIN) atau require_roles(ROLE_ADMIN, ROLE_PETUGAS)"""
    # Mengakomodasi jika argumen dikirim sebagai list/tuple tunggal
    roles_set = set()
    for role in allowed_roles:
        if isinstance(role, (list, tuple, set)):
            roles_set.update(role)
        else:
            roles_set.add(role)

    def role_checker(current_user: dict = Depends(get_current_user)):
        user_role = current_user.get("role")
        if user_role not in roles_set:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Akses ditolak. Anda tidak memiliki hak akses."
            )
        return current_user
    return role_checker

def optional_roles(*allowed_roles):
    """Mendukung pemanggilan optional_roles(ROLE_ADMIN, ROLE_PETUGAS)"""
    roles_set = set()
    for role in allowed_roles:
        if isinstance(role, (list, tuple, set)):
            roles_set.update(role)
        else:
            roles_set.add(role)

    def role_checker(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_scheme)):
        if not credentials:
            return None
        try:
            payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
            user_role = payload.get("role")
            if roles_set and user_role not in roles_set:
                return None
            return payload
        except JWTError:
            return None
    return role_checker
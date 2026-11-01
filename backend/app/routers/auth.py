"""Router Autentikasi SINAPSIS API."""
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

router = APIRouter(tags=["Autentikasi"])


class LoginSchema(BaseModel):
    username: str
    password: str


@router.post("/auth/login")
@router.post("/login")
def login(payload: LoginSchema):
    """Endpoint verifikasi kredensial login SINAPSIS."""
    # Verifikasi kredensial pengguna
    if payload.username == "admin" and payload.password in ["adminpassword", "admin"]:
        return {
            "access_token": "dummy-jwt-token-sinapsis-2026",
            "token_type": "bearer",
            "redirect": "/dashboard",
            "user": {
                "id": 1,
                "username": "admin",
                "nama": "Administrator SINAPSIS",
                "role": "admin",
            },
        }

    if payload.username == "petugas" and payload.password in ["petugaspassword", "petugas"]:
        return {
            "access_token": "dummy-jwt-token-sinapsis-petugas",
            "token_type": "bearer",
            "redirect": "/dashboard",
            "user": {
                "id": 2,
                "username": "petugas",
                "nama": "Petugas DISHUB",
                "role": "operator",
            },
        }

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Username atau password salah",
    )
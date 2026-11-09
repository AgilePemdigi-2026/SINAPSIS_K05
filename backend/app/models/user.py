"""Entity Pengguna (tabel `pengguna`) — PDM Tabel 6.1.

Pemilik: Ezi (Auth & User).
"""
from datetime import datetime

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Pengguna(Base):
    __tablename__ = "pengguna"

    id_pengguna: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    nama: Mapped[str] = mapped_column(String(100))
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    password: Mapped[str] = mapped_column(String(255))  # hash bcrypt
    role: Mapped[str] = mapped_column(String(30))  # "Administrator" | "Petugas Lalu Lintas"
    # Lupa password: yang disimpan hanya hash SHA-256 token (bukan token aslinya), berlaku 15 menit.
    reset_token: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reset_token_expires: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

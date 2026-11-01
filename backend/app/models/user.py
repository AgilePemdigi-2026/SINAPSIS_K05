"""Entity Pengguna (tabel `pengguna`) — PDM Tabel 6.1.

Pemilik: Ezi (Auth & User).  File ini disalin ke folder modular agar
struktur models/ konsisten; perubahan semantik tetap dikoordinasi PM.
"""
from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Pengguna(Base):
    __tablename__ = "pengguna"

    id_pengguna: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    nama: Mapped[str] = mapped_column(String(100))
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    password: Mapped[str] = mapped_column(String(255))  # hash bcrypt
    role: Mapped[str] = mapped_column(String(30))  # "Administrator" | "Petugas Lalu Lintas"


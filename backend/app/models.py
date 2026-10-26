"""Entity (tabel) SINAPSIS — mengikuti CDM/PDM pada Data Mockup & Laporan (Bab VI)."""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.core.timeutil import utcnow


class Pengguna(Base):
    __tablename__ = "pengguna"
    id_pengguna: Mapped[int] = mapped_column(Integer, primary_key=True)
    nama: Mapped[str] = mapped_column(String(100))
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    password: Mapped[str] = mapped_column(String(255))  # hash bcrypt
    role: Mapped[str] = mapped_column(String(30))


class Persimpangan(Base):
    __tablename__ = "persimpangan"
    id_persimpangan: Mapped[int] = mapped_column(Integer, primary_key=True)
    nama_lokasi: Mapped[str] = mapped_column(String(100))
    deskripsi: Mapped[str | None] = mapped_column(Text, nullable=True)
    jalur: Mapped[list["Jalur"]] = relationship(back_populates="persimpangan", cascade="all, delete-orphan")


class Jalur(Base):
    __tablename__ = "jalur"
    id_jalur: Mapped[int] = mapped_column(Integer, primary_key=True)
    id_persimpangan: Mapped[int] = mapped_column(ForeignKey("persimpangan.id_persimpangan"))
    arah: Mapped[str] = mapped_column(String(20))
    persimpangan: Mapped[Persimpangan] = relationship(back_populates="jalur")


class Deteksi(Base):
    __tablename__ = "deteksi"
    id_deteksi: Mapped[int] = mapped_column(Integer, primary_key=True)
    id_jalur: Mapped[int] = mapped_column(ForeignKey("jalur.id_jalur"), index=True)
    waktu_deteksi: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    jumlah_kendaraan: Mapped[int] = mapped_column(Integer)


class AktivitasNeuron(Base):
    __tablename__ = "aktivitasneuron"
    id_aktivitas: Mapped[int] = mapped_column(Integer, primary_key=True)
    id_jalur: Mapped[int] = mapped_column(ForeignKey("jalur.id_jalur"), index=True)
    waktu: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    membrane_potential: Mapped[float] = mapped_column(Float)
    status_spike: Mapped[bool] = mapped_column(Boolean)
    threshold: Mapped[float] = mapped_column(Float)


class KeputusanSinyal(Base):
    __tablename__ = "keputusansinyal"
    id_keputusan: Mapped[int] = mapped_column(Integer, primary_key=True)
    id_jalur: Mapped[int] = mapped_column(ForeignKey("jalur.id_jalur"), index=True)
    waktu_keputusan: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    warna_sinyal: Mapped[str] = mapped_column(String(20))
    durasi_detik: Mapped[int] = mapped_column(Integer)


class RuteDarurat(Base):
    __tablename__ = "rutedarurat"
    id_rute: Mapped[int] = mapped_column(Integer, primary_key=True)
    id_pengguna: Mapped[int] = mapped_column(ForeignKey("pengguna.id_pengguna"))
    tujuan: Mapped[str] = mapped_column(String(100))
    level_prioritas: Mapped[str] = mapped_column(String(30))
    status: Mapped[str] = mapped_column(String(20))  # Diajukan | Aktif | Dibatalkan | Selesai
    waktu_pengajuan: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    waktu_aktivasi: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    detail: Mapped[list["DetailRute"]] = relationship(
        back_populates="rute", cascade="all, delete-orphan", order_by="DetailRute.urutan"
    )


class DetailRute(Base):
    """Tabel junction N-N RuteDarurat <-> Jalur (di CDM disebut MELALUI / DETAIL_RUTE)."""

    __tablename__ = "detail_rute"
    id_rute: Mapped[int] = mapped_column(ForeignKey("rutedarurat.id_rute"), primary_key=True)
    id_jalur: Mapped[int] = mapped_column(ForeignKey("jalur.id_jalur"), primary_key=True)
    urutan: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rute: Mapped[RuteDarurat] = relationship(back_populates="detail")


class SimulasiSkenario(Base):
    __tablename__ = "simulasiskenario"
    id_simulasi: Mapped[int] = mapped_column(Integer, primary_key=True)
    id_pengguna: Mapped[int] = mapped_column(ForeignKey("pengguna.id_pengguna"))
    profil_skenario: Mapped[str] = mapped_column(String(30))
    jumlah_siklus: Mapped[int] = mapped_column(Integer)
    inject_weather_noise: Mapped[bool] = mapped_column(Boolean, default=False)
    simulasi_sensor_failure: Mapped[bool] = mapped_column(Boolean, default=False)
    waktu_mulai: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    waktu_selesai: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class KonfigurasiSistem(Base):
    __tablename__ = "konfigurasisistem"
    id_konfigurasi: Mapped[int] = mapped_column(Integer, primary_key=True)
    id_pengguna: Mapped[int] = mapped_column(ForeignKey("pengguna.id_pengguna"))
    jenis_parameter: Mapped[str] = mapped_column(String(50), index=True)
    nilai: Mapped[str] = mapped_column(String(100))
    waktu_perubahan: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

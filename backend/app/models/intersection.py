"""Entity GIS & Persimpangan — PDM Tabel 6.2, 6.3, 6.7, 6.8.

Pemilik: Ryan (GIS & Persimpangan).

Tabel:
  - persimpangan  : titik persimpangan yang dipantau kamera/sensor
  - jalur          : 4 arah per persimpangan (Utara, Selatan, Timur, Barat)
  - rutedarurat    : permintaan rute darurat dari petugas
  - detail_rute    : junction N-N antara RuteDarurat dan Jalur
  - deteksi        : telemetri deteksi kendaraan per jalur
  - aktivitasneuron: log neuron LIF per jalur
  - keputusansinyal: keputusan sinyal lampu per jalur
  - simulasiskenario: log simulasi admin
  - konfigurasisistem: parameter AI yang bisa diubah admin
"""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.core.timeutil import utcnow


# ---------------------------------------------------------------------------
# Persimpangan & Jalur
# ---------------------------------------------------------------------------
class Persimpangan(Base):
    """Tabel `persimpangan` — PDM Tabel 6.2."""

    __tablename__ = "persimpangan"

    id_persimpangan: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    nama_lokasi: Mapped[str] = mapped_column(String(100))
    deskripsi: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Atribut GIS tambahan (Wireframe Gambar 4.5)
    kode_simpang: Mapped[str | None] = mapped_column(String(30), nullable=True, unique=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    aktif_loop_virtual: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    status_sensor: Mapped[str] = mapped_column(String(30), default="ONLINE", server_default="ONLINE")

    jalur: Mapped[list["Jalur"]] = relationship(
        back_populates="persimpangan", cascade="all, delete-orphan"
    )


class Jalur(Base):
    """Tabel `jalur` — PDM Tabel 6.3.  1 persimpangan memiliki 4 arah."""

    __tablename__ = "jalur"

    id_jalur: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    id_persimpangan: Mapped[int] = mapped_column(ForeignKey("persimpangan.id_persimpangan"))
    arah: Mapped[str] = mapped_column(String(20))  # Utara | Selatan | Timur | Barat

    persimpangan: Mapped[Persimpangan] = relationship(back_populates="jalur")


# ---------------------------------------------------------------------------
# Rute Darurat & Detail (Junction N-N)
# ---------------------------------------------------------------------------
class RuteDarurat(Base):
    """Tabel `rutedarurat` — PDM Tabel 6.7."""

    __tablename__ = "rutedarurat"

    id_rute: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    id_pengguna: Mapped[int] = mapped_column(ForeignKey("pengguna.id_pengguna"))
    lokasi_awal: Mapped[str | None] = mapped_column(String(100), nullable=True)
    tujuan: Mapped[str] = mapped_column(String(100))
    level_prioritas: Mapped[str] = mapped_column(String(30))
    status: Mapped[str] = mapped_column(String(20))  # Diajukan | Aktif | Dibatalkan | Selesai
    waktu_pengajuan: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    waktu_aktivasi: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    detail: Mapped[list["DetailRute"]] = relationship(
        back_populates="rute", cascade="all, delete-orphan", order_by="DetailRute.urutan"
    )


class DetailRute(Base):
    """Tabel junction `detail_rute` (MELALUI) — PDM Tabel 6.8."""

    __tablename__ = "detail_rute"

    id_rute: Mapped[int] = mapped_column(ForeignKey("rutedarurat.id_rute"), primary_key=True)
    id_jalur: Mapped[int] = mapped_column(ForeignKey("jalur.id_jalur"), primary_key=True)
    urutan: Mapped[int | None] = mapped_column(Integer, nullable=True)

    rute: Mapped[RuteDarurat] = relationship(back_populates="detail")


# ---------------------------------------------------------------------------
# Tabel pendukung (deteksi, aktivitas neuron, keputusan sinyal, simulasi, konfigurasi)
# Disimpan di sini agar satu file entity terpusat per domain GIS.
# ---------------------------------------------------------------------------
class Deteksi(Base):
    __tablename__ = "deteksi"
    id_deteksi: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    id_jalur: Mapped[int] = mapped_column(ForeignKey("jalur.id_jalur"), index=True)
    waktu_deteksi: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    jumlah_kendaraan: Mapped[int] = mapped_column(Integer)


class AktivitasNeuron(Base):
    __tablename__ = "aktivitasneuron"
    id_aktivitas: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    id_jalur: Mapped[int] = mapped_column(ForeignKey("jalur.id_jalur"), index=True)
    waktu: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    membrane_potential: Mapped[float] = mapped_column(Float)
    status_spike: Mapped[bool] = mapped_column(Boolean)
    threshold: Mapped[float] = mapped_column(Float)


class KeputusanSinyal(Base):
    __tablename__ = "keputusansinyal"
    id_keputusan: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    id_jalur: Mapped[int] = mapped_column(ForeignKey("jalur.id_jalur"), index=True)
    waktu_keputusan: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    warna_sinyal: Mapped[str] = mapped_column(String(20))
    durasi_detik: Mapped[int] = mapped_column(Integer)


class SimulasiSkenario(Base):
    __tablename__ = "simulasiskenario"
    id_simulasi: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    id_pengguna: Mapped[int] = mapped_column(ForeignKey("pengguna.id_pengguna"))
    profil_skenario: Mapped[str] = mapped_column(String(30))
    jumlah_siklus: Mapped[int] = mapped_column(Integer)
    inject_weather_noise: Mapped[bool] = mapped_column(Boolean, default=False)
    simulasi_sensor_failure: Mapped[bool] = mapped_column(Boolean, default=False)
    waktu_mulai: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    waktu_selesai: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class KonfigurasiSistem(Base):
    __tablename__ = "konfigurasisistem"
    id_konfigurasi: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    id_pengguna: Mapped[int] = mapped_column(ForeignKey("pengguna.id_pengguna"))
    jenis_parameter: Mapped[str] = mapped_column(String(50), index=True)
    nilai: Mapped[str] = mapped_column(String(100))
    waktu_perubahan: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


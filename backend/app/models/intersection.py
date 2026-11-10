"""Entity GIS & Persimpangan — PDM Tabel 6.2 s.d. 6.10.

Pemilik: Ryan (GIS & Persimpangan) & Tim Backend SINAPSIS.

Tabel yang dikelola:
  - persimpangan      : titik persimpangan yang dipantau kamera/sensor (Tabel 6.2)
  - jalur             : arah per persimpangan (Utara, Selatan, Timur, Barat) (Tabel 6.3)
  - deteksi           : telemetri deteksi kendaraan per jalur (Tabel 6.4)
  - aktivitasneuron   : log neuron LIF per jalur (Tabel 6.5)
  - keputusansinyal   : keputusan sinyal lampu per jalur (Tabel 6.6)
  - rutedarurat       : permintaan rute darurat dari petugas (Tabel 6.7)
  - detail_rute       : junction N-N antara RuteDarurat dan Jalur (Tabel 6.8 / MELALUI)
  - simulasiskenario  : log simulasi admin (Tabel 6.9)
  - konfigurasisistem : parameter AI yang diubah admin (Tabel 6.10)
"""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, true
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.core.timeutil import utcnow


class Persimpangan(Base):
    """Tabel `persimpangan` — PDM Tabel 6.2."""

    __tablename__ = "persimpangan"

    id_persimpangan: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    nama_lokasi: Mapped[str] = mapped_column(String(100), nullable=False)
    deskripsi: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Atribut GIS
    kode_simpang: Mapped[str | None] = mapped_column(String(30), nullable=True, unique=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    detektor_virtual: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    aktif_loop_virtual: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    status_sensor: Mapped[str] = mapped_column(String(30), default="ONLINE", server_default="ONLINE")

    jalur: Mapped[list["Jalur"]] = relationship(
        back_populates="persimpangan", cascade="all, delete-orphan"
    )


class Jalur(Base):
    """Tabel `jalur` — PDM Tabel 6.3."""

    __tablename__ = "jalur"

    id_jalur: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    id_persimpangan: Mapped[int] = mapped_column(
        ForeignKey("persimpangan.id_persimpangan"), index=True
    )
    arah: Mapped[str] = mapped_column(String(20), nullable=False)  # Utara, Selatan, Timur, Barat

    persimpangan: Mapped[Persimpangan] = relationship(back_populates="jalur")


class Deteksi(Base):
    """Tabel `deteksi` — PDM Tabel 6.4 (Telemetri Computer Vision YOLOv8 per jalur)."""

    __tablename__ = "deteksi"

    id_deteksi: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    id_jalur: Mapped[int] = mapped_column(ForeignKey("jalur.id_jalur"), index=True)
    waktu_deteksi: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    jumlah_kendaraan: Mapped[int] = mapped_column(Integer, nullable=False)


class AktivitasNeuron(Base):
    """Tabel `aktivitasneuron` — PDM Tabel 6.5 (Log komputasi neuromorfik LIF per jalur)."""

    __tablename__ = "aktivitasneuron"

    id_aktivitas: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    id_jalur: Mapped[int] = mapped_column(ForeignKey("jalur.id_jalur"), index=True)
    waktu: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    membrane_potential: Mapped[float] = mapped_column(Float, nullable=False)
    status_spike: Mapped[bool] = mapped_column(Boolean, nullable=False)
    threshold: Mapped[float] = mapped_column(Float, nullable=False)


class KeputusanSinyal(Base):
    """Tabel `keputusansinyal` — PDM Tabel 6.6 (Hasil keputusan durasi & warna sinyal AI)."""

    __tablename__ = "keputusansinyal"

    id_keputusan: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    id_jalur: Mapped[int] = mapped_column(ForeignKey("jalur.id_jalur"), index=True)
    waktu_keputusan: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    warna_sinyal: Mapped[str] = mapped_column(String(20), nullable=False)
    durasi_detik: Mapped[int] = mapped_column(Integer, nullable=False)


class RuteDarurat(Base):
    """Tabel `rutedarurat` — PDM Tabel 6.7."""

    __tablename__ = "rutedarurat"

    id_rute: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    id_pengguna: Mapped[int] = mapped_column(ForeignKey("pengguna.id_pengguna"))
    lokasi_awal: Mapped[str | None] = mapped_column(String(100), nullable=True)
    tujuan: Mapped[str] = mapped_column(String(100), nullable=False)
    level_prioritas: Mapped[str] = mapped_column(String(30), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)  # Diajukan | Aktif | Dibatalkan | Selesai
    waktu_pengajuan: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    waktu_aktivasi: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    detail: Mapped[list["DetailRute"]] = relationship(
        back_populates="rute", cascade="all, delete-orphan", order_by="DetailRute.urutan"
    )


class DetailRute(Base):
    """Tabel junction N-N `detail_rute` (MELALUI) — PDM Tabel 6.8."""

    __tablename__ = "detail_rute"

    id_rute: Mapped[int] = mapped_column(ForeignKey("rutedarurat.id_rute"), primary_key=True)
    id_jalur: Mapped[int] = mapped_column(ForeignKey("jalur.id_jalur"), primary_key=True)
    urutan: Mapped[int | None] = mapped_column(Integer, nullable=True)

    rute: Mapped[RuteDarurat] = relationship(back_populates="detail")
    jalur: Mapped[Jalur] = relationship()


class SimulasiSkenario(Base):
    """Tabel `simulasiskenario` — PDM Tabel 6.9."""

    __tablename__ = "simulasiskenario"

    id_simulasi: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    id_pengguna: Mapped[int] = mapped_column(ForeignKey("pengguna.id_pengguna"))
    profil_skenario: Mapped[str] = mapped_column(String(30), nullable=False)
    jumlah_siklus: Mapped[int] = mapped_column(Integer, nullable=False)
    inject_weather_noise: Mapped[bool] = mapped_column(Boolean, default=False)
    simulasi_sensor_failure: Mapped[bool] = mapped_column(Boolean, default=False)
    waktu_mulai: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    waktu_selesai: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class KonfigurasiSistem(Base):
    """Tabel `konfigurasisistem` — PDM Tabel 6.10."""

    __tablename__ = "konfigurasisistem"

    id_konfigurasi: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    id_pengguna: Mapped[int] = mapped_column(ForeignKey("pengguna.id_pengguna"))
    jenis_parameter: Mapped[str] = mapped_column(String(50), index=True, nullable=False)
    nilai: Mapped[str] = mapped_column(String(100), nullable=False)
    waktu_perubahan: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
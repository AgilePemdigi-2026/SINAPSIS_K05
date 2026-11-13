"""Skema request/response (Pydantic).

Skema ini mendukung:
  - Login & Auth (LoginRequest, RegisterRequest, ForgotPasswordRequest, ResetPasswordRequest)
  - Kelola Sistem / Admin (IntersectionCreate, ParameterUpdate, UserCreate, SimulationRequest)
  - Monitoring (ManualCycleRequest)
  - GIS & Rute Darurat (EmergencySearch, IntersectionGISCreate)
"""
from typing import Optional
from pydantic import BaseModel


# ---- Auth -----------------------------------------------------------------
class LoginRequest(BaseModel):
    username: Optional[str] = ""
    password: Optional[str] = ""


class RegisterRequest(BaseModel):
    full_name: Optional[str] = ""   # nama dari form login.html
    nama: Optional[str] = ""        # alias, sama dengan field di Kelola Sistem
    username: Optional[str] = ""
    password: Optional[str] = ""
    role: Optional[str] = ""        # kosong = Petugas Lalu Lintas


class ForgotPasswordRequest(BaseModel):
    username: Optional[str] = ""


class ResetPasswordRequest(BaseModel):
    reset_token: Optional[str] = ""
    new_password: Optional[str] = ""


# ---- Persimpangan (Admin) -------------------------------------------------
class IntersectionCreate(BaseModel):
    nama_lokasi: Optional[str] = ""
    deskripsi: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    detektor_virtual: Optional[bool] = True
    bentuk: Optional[str] = None
    jumlah_lengan: Optional[int] = None
    lengan: Optional[list[str]] = None  # None = 4 lengan; boleh 3-4 dari Utara/Selatan/Timur/Barat
    vision_feeds: Optional[dict[str, str]] = None


# ---- Persimpangan GIS (Ryan) — extended dengan atribut GIS ----------------
class IntersectionGISCreate(BaseModel):
    """Schema untuk Tambah Persimpangan via GIS router (Gambar 4.5)."""
    nama_lokasi: Optional[str] = ""
    deskripsi: Optional[str] = None
    kode_simpang: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    aktif_loop_virtual: bool = True


# ---- Parameter AI ---------------------------------------------------------
class ParameterUpdate(BaseModel):
    jenis_parameter: str
    nilai: float


# ---- Pengguna --------------------------------------------------------------
class UserCreate(BaseModel):
    nama: Optional[str] = ""
    username: Optional[str] = ""
    password: Optional[str] = ""
    role: Optional[str] = ""


# ---- Rute Darurat -----------------------------------------------------------
class EmergencySearch(BaseModel):
    lokasi_awal: Optional[str] = ""
    tujuan: Optional[str] = ""
    level_prioritas: str = "High"


# ---- Simulasi ---------------------------------------------------------------
class SimulationRequest(BaseModel):
    profil: str = "NORMAL"
    jumlah_siklus: int = 20
    inject_weather_noise: bool = False
    simulasi_sensor_failure: bool = False
    seed: Optional[int] = None


# ---- Monitoring Manual -------------------------------------------------------
class ManualCycleRequest(BaseModel):
    id_persimpangan: int
    vehicle_counts: Optional[list[int]] = None  # None -> ambil dari sumber sensor
    simulated_hour: Optional[int] = None

"""Skema request/response (Pydantic).

Skema ini mendukung:
  - Login & Auth (LoginRequest)
  - Kelola Sistem / Admin (IntersectionCreate, ParameterUpdate, UserCreate, SimulationRequest)
  - Monitoring (ManualCycleRequest)
  - GIS & Rute Darurat (EmergencySearch, IntersectionGISCreate)
"""
from pydantic import BaseModel
from typing import Optional


# ---- Auth -----------------------------------------------------------------
class LoginRequest(BaseModel):
    username: Optional[str] = ""
    password: Optional[str] = ""


# ---- Persimpangan (Admin) -------------------------------------------------
class IntersectionCreate(BaseModel):
    nama_lokasi: Optional[str] = ""
    deskripsi: Optional[str] = None


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

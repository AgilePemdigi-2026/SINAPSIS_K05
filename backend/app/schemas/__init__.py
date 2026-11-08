"""Skema request/response (Pydantic)."""
from pydantic import BaseModel
from typing import Optional


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


class IntersectionCreate(BaseModel):
    nama_lokasi: Optional[str] = ""
    deskripsi: Optional[str] = None


class ParameterUpdate(BaseModel):
    jenis_parameter: str
    nilai: float


class UserCreate(BaseModel):
    nama: Optional[str] = ""
    username: Optional[str] = ""
    password: Optional[str] = ""
    role: Optional[str] = ""


class EmergencySearch(BaseModel):
    lokasi_awal: Optional[str] = ""
    tujuan: Optional[str] = ""
    level_prioritas: str = "High"


class SimulationRequest(BaseModel):
    profil: str = "NORMAL"
    jumlah_siklus: int = 20
    inject_weather_noise: bool = False
    simulasi_sensor_failure: bool = False
    seed: Optional[int] = None


class ManualCycleRequest(BaseModel):
    id_persimpangan: int
    vehicle_counts: Optional[list[int]] = None  # None -> ambil dari sumber sensor
    simulated_hour: Optional[int] = None

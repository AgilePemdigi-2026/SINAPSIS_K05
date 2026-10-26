"""Data awal untuk demo/pengembangan (aktif jika SEED_DEMO_DATA=true). Hanya terisi saat tabel kosong."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import ROLE_ADMIN, ROLE_PETUGAS, hash_password
from app.models import Jalur, Pengguna, Persimpangan

# Akun demo mengikuti skenario BDD pada dokumen (user story). JANGAN dipakai di produksi.
DEMO_USERS = [
    ("Admin SINAPSIS", "admin_sinapsis", "adminSecure2026", ROLE_ADMIN),
    ("Petugas Lalin 01", "petugas_lalin01", "petugasPass123", ROLE_PETUGAS),
]
DEMO_INTERSECTIONS = [
    ("Simpang Gubeng", "Persimpangan jalur utama arah timur-barat"),
    ("Simpang Pemuda", "Persimpangan pusat kota"),
    ("Simpang Raya", "Persimpangan Jl. Raya"),
    ("Simpang Wonokromo", "Persimpangan arah selatan"),
]


def seed(db: Session) -> None:
    if not settings.SEED_DEMO_DATA:
        return
    if db.scalar(select(Pengguna.id_pengguna).limit(1)) is None:
        for nama, username, pwd, role in DEMO_USERS:
            db.add(Pengguna(nama=nama, username=username, password=hash_password(pwd), role=role))
    if db.scalar(select(Persimpangan.id_persimpangan).limit(1)) is None:
        for nama, desk in DEMO_INTERSECTIONS:
            db.add(Persimpangan(nama_lokasi=nama, deskripsi=desk, jalur=[Jalur(arah=a) for a in settings.LANE_NAMES]))
    db.commit()

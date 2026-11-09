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
# Koordinat PERKIRAAN (derajat desimal) hanya untuk memplot titik di peta demo (F5), bukan data survei.
DEMO_COORDS = {
    "Simpang Gubeng": (-7.2655, 112.7520),
    "Simpang Pemuda": (-7.2625, 112.7455),
    "Simpang Raya": (-7.2895, 112.7390),
    "Simpang Wonokromo": (-7.3040, 112.7375),
}


def seed(db: Session) -> None:
    if not settings.SEED_DEMO_DATA:
        return
    if db.scalar(select(Pengguna.id_pengguna).limit(1)) is None:
        for nama, username, pwd, role in DEMO_USERS:
            db.add(Pengguna(nama=nama, username=username, password=hash_password(pwd), role=role))
    if db.scalar(select(Persimpangan.id_persimpangan).limit(1)) is None:
        for nama, desk in DEMO_INTERSECTIONS:
            lat, lon = DEMO_COORDS[nama]
            db.add(Persimpangan(nama_lokasi=nama, deskripsi=desk, latitude=lat, longitude=lon,
                                jalur=[Jalur(arah=a) for a in settings.LANE_NAMES]))
    # database lama (dibuat sebelum F5): isi koordinat persimpangan demo yang masih kosong
    for p in db.scalars(select(Persimpangan).where(Persimpangan.latitude.is_(None))).all():
        if p.nama_lokasi in DEMO_COORDS:
            p.latitude, p.longitude = DEMO_COORDS[p.nama_lokasi]
    db.commit()

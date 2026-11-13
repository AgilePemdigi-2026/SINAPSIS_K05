"""Fitur Kelola Sistem (khusus Administrator): persimpangan, parameter AI, pengguna, simulasi."""
import base64
import logging
import math
import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import ROLE_ADMIN, ROLE_PETUGAS, PASS_RULE, hash_password, require_roles
from app.models import Jalur, KonfigurasiSistem, Pengguna, Persimpangan
from app.schemas import IntersectionCreate, ParameterUpdate, SimulationRequest, UserCreate
from app.services import monitoring_service as svc
from app.services.arms import arm_type, normalize_arms
from app.services.neuromorphic import Params
from app.services.sensor_source import SyntheticSensorSource
from app.services.simulation_service import run_simulation
from app.core.timeutil import utcnow
from app.routers.vision import decode_frame, get_yolo_service

router = APIRouter(prefix="/api/admin", tags=["Kelola Sistem"])
_admin = require_roles(ROLE_ADMIN)


# ---- Persimpangan ----------------------------------------------------------
DESKRIPSI_MAX = 250  # SRS 3.1.2 / Hi-Fi: textarea "Deskripsi & Karakteristik Arus" maks. 250 karakter


def _intersection_dict(p: Persimpangan) -> dict:
    return {"id_persimpangan": p.id_persimpangan, "nama_lokasi": p.nama_lokasi, "deskripsi": p.deskripsi,
            "latitude": p.latitude, "longitude": p.longitude, "detektor_virtual": bool(p.detektor_virtual),
            "jumlah_lengan": len(p.jalur), "tipe": arm_type([j.arah for j in p.jalur]),
            "jalur": [{"id_jalur": j.id_jalur, "arah": j.arah, "vision_preview": j.vision_preview} for j in p.jalur]}


def _analyze_registration_feeds(feeds: dict[str, str] | None, lanes: list[str]) -> dict[str, dict]:
    """Decode registration Data URLs and return YOLO previews/counts per lane."""
    if not feeds:
        return {}
    try:
        import cv2
        from app.services.yolo_service import YoloVehicleService
    except ImportError as error:
        raise HTTPException(503, "Upload vision membutuhkan paket OpenCV dan Ultralytics.") from error

    base_service = get_yolo_service()
    analyzed = {}
    for lane, data_url in feeds.items():
        if lane not in lanes:
            raise HTTPException(422, f"Feed vision memiliki lajur tidak dikenal: {lane}.")
        if not isinstance(data_url, str) or not data_url.startswith("data:image/") or "," not in data_url:
            raise HTTPException(422, f"Feed vision untuk lajur {lane} harus berupa Data URL gambar.")
        try:
            frame = decode_frame(base64.b64decode(data_url.split(",", 1)[1]))
            service = YoloVehicleService(
                model=base_service.model,
                confidence=base_service.confidence,
                lane_mapper=lambda center_x, center_y, width, height, selected=lane: selected,
            )
            result = service.detect(frame)
            encoded, annotated = cv2.imencode(".jpg", service.draw_detections(frame, result))
            if not encoded:
                raise ValueError("hasil anotasi tidak dapat dikodekan")
        except (ValueError, TypeError, base64.binascii.Error) as error:
            raise HTTPException(422, f"Feed vision untuk lajur {lane} tidak valid.") from error
        analyzed[lane] = {
            "count": result["total"],
            "preview": "data:image/jpeg;base64," + base64.b64encode(annotated.tobytes()).decode("ascii"),
        }
    return analyzed


@router.get("/intersections")
def list_intersections(db: Session = Depends(get_db), _=Depends(_admin)):
    return [_intersection_dict(p)
            for p in db.scalars(select(Persimpangan).order_by(Persimpangan.id_persimpangan)).all()]


@router.post("/intersections", status_code=201)
def add_intersection(req: IntersectionCreate, db: Session = Depends(get_db), _=Depends(_admin)):
    nama = (req.nama_lokasi or "").strip()
    if not nama:
        raise HTTPException(422, "Nama lokasi persimpangan wajib diisi!")
    if len(nama) > 100:
        raise HTTPException(422, "Nama lokasi maksimal 100 karakter.")
    deskripsi = (req.deskripsi or "").strip() or None
    if deskripsi and len(deskripsi) > DESKRIPSI_MAX:
        raise HTTPException(422, f"Deskripsi maksimal {DESKRIPSI_MAX} karakter.")
    lat, lon = req.latitude, req.longitude
    if (lat is None) != (lon is None):
        raise HTTPException(422, "Latitude dan longitude harus diisi berpasangan.")
    if lat is not None and not (-90 <= lat <= 90 and math.isfinite(lat)):
        raise HTTPException(422, "Latitude harus berada di antara -90 dan 90.")
    if lon is not None and not (-180 <= lon <= 180 and math.isfinite(lon)):
        raise HTTPException(422, "Longitude harus berada di antara -180 dan 180.")
    try:
        requested_arms = req.lengan
        if requested_arms is None and req.jumlah_lengan is not None:
            if req.jumlah_lengan == 4:
                requested_arms = list(settings.LANE_NAMES)
            elif req.jumlah_lengan == 3:
                requested_arms = list(settings.LANE_NAMES[1:])
            else:
                raise ValueError("Jumlah lengan harus 3 atau 4.")
        lengan = normalize_arms(requested_arms)
    except ValueError as e:
        raise HTTPException(422, str(e))
    if req.jumlah_lengan is not None and req.jumlah_lengan != len(lengan):
        raise HTTPException(422, "jumlah_lengan tidak sesuai dengan daftar lengan.")
    if req.bentuk is not None:
        bentuk = req.bentuk.strip().lower()
        expected_bentuk = "perempatan" if len(lengan) == 4 else "pertigaan"
        if expected_bentuk not in bentuk:
            raise HTTPException(422, "bentuk tidak sesuai dengan jumlah lengan.")
    analyzed_feeds = _analyze_registration_feeds(req.vision_feeds, lengan)
    p = Persimpangan(nama_lokasi=nama, deskripsi=deskripsi, latitude=lat, longitude=lon,
                     detektor_virtual=True if req.detektor_virtual is None else req.detektor_virtual,
                     jalur=[Jalur(arah=a, vision_preview=analyzed_feeds.get(a, {}).get("preview")) for a in lengan])
    try:
        db.add(p)
        db.commit()
    except Exception as error:
        db.rollback()
        logging.getLogger(__name__).exception("Gagal menyimpan persimpangan baru")
        raise HTTPException(500, "Persimpangan gagal disimpan ke database.") from error
    # Satu siklus simulasi langsung dijalankan agar simpang baru punya data (status, jumlah kendaraan, diagram)
    # tanpa menunggu "Muat ulang"; kegagalan simulasi tidak membatalkan pendaftaran.
    try:
        initial_counts = [analyzed_feeds.get(lane, {}).get("count", 0) for lane in lengan]
        data_awal = svc.run_cycle(db, p, counts=initial_counts if analyzed_feeds else None) is not None
    except Exception:
        db.rollback()
        logging.getLogger(__name__).exception("Siklus awal persimpangan %s gagal", p.id_persimpangan)
        data_awal = False
    return {"pesan": "Persimpangan baru berhasil ditambahkan!", "id_persimpangan": p.id_persimpangan,
            "data_awal": data_awal, "jumlah_lengan": len(lengan), "tipe": arm_type(lengan), "redirect": "/admin/intersections"}


# ---- Parameter sistem AI ---------------------------------------------------
# label & satuan untuk halaman Parameter Sistem
PARAM_META = {
    "spike_threshold": ("Spike Threshold (deteksi lonjakan antrean)", "rasio"),
    "min_green_time": ("Durasi Hijau Minimum", "detik"),
    "max_green_time": ("Durasi Hijau Maksimum", "detik"),
    "amber_duration": ("Durasi Kuning (Amber Clearance)", "detik"),
}


@router.get("/parameters")
def list_parameters(db: Session = Depends(get_db), _=Depends(_admin)):
    p, base = svc.load_params(db), Params()
    now = {"spike_threshold": p.spike_threshold, "min_green_time": p.min_green,
           "max_green_time": p.max_green, "amber_duration": p.amber}
    default = {"spike_threshold": base.spike_threshold, "min_green_time": base.min_green,
               "max_green_time": base.max_green, "amber_duration": base.amber}
    last = {}
    for r in db.scalars(select(KonfigurasiSistem).order_by(KonfigurasiSistem.waktu_perubahan.desc(),
                                                           KonfigurasiSistem.id_konfigurasi.desc())).all():
        last.setdefault(r.jenis_parameter, r)
    return [{"jenis_parameter": k, "label": PARAM_META[k][0], "satuan": PARAM_META[k][1], "tipe": v[0].__name__, "nilai_aktif": now[k],
             "baseline": default[k], "keterangan": v[3], "rentang": [v[1], v[2]],
             "diubah_terakhir": last[k].waktu_perubahan.isoformat() if k in last else None}
            for k, v in svc.PARAM_KEYS.items()]


@router.put("/parameters")
def update_parameter(req: ParameterUpdate, db: Session = Depends(get_db), user=Depends(_admin)):
    spec = svc.PARAM_KEYS.get(req.jenis_parameter)
    if spec is None:
        raise HTTPException(422, f"Jenis parameter tidak dikenal. Pilihan: {', '.join(svc.PARAM_KEYS)}")
    tipe, lo, hi, _ = spec
    if not lo <= req.nilai <= hi:
        raise HTTPException(422, f"Nilai {req.jenis_parameter} harus antara {lo} dan {hi}.")
    nilai = tipe(req.nilai)
    cfg = svc.load_params(db)
    new_min = nilai if req.jenis_parameter == "min_green_time" else cfg.min_green
    new_max = nilai if req.jenis_parameter == "max_green_time" else cfg.max_green
    if new_min >= new_max:
        raise HTTPException(422, "Durasi hijau minimum harus lebih kecil dari maksimum.")
    row = KonfigurasiSistem(id_pengguna=user.id_pengguna, jenis_parameter=req.jenis_parameter,
                            nilai=str(nilai), waktu_perubahan=utcnow())
    db.add(row)
    db.commit()
    return {"pesan": "Parameter konfigurasi berhasil diperbarui!", "jenis_parameter": req.jenis_parameter, "nilai": nilai,
            "id_transaksi": f"TRX-{row.id_konfigurasi:06d}", "waktu": row.waktu_perubahan.isoformat(),
            "catatan": "Berlaku pada siklus pemantauan berikutnya."}


@router.get("/parameters/history")
def parameter_history(db: Session = Depends(get_db), _=Depends(_admin)):
    rows = db.scalars(select(KonfigurasiSistem).order_by(KonfigurasiSistem.waktu_perubahan.desc(),
                                                         KonfigurasiSistem.id_konfigurasi.desc()).limit(50)).all()
    names = {u.id_pengguna: u.nama for u in db.scalars(select(Pengguna)).all()}
    return [{"id_transaksi": f"TRX-{r.id_konfigurasi:06d}", "jenis_parameter": r.jenis_parameter, "nilai": r.nilai,
             "diubah_oleh": r.id_pengguna, "diubah_oleh_nama": names.get(r.id_pengguna),
             "waktu": r.waktu_perubahan.isoformat()} for r in rows]


# ---- Pengguna --------------------------------------------------------------
_PASS_RULE = PASS_RULE


@router.get("/users")
def list_users(db: Session = Depends(get_db), _=Depends(_admin)):
    return [{"id_pengguna": u.id_pengguna, "nama": u.nama, "username": u.username, "role": u.role}
            for u in db.scalars(select(Pengguna).order_by(Pengguna.id_pengguna)).all()]


@router.post("/users", status_code=201)
def add_user(req: UserCreate, db: Session = Depends(get_db), _=Depends(_admin)):
    nama, username, password, role = (req.nama or "").strip(), (req.username or "").strip(), req.password or "", (req.role or "").strip()
    if not all([nama, username, password, role]):
        raise HTTPException(422, "Semua field wajib diisi!")
    if role not in (ROLE_ADMIN, ROLE_PETUGAS):
        raise HTTPException(422, f"Role harus '{ROLE_ADMIN}' atau '{ROLE_PETUGAS}'.")
    if not re.fullmatch(r"[A-Za-z0-9_.]{3,50}", username):
        raise HTTPException(422, "Username 3-50 karakter alfanumerik (boleh _ dan .).")
    if not _PASS_RULE.match(password):
        raise HTTPException(422, "Password minimal 8 karakter, mengandung huruf kapital dan angka.")
    if db.scalar(select(Pengguna).where(Pengguna.username == username)):
        raise HTTPException(409, "Username sudah digunakan.")
    u = Pengguna(nama=nama, username=username, password=hash_password(password), role=role)
    db.add(u)
    db.commit()
    return {"pesan": "Akun pengguna berhasil dibuat!", "id_pengguna": u.id_pengguna, "role": u.role, "redirect": "/admin/users"}


# ---- Simulasi skenario -----------------------------------------------------
@router.post("/simulations")
def simulate(req: SimulationRequest, db: Session = Depends(get_db), user=Depends(_admin)):
    if req.profil not in SyntheticSensorSource.PROFILES:
        raise HTTPException(422, f"Profil tidak dikenal. Pilihan: {', '.join(SyntheticSensorSource.PROFILES)}")
    if not 1 <= req.jumlah_siklus <= 500:
        raise HTTPException(422, "jumlah_siklus harus antara 1 dan 500.")
    return run_simulation(db, user.id_pengguna, req.profil, req.jumlah_siklus,
                          req.inject_weather_noise, req.simulasi_sensor_failure, req.seed)

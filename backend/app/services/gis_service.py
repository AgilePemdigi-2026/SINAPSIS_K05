"""Business Logic Peta & GIS — Fitur 2, 3, 4 (Pantau, Kelola, Rute Darurat).

Pemilik: Ryan (GIS & Persimpangan).

Fungsi utama:
  - get_intersection_map_data : data peta real-time + status kemacetan + alert
  - refresh_traffic_data      : muat ulang data (tombol "Refresh Data")
  - add_intersection          : tambah persimpangan baru + 4 jalur
  - search_emergency_route    : cari rute darurat optimal (Dijkstra)
  - activate_green_corridor   : aktifkan koridor hijau
"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.timeutil import utcnow
from app.models.intersection import (
    Deteksi,
    DetailRute,
    Jalur,
    Persimpangan,
    RuteDarurat,
)
from app.services.routing_service import dijkstra, load_graph, resolve_node

# ---------------------------------------------------------------------------
# Data Default / Seed Wireframe (Gambar 4.1)
# ---------------------------------------------------------------------------
DEFAULT_INTERSECTIONS = [
    {"nama": "Simpang A", "status": "LANCAR", "kendaraan_per_menit": 142},
    {"nama": "Simpang B", "status": "PADAT", "kendaraan_per_menit": 389},
    {"nama": "Simpang C", "status": "KRITIS", "kendaraan_per_menit": 520},
    {"nama": "Simpang D", "status": "LANCAR", "kendaraan_per_menit": 180},
]


def _status_label(max_count: int) -> str:
    """Klasifikasi status berdasarkan rasio terhadap kapasitas."""
    ratio = max_count / max(settings.MAX_VEHICLES, 1)
    if ratio >= settings.EMERGENCY_RATIO:
        return "KRITIS"
    return "PADAT" if ratio >= 0.5 else "LANCAR"


def _status_from_kendaraan(jumlah: int) -> str:
    """Status berdasarkan jumlah kendaraan/menit (untuk seed wireframe)."""
    if jumlah >= 500:
        return "KRITIS"
    if jumlah >= 300:
        return "PADAT"
    return "LANCAR"


# ---------------------------------------------------------------------------
# Fitur 2: Pantau Kondisi Lalu Lintas / Get Map Data
# ---------------------------------------------------------------------------
def get_intersection_map_data(db: Session) -> dict:
    """Mengambil data peta real-time: daftar simpang, status, alert kemacetan.

    Jika database kosong, kembalikan data default/seed dari wireframe.
    """
    persimpangan_list = db.scalars(
        select(Persimpangan).order_by(Persimpangan.id_persimpangan)
    ).all()

    # Jika belum ada data di DB, gunakan data wireframe default
    if not persimpangan_list:
        items = []
        alerts = []
        any_offline = False
        for d in DEFAULT_INTERSECTIONS:
            item = {
                "nama_lokasi": d["nama"],
                "status": d["status"],
                "kendaraan_per_menit": d["kendaraan_per_menit"],
                "sensor_offline": False,
                "status_sensor": "ONLINE",
            }
            items.append(item)
            if d["status"] == "KRITIS":
                alerts.append(d["nama"])

        alert_text = "Peringatan: Kemacetan Terdeteksi di Persimpangan"
        result = {
            "traffic_density_map": items,
            "traffic-density-map": items,
            "intersection_status_list": items,
            "intersection-status-list": items,
            "congestion_alert": alert_text,
            "congestion-alert": alert_text,
            "pesan_alert": alert_text,
            "sensor_warning": None,
            "pesan_sensor": None,
        }
        return result

    # Ambil data dari DB
    items = []
    alerts = []
    any_offline = False

    for p in persimpangan_list:
        lane_ids = [j.id_jalur for j in p.jalur]

        # Ambil deteksi terakhir
        latest = (
            db.scalar(
                select(func.max(Deteksi.waktu_deteksi)).where(
                    Deteksi.id_jalur.in_(lane_ids)
                )
            )
            if lane_ids
            else None
        )
        counts = []
        if latest:
            counts = [
                c
                for (c,) in db.execute(
                    select(Deteksi.jumlah_kendaraan).where(
                        Deteksi.id_jalur.in_(lane_ids),
                        Deteksi.waktu_deteksi == latest,
                    )
                ).all()
            ]

        total_kendaraan = sum(counts) if counts else 0
        is_offline = p.status_sensor == "Sensor Offline"

        if is_offline:
            any_offline = True
            label = "Sensor Offline"
        elif counts:
            label = _status_label(max(counts))
        else:
            label = "Belum ada data"

        item = {
            "id_persimpangan": p.id_persimpangan,
            "nama_lokasi": p.nama_lokasi,
            "kode_simpang": p.kode_simpang,
            "deskripsi": p.deskripsi,
            "latitude": p.latitude,
            "longitude": p.longitude,
            "status": label,
            "kendaraan_per_menit": total_kendaraan,
            "sensor_offline": is_offline,
            "status_sensor": p.status_sensor,
            "aktif_loop_virtual": p.aktif_loop_virtual,
            "terakhir_diperbarui": latest.isoformat() if latest else None,
            "jalur": [
                {"id_jalur": j.id_jalur, "arah": j.arah} for j in p.jalur
            ],
        }
        items.append(item)

        if label == "KRITIS":
            alerts.append(p.nama_lokasi)

    alert_msg = None
    if alerts:
        nama_simpang = ", ".join(alerts)
        alert_msg = f"PERINGATAN KEMACETAN: {nama_simpang.upper()} TERPANTAU PADAT"

    sensor_msg = None
    if any_offline:
        sensor_msg = "Data pemantauan tidak tersedia untuk beberapa simpang."

    return {
        "traffic_density_map": items,
        "traffic-density-map": items,
        "intersection_status_list": items,
        "intersection-status-list": items,
        "congestion_alert": alert_msg,
        "congestion-alert": alert_msg,
        "pesan_alert": alert_msg,
        "sensor_warning": sensor_msg,
        "pesan_sensor": sensor_msg,
    }


# ---------------------------------------------------------------------------
# Fitur 2: Refresh Data
# ---------------------------------------------------------------------------
def refresh_traffic_data(db: Session) -> dict:
    """Muat ulang data lalu lintas (tombol Refresh Data)."""
    data = get_intersection_map_data(db)
    data["pesan"] = "Data lalu lintas berhasil dimuat ulang."
    return data


# ---------------------------------------------------------------------------
# Fitur 3: Tambah Persimpangan Baru
# ---------------------------------------------------------------------------
def add_intersection(
    db: Session,
    nama_lokasi: str,
    deskripsi: str | None = None,
    kode_simpang: str | None = None,
    latitude: float | None = None,
    longitude: float | None = None,
    aktif_loop_virtual: bool = True,
) -> dict:
    """Tambah persimpangan baru + otomatis 4 jalur.

    Raises ValueError jika nama_lokasi kosong.
    """
    nama = (nama_lokasi or "").strip()
    if not nama:
        raise ValueError("Nama lokasi persimpangan wajib diisi!")

    status_sensor = "ONLINE" if aktif_loop_virtual else "Sensor Offline"

    p = Persimpangan(
        nama_lokasi=nama,
        deskripsi=deskripsi,
        kode_simpang=kode_simpang,
        latitude=latitude,
        longitude=longitude,
        aktif_loop_virtual=aktif_loop_virtual,
        status_sensor=status_sensor,
        jalur=[Jalur(arah=a) for a in settings.LANE_NAMES],  # 4 arah
    )
    db.add(p)
    db.commit()
    db.refresh(p)

    return {
        "pesan": "Persimpangan baru berhasil ditambahkan!",
        "id_persimpangan": p.id_persimpangan,
        "nama_lokasi": p.nama_lokasi,
        "jalur": [{"id_jalur": j.id_jalur, "arah": j.arah} for j in p.jalur],
    }


# ---------------------------------------------------------------------------
# Fitur 4: Kalkulasi Rute Darurat Optimal (Dijkstra)
# ---------------------------------------------------------------------------
def _congestion_by_name(db: Session) -> dict[str, float]:
    """Faktor kepadatan 0..1 per nama persimpangan (bobot Dijkstra)."""
    out: dict[str, float] = {}
    for p in db.scalars(select(Persimpangan)).all():
        lane_ids = [j.id_jalur for j in p.jalur]
        if not lane_ids:
            continue
        latest = db.scalar(
            select(func.max(Deteksi.waktu_deteksi)).where(
                Deteksi.id_jalur.in_(lane_ids)
            )
        )
        if latest is None:
            continue
        counts = [
            c
            for (c,) in db.execute(
                select(Deteksi.jumlah_kendaraan).where(
                    Deteksi.id_jalur.in_(lane_ids),
                    Deteksi.waktu_deteksi == latest,
                )
            ).all()
        ]
        if counts:
            out[p.nama_lokasi] = min(
                1.0, sum(counts) / (settings.MAX_VEHICLES * 4)
            )
    return out


def search_emergency_route(
    db: Session,
    id_pengguna: int,
    lokasi_awal: str,
    tujuan: str,
    level_prioritas: str,
) -> dict:
    """Cari rute darurat optimal via Dijkstra.

    Raises ValueError jika tujuan kosong.
    """
    tujuan_clean = (tujuan or "").strip()
    if not tujuan_clean:
        raise ValueError("Lokasi tujuan wajib diisi!")

    asal_clean = (lokasi_awal or "").strip()

    graph = load_graph()
    src = resolve_node(graph, asal_clean) if asal_clean else None
    dst = resolve_node(graph, tujuan_clean)

    if src is None or dst is None:
        return {"error": "Lokasi tidak valid atau tidak ditemukan di peta."}

    congestion = _congestion_by_name(db)
    plan = dijkstra(graph, src, dst, congestion)
    if plan is None:
        return {"error": "Rute tidak ditemukan."}

    # Simpan ke DB
    rute = RuteDarurat(
        id_pengguna=id_pengguna,
        lokasi_awal=src,
        tujuan=dst,
        level_prioritas=level_prioritas,
        status="Diajukan",
    )
    db.add(rute)
    db.flush()

    # Simpan detail rute (urutan simpang yang dilewati)
    urutan = 0
    for step in plan.steps:
        p = db.scalar(
            select(Persimpangan).where(
                Persimpangan.nama_lokasi == step["node"]
            )
        )
        if p is None:
            continue
        jalur = next(
            (j for j in p.jalur if j.arah == step["arah_masuk"]), None
        )
        if jalur is not None:
            urutan += 1
            db.add(
                DetailRute(
                    id_rute=rute.id_rute,
                    id_jalur=jalur.id_jalur,
                    urutan=urutan,
                )
            )
    db.commit()
    db.refresh(rute)

    # Serialize detail
    detail = []
    for d in rute.detail:
        j = db.get(Jalur, d.id_jalur)
        detail.append(
            {
                "urutan": d.urutan,
                "id_jalur": d.id_jalur,
                "arah": j.arah,
                "persimpangan": j.persimpangan.nama_lokasi,
            }
        )

    return {
        "pesan": "Rute Darurat Optimal Ditemukan",
        "id_rute": rute.id_rute,
        "tujuan": rute.tujuan,
        "lokasi_awal": rute.lokasi_awal,
        "level_prioritas": rute.level_prioritas,
        "status": rute.status,
        "rute": plan.nodes,
        "estimasi_menit": max(1, round(plan.total_time_s / 60)),
        "jumlah_persimpangan": len(detail),
        "jalur_dilewati": detail,
    }


def activate_green_corridor(db: Session, id_rute: int) -> dict:
    """Aktifkan koridor hijau darurat untuk rute tertentu."""
    rute = db.get(RuteDarurat, id_rute)
    if rute is None:
        return {"error": "Rute tidak ditemukan.", "status_code": 404}
    if rute.status != "Diajukan":
        return {
            "error": f"Rute berstatus '{rute.status}', hanya rute 'Diajukan' yang dapat diaktifkan.",
            "status_code": 409,
        }

    rute.status = "Aktif"
    rute.waktu_aktivasi = utcnow()
    db.commit()

    # Serialize detail
    detail = []
    for d in rute.detail:
        j = db.get(Jalur, d.id_jalur)
        detail.append(
            {
                "urutan": d.urutan,
                "id_jalur": d.id_jalur,
                "arah": j.arah,
                "persimpangan": j.persimpangan.nama_lokasi,
            }
        )

    return {
        "pesan": "Koridor hijau darurat berhasil diaktifkan!",
        "id_rute": rute.id_rute,
        "status": rute.status,
        "waktu_aktivasi": rute.waktu_aktivasi.isoformat() if rute.waktu_aktivasi else None,
        "jumlah_persimpangan": len(detail),
        "jalur_dilewati": detail,
    }


"""Variasi lengan persimpangan: 4 lengan (perempatan) atau 3 lengan (pertigaan, lengan mana pun boleh tidak ada).

Satu lengan = satu Jalur pada model data (CDM: Persimpangan 1-N Jalur), jadi variasi ini tidak
mengubah skema database. Urutan lengan selalu mengikuti `settings.LANE_NAMES`.
"""
from __future__ import annotations

from app.core.config import settings

MIN_ARMS = 3  # 2 lengan hanya ruas jalan biasa, bukan persimpangan
MAX_ARMS = 8
NUMBERED_FROM = 5  # >= 5 lengan diberi label angka (arah jalan tidak selalu sejajar mata angin)
NUMBERED_PREFIX = "Lengan "


def numbered_names(n: int) -> list[str]:
    return [f"{NUMBERED_PREFIX}{i}" for i in range(1, n + 1)]


def is_numbered(arms: list[str]) -> bool:
    return bool(arms) and all(isinstance(a, str) and a.startswith(NUMBERED_PREFIX) for a in arms)


def normalize_arms(raw: list[str] | None) -> list[str]:
    """Validasi daftar lengan dari klien; None = default 4 lengan. Lempar ValueError berisi pesan Indonesia."""
    if raw is None:
        return list(settings.LANE_NAMES)
    if not isinstance(raw, list) or not all(isinstance(a, str) for a in raw):
        raise ValueError("Daftar lengan tidak valid.")
    names = [a.strip() for a in raw]
    if any(a.startswith(NUMBERED_PREFIX) for a in names):
        if not is_numbered(names):
            raise ValueError("Label angka (Lengan 1, 2, ...) tidak boleh dicampur dengan nama mata angin.")
        if len(set(names)) != len(names):
            raise ValueError("Lengan tidak boleh duplikat.")
        n = len(names)
        if not (MIN_ARMS <= n <= MAX_ARMS) or sorted(names) != sorted(numbered_names(n)):
            raise ValueError(f"Lengan berlabel angka harus berurutan Lengan 1..N dengan N antara {MIN_ARMS} dan {MAX_ARMS}.")
        return numbered_names(n)
    unknown = [a for a in names if a not in settings.LANE_NAMES]
    if unknown:
        raise ValueError(f"Lengan tidak dikenal: {', '.join(unknown)}. Pilihan: {', '.join(settings.LANE_NAMES)}.")
    if len(set(names)) != len(names):
        raise ValueError("Lengan tidak boleh duplikat.")
    if len(names) < MIN_ARMS:
        raise ValueError(f"Persimpangan minimal punya {MIN_ARMS} lengan.")
    return [a for a in settings.LANE_NAMES if a in names]  # urutan kanonik


def arm_type(arms: list[str]) -> str:
    """Label jenis persimpangan untuk UI."""
    n = len(arms)
    if n >= NUMBERED_FROM:
        return f"Persimpangan {n} lengan"
    if n >= 4:
        return "Perempatan (4 lengan)"
    return "Pertigaan (3 lengan)"


COMPASS_BEARING = {"Utara": 0.0, "Timur": 90.0, "Selatan": 180.0, "Barat": 270.0}


def default_bearings(arms: list[str]) -> dict[str, float]:
    """Arah bawaan tiap lengan: mata angin -> 0/90/180/270; label angka -> dibagi rata, Lengan 1 menghadap utara."""
    if is_numbered(arms):
        n = len(arms)
        return {a: round(360.0 / n * i, 1) for i, a in enumerate(arms)}
    return {a: COMPASS_BEARING.get(a, 0.0) for a in arms}


def effective_bearings(arms: list[str], stored: dict[str, float | None] | None = None) -> dict[str, float]:
    """Arah tersimpan bila ada, selain itu bawaan."""
    out = default_bearings(arms)
    for a, v in (stored or {}).items():
        if a in out and v is not None:
            out[a] = float(v) % 360
    return out


def normalize_bearings(raw: dict | None, arms: list[str]) -> dict[str, float]:
    """Validasi arah dari klien. Lempar ValueError berisi pesan Indonesia."""
    if raw is None:
        return {}
    import math
    out = {}
    for a, v in raw.items():
        if a not in arms:
            raise ValueError(f"Arah diberikan untuk lengan yang tidak ada: {a}.")
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not (0 <= v <= 360):
            raise ValueError(f"Arah lengan {a} harus berupa angka 0-360 derajat.")
        out[a] = float(v) % 360
    return out


MAX_PATH_POINTS = 120


def normalize_paths(raw: dict | None, arms: list[str]) -> dict[str, list[list[float]]]:
    """Validasi garis jalan tiap lengan yang digambar di peta: {arah: [[lat, lon], ...]} dari tengah persimpangan keluar."""
    if raw is None:
        return {}
    out = {}
    for a, pts in raw.items():
        if a not in arms:
            raise ValueError(f"Garis diberikan untuk lengan yang tidak ada: {a}.")
        if not isinstance(pts, list) or not (2 <= len(pts) <= MAX_PATH_POINTS):
            raise ValueError(f"Garis lengan {a} harus berisi 2-{MAX_PATH_POINTS} titik.")
        clean = []
        for p in pts:
            ok = (isinstance(p, (list, tuple)) and len(p) == 2
                  and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in p))
            if not ok or not (-90 <= p[0] <= 90 and -180 <= p[1] <= 180) or p[0] != p[0] or p[1] != p[1]:
                raise ValueError(f"Titik pada garis lengan {a} tidak valid.")
            clean.append([round(float(p[0]), 7), round(float(p[1]), 7)])
        out[a] = clean
    return out

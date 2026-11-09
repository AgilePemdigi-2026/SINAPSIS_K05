"""Variasi lengan persimpangan: 4 lengan (perempatan) atau 3 lengan (pertigaan, lengan mana pun boleh tidak ada).

Satu lengan = satu Jalur pada model data (CDM: Persimpangan 1-N Jalur), jadi variasi ini tidak
mengubah skema database. Urutan lengan selalu mengikuti `settings.LANE_NAMES`.
"""
from __future__ import annotations

from app.core.config import settings

MIN_ARMS = 3  # 2 lengan hanya ruas jalan biasa, bukan persimpangan


def normalize_arms(raw: list[str] | None) -> list[str]:
    """Validasi daftar lengan dari klien; None = default 4 lengan. Lempar ValueError berisi pesan Indonesia."""
    if raw is None:
        return list(settings.LANE_NAMES)
    if not isinstance(raw, list) or not all(isinstance(a, str) for a in raw):
        raise ValueError("Daftar lengan tidak valid.")
    names = [a.strip() for a in raw]
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
    if n >= 4:
        return "Perempatan (4 lengan)"
    return "Pertigaan (3 lengan)"

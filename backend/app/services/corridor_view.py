"""Tampilan koridor hijau untuk dashboard (Fitur 9): memetakan koridor aktif ke persimpangan di peta.

Modul ini murni (tanpa database/FastAPI). API koridor hijau menerima rute sebagai daftar teks
(mis. "SIMPANG-01"), sedangkan dashboard bekerja dengan id persimpangan. Aturan pemetaan, berurutan:
  1. "SIMPANG-03" / "SIMPANG03" / "3"   -> persimpangan dengan id_persimpangan 3
  2. nama persimpangan (tanpa membedakan huruf besar/kecil, "-" dan "_" dianggap spasi),
     mis. "SIMPANG-GUBENG" -> "Simpang Gubeng"
Teks yang tidak cocok dilaporkan di `tidak_terpetakan` agar tidak hilang diam-diam.
"""
from __future__ import annotations

import re
from typing import Iterable, Mapping


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[-_]+", " ", str(text)).strip().lower())


def resolve_id(token: str, items: Iterable[Mapping]) -> int | None:
    """Cari id_persimpangan untuk satu entri rute; None jika tidak cocok."""
    items = list(items)
    ids = {int(i["id_persimpangan"]) for i in items}
    m = re.fullmatch(r"(?:simpang)?[\s_-]*0*(\d+)", _norm(token).replace(" ", ""), flags=re.I)
    if m and int(m.group(1)) in ids:
        return int(m.group(1))
    want = _norm(token)
    for i in items:
        if _norm(i["nama_lokasi"]) == want:
            return int(i["id_persimpangan"])
    return None


def build(active: Mapping[str, Mapping], items: list[dict]) -> list[dict]:
    """Daftar koridor aktif dengan urutan id persimpangan yang sudah dipetakan."""
    out = []
    for emergency_id, c in active.items():
        if c.get("status", "ACTIVE") != "ACTIVE":
            continue
        urutan, hilang = [], []
        for token in c.get("route_intersections", []):
            pid = resolve_id(token, items)
            if pid is None:
                hilang.append(token)
            elif pid not in urutan:
                urutan.append(pid)
        out.append({
            "emergency_id": emergency_id,
            "jenis_kendaraan": c.get("vehicle_type"),
            "diaktifkan": c.get("activated_at"),
            "oleh": c.get("triggered_by"),
            "rute": list(c.get("route_intersections", [])),
            "urutan": urutan,
            "tidak_terpetakan": hilang,
        })
    return out


def annotate(items: list[dict], corridors: list[dict]) -> None:
    """Tandai tiap item persimpangan dengan `koridor_hijau` (bool) dan `koridor` (rincian, bila ada)."""
    by_id: dict[int, dict] = {}
    for c in corridors:
        for pos, pid in enumerate(c["urutan"], start=1):
            by_id.setdefault(pid, {"emergency_id": c["emergency_id"], "urutan": pos, "total": len(c["urutan"]),
                                   "jenis_kendaraan": c["jenis_kendaraan"]})
    for item in items:
        info = by_id.get(item["id_persimpangan"])
        item["koridor_hijau"] = bool(info) or bool(item.get("koridor_aktif"))
        item["koridor"] = info

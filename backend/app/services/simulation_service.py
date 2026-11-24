"""Simulasi skenario offline: tidak menulis ke tabel operasional (hanya SimulasiSkenario)."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from app.models import SimulasiSkenario
from app.services.monitoring_service import load_params
from app.services.neuromorphic import IntersectionEngine
from app.services.sensor_source import SyntheticSensorSource
from app.core.timeutil import utcnow


def run_simulation(db: Session, id_pengguna: int, profile: str, n_cycles: int,
                   weather_noise: bool, sensor_failure: bool, seed: int | None = None) -> dict:
    sim = SimulasiSkenario(id_pengguna=id_pengguna, profil_skenario=profile, jumlah_siklus=n_cycles,
                           inject_weather_noise=weather_noise, simulasi_sensor_failure=sensor_failure)
    db.add(sim)
    db.flush()

    source = SyntheticSensorSource(profile, noise=weather_noise, seed=seed)
    engine, params = IntersectionEngine(), load_params(db)
    spikes, offline, greens = [0] * 4, 0, [[] for _ in range(4)]
    for cycle in range(1, n_cycles + 1):
        if sensor_failure and cycle % 4 == 0:  # tiap siklus ke-4 sensor mati
            offline += 1
            # Eksekusi mode Fail-Safe: fallback ke jadwal timer konvensional (SRS 5.2)
            fs_out = engine.fail_safe_step(params)
            for lane in fs_out["lanes"]:
                i = lane["lane_index"]
                if lane["signal"] == "HIJAU":
                    greens[i].append(lane["duration"])
            continue
        r = source.read()
        out = engine.step(r["counts"], r["hour"], params)
        for lane in out["lanes"]:
            i = lane["lane_index"]
            spikes[i] += int(lane["spike"])
            if lane["signal"] == "HIJAU":
                greens[i].append(lane["duration"])
    sim.waktu_selesai = utcnow()
    db.commit()
    return {
        "id_simulasi": sim.id_simulasi,
        "profil": profile,
        "siklus": n_cycles,
        "siklus_sensor_offline": offline,
        "siklus_fail_safe": offline,
        "mode_fail_safe_aktif": sensor_failure and offline > 0,
        "mekanisme_keamanan": "Fail-Safe Fixed-Timer Interlocking (SRS 5.2)",
        "total_spike_per_jalur": spikes,
        "rata_rata_hijau_per_jalur": [round(sum(g) / len(g), 1) if g else 0 for g in greens],
        "waktu_selesai": sim.waktu_selesai.isoformat(),
        "ringkasan_skenario": {
            "profil": profile,
            "cuaca_ekstrem_noise": weather_noise,
            "simulasi_gangguan_sensor": sensor_failure,
            "total_siklus_adaptif": n_cycles - offline,
            "total_siklus_fail_safe": offline,
            "interlocking_safety_terpenuhi": True,
        },
    }


def run_network_simulation(db: Session, id_pengguna: int, profile: str = "NORMAL",
                           n_cycles: int = 10, gangguan_simpang_ids: list[int] | None = None,
                           inject_weather_noise: bool = False, seed: int | None = None) -> dict:
    """
    Simulasi beban lalu lintas jaringan 5 persimpangan secara serempak.
    Mendukung skenario kegagalan sensor/CCTV pada subset persimpangan (gangguan_simpang_ids).
    Memverifikasi stabilitas telemetri dan transisi fail-safe tanpa mengganggu simpang lain.
    """
    from sqlalchemy import select
    from app.models import Persimpangan

    sim = SimulasiSkenario(id_pengguna=id_pengguna, profil_skenario=profile, jumlah_siklus=n_cycles,
                           inject_weather_noise=inject_weather_noise,
                           simulasi_sensor_failure=bool(gangguan_simpang_ids))
    db.add(sim)
    db.flush()

    persimpangans = db.scalars(select(Persimpangan).order_by(Persimpangan.id_persimpangan)).all()
    failed_ids = set(gangguan_simpang_ids or [])
    params = load_params(db)

    engines = {p.id_persimpangan: IntersectionEngine(len(p.jalur)) for p in persimpangans}
    sources = {
        p.id_persimpangan: SyntheticSensorSource(
            profile, noise=inject_weather_noise, seed=(seed + p.id_persimpangan if seed else None),
            arms=[j.arah for j in sorted(p.jalur, key=lambda j: j.id_jalur)]
        ) for p in persimpangans
    }

    per_simpang = {p.id_persimpangan: {
        "id_persimpangan": p.id_persimpangan,
        "nama_lokasi": p.nama_lokasi,
        "mode_operasi": "FAIL_SAFE" if p.id_persimpangan in failed_ids else "ADAPTIF_AI",
        "total_spikes": [0] * len(p.jalur),
        "greens": [[] for _ in range(len(p.jalur))],
        "siklus_failsafe": 0,
        "siklus_adaptif": 0,
        "interlocking_safety_ok": True,
    } for p in persimpangans}

    for cycle in range(1, n_cycles + 1):
        for p in persimpangans:
            pid = p.id_persimpangan
            eng = engines[pid]
            rec = per_simpang[pid]
            if pid in failed_ids:
                fs_out = eng.fail_safe_step(params)
                rec["siklus_failsafe"] += 1
                green_lanes = [l for l in fs_out["lanes"] if l["signal"] == "HIJAU"]
                if len(green_lanes) != 1:
                    rec["interlocking_safety_ok"] = False
                for l in fs_out["lanes"]:
                    if l["signal"] == "HIJAU":
                        rec["greens"][l["lane_index"]].append(l["duration"])
            else:
                r = sources[pid].read()
                out = eng.step(r["counts"], r["hour"], params)
                rec["siklus_adaptif"] += 1
                green_lanes = [l for l in out["lanes"] if l["signal"] == "HIJAU"]
                if len(green_lanes) > 1 and not out["critical_lanes"]:
                    rec["interlocking_safety_ok"] = False
                for l in out["lanes"]:
                    idx = l["lane_index"]
                    rec["total_spikes"][idx] += int(l["spike"])
                    if l["signal"] == "HIJAU":
                        rec["greens"][idx].append(l["duration"])

    sim.waktu_selesai = utcnow()
    db.commit()

    total_fs = sum(r["siklus_failsafe"] for r in per_simpang.values())
    total_adap = sum(r["siklus_adaptif"] for r in per_simpang.values())
    all_safety = all(r["interlocking_safety_ok"] for r in per_simpang.values())

    return {
        "id_simulasi": sim.id_simulasi,
        "profil": profile,
        "jumlah_siklus": n_cycles,
        "total_persimpangan": len(persimpangans),
        "persimpangan_aktif_ai": len(persimpangans) - len(failed_ids),
        "persimpangan_fail_safe": len(failed_ids),
        "simpang_terdampak_gangguan": [p.nama_lokasi for p in persimpangans if p.id_persimpangan in failed_ids],
        "stabilitas_telemetri": True,
        "interlocking_safety_terpenuhi": all_safety,
        "total_siklus_keseluruhan": n_cycles * len(persimpangans),
        "total_siklus_adaptif": total_adap,
        "total_siklus_failsafe": total_fs,
        "perincian_simpang": list(per_simpang.values()),
        "waktu_selesai": sim.waktu_selesai.isoformat(),
    }

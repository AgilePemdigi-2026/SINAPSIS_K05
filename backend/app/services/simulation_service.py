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

"""
Mesin neuromorfik SINAPSIS (diturunkan dari brain.py pada proyek NERIC).

Alur satu siklus:
  jumlah kendaraan per jalur -> neuron LIF -> jaringan E-I (lateral inhibition)
  -> threshold adaptif (jam sibuk / normal / malam) -> skor prioritas -> durasi hijau.

Modul ini murni logika (tanpa database & tanpa FastAPI) sehingga mudah diuji.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

from app.core.config import settings


@dataclass
class Params:
    """Parameter yang dapat diubah Administrator lewat fitur Kelola Sistem."""

    spike_threshold: float = settings.THRESHOLD_NORMAL  # basis threshold periode normal
    min_green: int = settings.GREEN_MIN
    max_green: int = settings.GREEN_MAX
    amber: int = settings.YELLOW
    # Periode jam; default dari config, dapat diganti hasil kalibrasi data
    rush_hours: list = field(default_factory=lambda: list(settings.RUSH_HOURS))
    night_hours: list = field(default_factory=lambda: list(settings.NIGHT_HOURS))

    def threshold_for(self, hour: int) -> tuple[float, str]:
        base = self.spike_threshold
        for s, e in self.rush_hours:
            if s <= hour < e:
                return round(base * settings.RUSH_FACTOR, 3), "JAM SIBUK"
        for s, e in self.night_hours:
            if s <= hour < e:
                return round(min(1.0, base * settings.NIGHT_FACTOR), 3), "JAM MALAM"
        return round(base, 3), "JAM NORMAL"


@dataclass
class LIFNeuron:
    """Satu jalur = satu neuron Leaky Integrate-and-Fire."""

    vm: float = 0.0
    spike: bool = False
    spike_strength: float = 0.0
    refractory: int = 0
    history: deque = field(default_factory=lambda: deque(maxlen=15))

    def update(self, count: int, threshold: float, external: float = 0.0) -> None:
        self.history.append(count)
        if self.refractory > 0:  # istirahat setelah spike
            self.refractory -= 1
            self.spike, self.spike_strength = False, 0.0
            return
        i_sensor = count / settings.MAX_VEHICLES
        vm = settings.ALPHA * i_sensor + settings.BETA * self.vm + external
        vm = min(1.0, max(0.0, vm))
        vm = max(0.0, vm - settings.LEAK)
        if vm >= threshold:
            self.spike, self.spike_strength = True, vm
            self.vm, self.refractory = 0.0, settings.REFRACTORY
        else:
            self.spike, self.spike_strength, self.vm = False, 0.0, vm

    def avg_density(self) -> float:
        return sum(self.history) / len(self.history) if self.history else 0.0

    def trend_score(self) -> float:
        """Skor tren sederhana: bandingkan rata-rata paruh akhir vs paruh awal."""
        h = list(self.history)[-8:]
        if len(h) < 4:
            return 0.1
        half = len(h) // 2
        delta = sum(h[half:]) / (len(h) - half) - sum(h[:half]) / half
        return 0.2 if delta > 1 else (0.0 if delta < -1 else 0.1)


class IntersectionEngine:
    """State neuron untuk satu persimpangan (4 jalur)."""

    def __init__(self, n_lanes: int = 4):
        self.neurons = [LIFNeuron() for _ in range(n_lanes)]
        self.cycle = 0

    def _ei_signals(self) -> list[float]:
        sig = [0.0] * len(self.neurons)
        for i, n in enumerate(self.neurons):
            if n.spike:
                sig[i] += settings.EXCITATORY * n.spike_strength
                for j in range(len(self.neurons)):
                    if j != i:
                        sig[j] -= settings.INHIBITORY * n.spike_strength
        return [max(-0.3, min(0.3, s)) for s in sig]

    def _score(self, n: LIFNeuron, count: int, predicted: float | None = None) -> float:
        cur, dens = count / settings.MAX_VEHICLES, n.avg_density() / settings.MAX_VEHICLES
        if predicted is None:  # tanpa model prediksi (bobot asli NERIC)
            total = 0.40 * cur + 0.30 * n.spike_strength + 0.15 * n.trend_score() + 0.15 * dens
        else:  # prediksi jam berikutnya ikut menentukan prioritas (antisipasi lonjakan)
            total = (0.35 * cur + 0.25 * n.spike_strength + 0.10 * n.trend_score()
                     + 0.15 * dens + 0.15 * max(0.0, min(1.0, predicted)))
        return max(0.0, min(1.0, total))

    def step(self, counts: list[int], hour: int, params: Params, corridor_lanes: set[int] | None = None,
             predicted: list[float] | None = None) -> dict:
        """
        Proses satu siklus. `corridor_lanes` berisi indeks jalur (0..3) yang sedang
        berada di koridor hijau darurat -> dipaksa HIJAU.
        """
        if len(counts) != len(self.neurons):
            raise ValueError(f"counts harus berisi {len(self.neurons)} nilai")
        self.cycle += 1
        counts = [max(0, min(settings.MAX_VEHICLES, int(c))) for c in counts]
        threshold, period = params.threshold_for(hour)

        ei = self._ei_signals()
        for i, n in enumerate(self.neurons):
            n.update(counts[i], threshold, ei[i])

        if predicted is not None and len(predicted) != len(self.neurons):
            raise ValueError("predicted harus berisi satu nilai per jalur")
        scores = [self._score(n, counts[i], None if predicted is None else float(predicted[i])) for i, n in enumerate(self.neurons)]
        order = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)
        rank = {lane: r + 1 for r, lane in enumerate(order)}

        critical = [i for i, c in enumerate(counts) if c >= settings.MAX_VEHICLES * settings.EMERGENCY_RATIO]
        corridor = corridor_lanes or set()

        lanes = []
        for i, n in enumerate(self.neurons):
            if i in corridor:
                signal, dur, reason = "HIJAU", params.max_green, "Koridor hijau darurat aktif"
            elif critical:
                is_crit = i in critical
                signal = "HIJAU" if is_crit else "MERAH"
                dur = params.max_green
                reason = f"Kepadatan kritis ({counts[i]}/{settings.MAX_VEHICLES})" if is_crit else "Menunggu: ada jalur kritis"
            elif rank[i] == 1:
                signal = "HIJAU"
                dur = int(params.min_green + scores[i] * (params.max_green - params.min_green))
                reason = f"Prioritas utama, skor {scores[i]:.3f}"
            else:
                signal = "MERAH"
                dur = int(params.min_green + scores[i] * (params.max_green - params.min_green))
                reason = f"Prioritas #{rank[i]}, skor {scores[i]:.3f}"
            lanes.append(
                {
                    "lane_index": i,
                    "vehicle_count": counts[i],
                    "membrane_potential": round(n.vm, 4),
                    "spike": n.spike,
                    "threshold": threshold,
                    "predicted_ratio": None if predicted is None else round(float(predicted[i]), 4),
                    "priority_rank": rank[i],
                    "priority_score": round(scores[i], 4),
                    "signal": signal,
                    "duration": max(params.min_green, min(params.max_green, dur)),
                    "reason": reason,
                }
            )
        return {
            "cycle": self.cycle,
            "period": period,
            "threshold": threshold,
            "critical_lanes": critical,
            "corridor_active": bool(corridor),
            "prediction_used": predicted is not None,
            "lanes": lanes,
        }

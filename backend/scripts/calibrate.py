"""
Kalibrasi parameter LIF dari data (traffic.csv).  Jalankan dari root proyek:
    python scripts/calibrate.py

Langkah:
 1. Ambil timestamp yang memuat keempat junction (2017-01-01 s.d. 2017-06-30).
 2. Bagi kronologis: 50% awal = latih (kalibrasi), 50% akhir = uji.
 3. Periode jam (sibuk/malam) diturunkan dari profil jam rata-rata data latih.
 4. Threshold dasar dicari dengan grid search memaksimalkan F1 deteksi kepadatan.
 5. Bandingkan dengan nilai bawaan pada data uji, tulis data/calibration.json
    dan docs/calibration_report.md.

Label 'padat' (tanpa label manusia): jumlah kendaraan sebuah jalur >= persentil ke-85
data latih jalur itu.  Prediksi: neuron jalur itu spike pada langkah ini atau dalam
REFRACTORY langkah sebelumnya (neuron istirahat setelah spike).
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.core.config import settings  # noqa: E402
from app.services.neuromorphic import IntersectionEngine, Params  # noqa: E402
from app.services.sensor_source import CsvSensorSource  # noqa: E402

LABEL_PERCENTILE = 0.85


def percentile(vals, q):
    v = sorted(vals)
    return v[min(len(v) - 1, int(q * len(v)))]


def derive_periods(rows):
    """Jam sibuk = indeks kepadatan >= P75 antar 24 jam; malam = <= P25. Hasil dalam rentang (mulai, akhir)."""
    sums, cnt = [[0.0] * 4 for _ in range(24)], [0] * 24
    lane_mean = [sum(r["counts"][i] for r in rows) / len(rows) for i in range(4)]
    for r in rows:
        for i in range(4):
            sums[r["hour"]][i] += r["counts"][i] / lane_mean[i]
        cnt[r["hour"]] += 1
    idx = [sum(sums[h]) / (4 * cnt[h]) for h in range(24)]
    hi, lo = percentile(idx, 0.75), percentile(idx, 0.25)

    def ranges(sel):
        out, start = [], None
        for h in range(25):
            on = h < 24 and sel(idx[h])
            if on and start is None:
                start = h
            if not on and start is not None:
                out.append((start, h))
                start = None
        return out

    return ranges(lambda v: v >= hi), ranges(lambda v: v <= lo), idx


def evaluate(rows, params, labels_thr):
    eng, hist = IntersectionEngine(), [[False] * 4 for _ in range(settings.REFRACTORY + 1)]
    tp = fp = fn = tn = 0
    spikes_by_period = {"JAM SIBUK": [0, 0], "JAM NORMAL": [0, 0], "JAM MALAM": [0, 0]}
    for r in rows:
        out = eng.step(r["counts"], r["hour"], params)
        spk = [l["spike"] for l in out["lanes"]]
        hist = hist[1:] + [spk]
        sp = spikes_by_period[out["period"]]
        sp[0] += sum(spk)
        sp[1] += 4
        for i in range(4):
            pred = any(h[i] for h in hist)
            true = r["counts"][i] >= labels_thr[i]
            tp += pred and true
            fp += pred and not true
            fn += (not pred) and true
            tn += (not pred) and (not true)
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
    return {"precision": round(prec, 3), "recall": round(rec, 3), "f1": round(f1, 3),
            "spike_rate": {k: round(v[0] / v[1], 3) if v[1] else 0 for k, v in spikes_by_period.items()}}


def main():
    rows = CsvSensorSource().rows
    cut = len(rows) // 2
    train, test = rows[:cut], rows[cut:]
    thr = [percentile([r["counts"][i] for r in train], LABEL_PERCENTILE) for i in range(4)]
    rush, night, idx = derive_periods(train)

    default = Params()
    default_res = {"train": evaluate(train, default, thr), "test": evaluate(test, default, thr)}

    best = None
    for k in range(30, 91, 2):
        base = k / 100
        p = Params(spike_threshold=base, rush_hours=rush, night_hours=night)
        res = evaluate(train, p, thr)
        if best is None or res["f1"] > best[1]["f1"]:
            best = (base, res)
    cal = Params(spike_threshold=best[0], rush_hours=rush, night_hours=night)
    cal_res = {"train": best[1], "test": evaluate(test, cal, thr)}

    # kontrol: hanya threshold dikalibrasi, periode jam tetap bawaan
    only_best = None
    for k in range(30, 91, 2):
        p = Params(spike_threshold=k / 100)
        res = evaluate(train, p, thr)
        if only_best is None or res["f1"] > only_best[1]["f1"]:
            only_best = (k / 100, res)
    only_res = evaluate(test, Params(spike_threshold=only_best[0]), thr)

    out = {
        "data": {"timestamp_lengkap": len(rows), "latih": len(train), "uji": len(test),
                 "rentang": [rows[0]["timestamp"], rows[-1]["timestamp"]],
                 "ambang_label_padat_per_jalur": thr},
        "periode_hasil_kalibrasi": {"rush_hours": rush, "night_hours": night},
        "periode_bawaan": {"rush_hours": settings.RUSH_HOURS, "night_hours": settings.NIGHT_HOURS},
        "spike_threshold_dasar_hasil_kalibrasi": best[0],
        "spike_threshold_dasar_bawaan": settings.THRESHOLD_NORMAL,
        "hasil_bawaan": default_res,
        "hasil_kalibrasi_lengkap": cal_res,
        "hasil_hanya_threshold": {"threshold": only_best[0], "uji": only_res},
        "indeks_kepadatan_per_jam": [round(v, 3) for v in idx],
    }
    (ROOT / "data" / "calibration.json").write_text(json.dumps(out, indent=2))
    print(json.dumps({k: v for k, v in out.items() if k != "indeks_kepadatan_per_jam"}, indent=2))


if __name__ == "__main__":
    main()

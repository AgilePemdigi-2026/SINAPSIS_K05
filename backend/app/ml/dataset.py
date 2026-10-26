"""Penyusunan data latih/uji untuk prediksi kepadatan jam berikutnya."""
from __future__ import annotations

import csv
from datetime import datetime
from pathlib import Path

import numpy as np

DATA_CSV = Path(__file__).resolve().parents[2] / "data" / "traffic.csv"
WINDOW = 24  # jam riwayat yang dibutuhkan model
LAGS = (1, 2, 3, 4, 6, 12, 24)


def load_series(path: Path = DATA_CSV) -> dict[int, tuple[list[datetime], np.ndarray]]:
    """Per junction: (timestamp terurut, jumlah kendaraan per jam). Hanya rentang yang kontinu per jam."""
    raw: dict[int, dict[datetime, int]] = {}
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            raw.setdefault(int(r["Junction"]), {})[datetime.strptime(r["DateTime"], "%Y-%m-%d %H:%M:%S")] = int(r["Vehicles"])
    out = {}
    for j, d in raw.items():
        ts = sorted(d)
        out[j] = (ts, np.array([d[t] for t in ts], dtype=float))
    return out


def time_features(ts: datetime) -> list[float]:
    h, dow = ts.hour, ts.weekday()
    return [np.sin(2 * np.pi * h / 24), np.cos(2 * np.pi * h / 24),
            np.sin(2 * np.pi * dow / 7), np.cos(2 * np.pi * dow / 7), float(dow >= 5)]


def make_features(hist: np.ndarray, ts_list: list[datetime]) -> np.ndarray:
    """hist: (n, 24) rasio kepadatan; kolom terakhir = satu jam sebelum target."""
    cols = [hist[:, -k] for k in LAGS]
    cols += [hist.mean(axis=1), hist[:, -3:].mean(axis=1), hist[:, -1] - hist[:, -2]]
    tf = np.array([time_features(t) for t in ts_list])
    return np.column_stack(cols + [tf[:, i] for i in range(tf.shape[1])])


def build(cut_train: datetime, cut_val: datetime):
    """
    Pembagian kronologis global: latih < cut_train <= validasi < cut_val <= uji.
    Rasio = kendaraan / persentil-95 junction (dihitung dari data latih saja, tanpa kebocoran).
    """
    series = load_series()
    scale = {}
    for j, (ts, v) in series.items():
        tr = v[[t < cut_train for t in ts]]
        scale[j] = float(np.percentile(tr, 95))
    sets = {"train": [], "val": [], "test": []}
    for j, (ts, v) in series.items():
        r = v / scale[j]
        for i in range(WINDOW, len(ts)):
            if (ts[i] - ts[i - WINDOW]).total_seconds() != WINDOW * 3600:
                continue  # lompat waktu -> lewati
            part = "train" if ts[i] < cut_train else ("val" if ts[i] < cut_val else "test")
            sets[part].append((j, ts[i], r[i - WINDOW:i], r[i]))
    out = {}
    for k, rows in sets.items():
        hist = np.array([x[2] for x in rows])
        ts_list = [x[1] for x in rows]
        out[k] = {"hist": hist, "y": np.array([x[3] for x in rows]), "ts": ts_list,
                  "junction": np.array([x[0] for x in rows]), "X": make_features(hist, ts_list)}
    return out, scale

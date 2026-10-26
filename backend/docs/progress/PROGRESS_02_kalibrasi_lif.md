# Progress 02 — Kalibrasi Parameter LIF dari Data

Tanggal: 25 Oktober 2026 · Kelompok 5 · Pembangunan Perangkat Lunak (I4)
Terkait: Sprint 1 — F4 (Core AI Neuromorfik LIF) dan F6 (Parameter Sistem AI).

## 1. Yang dikerjakan

- `scripts/calibrate.py`: kalibrasi yang dapat diulang (`python scripts/calibrate.py`), menulis `data/calibration.json`.
- `Params` pada mesin LIF kini menerima daftar jam sibuk/malam (`rush_hours`, `night_hours`), tidak lagi terkunci pada konstanta.
- Nilai default di `app/core/config.py` diganti dengan hasil kalibrasi.
- Profil skenario sintetis (Rush Hour, Emergency, Night) disesuaikan dengan jam baru.
- 2 tes baru: kalibrasi dapat direproduksi dan cocok dengan config, serta hasil kalibrasi mengungguli bawaan pada data uji.
- Laporan lengkap: `docs/calibration_report.md`.

## 2. Hasil singkat

| | Bawaan lomba | Hasil kalibrasi |
|---|---|---|
| Threshold dasar | 0.55 | **0.76** |
| Jam sibuk | 07–09, 12–13, 16–19 | **12–13, 15–16, 19–23** |
| Jam malam | 22–05 | **02–09** |
| F1 pada data uji | 0.652 | **0.690** |
| Precision / Recall (uji) | 0.503 / 0.924 | 0.598 / 0.816 |

Pembagian data kronologis: 2.172 baris latih, 2.172 baris uji (dari 4.344 timestamp lengkap, Jan–Jun 2017).

## 3. Catatan jujur

- Perbaikan nyata tetapi kecil (+0.038 F1). Sumbangan terbesar dari threshold; periode jam hanya menambah sekitar 0.014.
- Label "padat" dibuat sendiri (persentil-85 kepadatan), karena dataset tidak memiliki label kemacetan. Jadi hasil ini **tidak membuktikan** LIF lebih baik dari ambang biasa maupun waktu tunggu berkurang.
- Pola jam di dataset berbeda dari asumsi lomba, tetapi kota dataset tidak diketahui. Jangan diklaim sebagai pola Surabaya.
- Parameter dinamika LIF (alpha, beta, leak, masa istirahat) belum dikalibrasi.

## 4. Dampak ke dokumen

1. **Default Spike Threshold** kini 0.76 (rasio). Dokumen masih menulis baseline 60 (Lo-Fi, persen), 0.85 (BDD), dan 18.5 (Hi-Fi). Perlu diseragamkan; usulan memakai rasio 0–1 dengan default 0.76.
2. **Data Mockup** menyebut jam sibuk secara implisit lewat label periode di arsitektur LIF; sebutkan jam hasil kalibrasi bila periode dicantumkan.
3. **Sprint Planning**: lihat koreksi di `PROGRESS_03_model_terlatih.md` bagian 4. Tabel sprint yang tercantum di versi awal file ini keliru karena memakai total poin Sprint 1 dan Sprint 2 dari dokumen Sprint1 tanpa menghitung ulang ukuran tiap fitur.

## 5. Status uji

35 tes otomatis lulus (`pytest -q`).

## 6. Langkah berikutnya

1. F12 — pembanding pengendali adaptif (LIF) vs timer tetap, memakai data yang sama.
2. F13 — model prediksi kepadatan jam berikutnya dari pola jam dan riwayat.
3. Pipeline video YOLOv8 setelah video tersedia.

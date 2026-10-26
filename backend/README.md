# SINAPSIS — Sistem AI Neuromorfik Adaptif Pengendali Arus Lalu Lintas

*Integrated AI Traffic Flow Analytics & Proactive Emergency Routing Platform — Studi Kasus: Persimpangan Padat*

Proyek praktikum **Pembangunan Perangkat Lunak (I4)**, Kelompok 5, Sistem Informasi, Fakultas Sains dan Teknologi, Universitas Airlangga, 2026.
Klien (studi kasus): Dinas Perhubungan (Dishub).

Backend ini diturunkan dari prototipe lomba **NERIC** (MSU iREX 2026), lalu disusun ulang agar mengikuti dokumen rekayasa perangkat lunak
(SRS, use case, CDM/PDM, class diagram) dan murni software (tanpa perangkat keras).

## Fitur

| Fitur | Aktor | Endpoint utama |
|---|---|---|
| Login & autentikasi role | Administrator, Petugas | `POST /api/auth/login` |
| Pantau kondisi lalu lintas | Keduanya | `GET /api/monitoring/dashboard`, `POST /api/monitoring/refresh`, `WS /ws/live` |
| Kelola sistem (persimpangan, parameter AI, pengguna, simulasi) | Administrator | `/api/admin/...` |
| Permintaan rute darurat & koridor hijau | Petugas | `/api/emergency/...` |
| Prediksi kepadatan jam berikutnya (model terlatih) | Keduanya | `GET /api/prediction/{id}`, `GET /api/prediction/model-info` |

Dokumentasi interaktif: `http://localhost:8000/docs` setelah server berjalan.

## Arsitektur

```
app/
├── main.py              # FastAPI app, lifespan, WebSocket
├── models.py            # Entity = tabel CDM/PDM (10 tabel)
├── schemas/             # Request model (Pydantic)
├── routers/             # Boundary: auth, monitoring, admin, emergency
├── services/            # Control: logika bisnis
│   ├── neuromorphic.py      # LIF + jaringan E-I + threshold adaptif (murni, tanpa DB)
│   ├── monitoring_service.py# sensor -> neuromorfik -> simpan DB, ringkasan dashboard
│   ├── routing_service.py   # Dijkstra berbobot kepadatan
│   ├── sensor_source.py     # CSV / sintetis / offline / video YOLOv8 (opsional)
│   ├── simulation_service.py
│   └── seed.py              # data demo
├── ml/                  # model terlatih: dataset, jaringan spiking LIF (NumPy), predictor
└── core/                # config, database, security (bcrypt + JWT + role)
data/                    # traffic.csv, road_graph.json, calibration.json, models/ (model terlatih)
scripts/calibrate.py     # kalibrasi parameter LIF dari data (laporan: docs/calibration_report.md)
scripts/train_models.py  # melatih & mengevaluasi model prediksi (laporan: docs/model_report.md)
tests/                   # 46 tes otomatis
docs/progress/           # catatan progres per tahap
```

Pembagian Boundary / Control / Entity mengikuti class diagram pada laporan.

## Menjalankan 

```bash
python -m venv venv
.\venv\Scripts\activate          # Windows: .\venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env              # lalu ubah SECRET_KEY
uvicorn app.main:app --reload
```

Database default adalah SQLite (`sinapsis.db`, dibuat otomatis). Untuk PostgreSQL ubah `DATABASE_URL`, misalnya
`postgresql+psycopg://user:pass@localhost/sinapsis` (dan `pip install psycopg[binary]`).

Akun demo (hanya saat `SEED_DEMO_DATA=true`, jangan dipakai di produksi):

| Username | Password | Role |
|---|---|---|
| `admin_sinapsis` | `adminSecure2026` | Administrator |
| `petugas_lalin01` | `petugasPass123` | Petugas Lalu Lintas |

## Pengujian

```bash
pytest -q
```

Tes mencakup skenario user story (login, pantau, kelola sistem, rute darurat), mesin LIF, dan pembobotan Dijkstra.

## AI yang dilatih

Sistem memiliki dua lapis AI:

1. **Model prediksi yang dilatih dari data** (`data/traffic.csv`): gradient boosting dan jaringan spiking LIF
   (surrogate gradient, NumPy murni) memperkirakan kepadatan tiap jalur pada jam berikutnya dari riwayat 24 jam.
   Evaluasi pada data uji kronologis (Mei–Jun 2017): MAE ensemble 0,1077 melawan 0,1338 pada pembanding "jam depan = jam ini".
   Detail dan keterbatasan: `docs/model_report.md`.
2. **Mesin keputusan LIF** (`services/neuromorphic.py`): neuron per jalur, threshold adaptif (parameter dikalibrasi dari data,
   `docs/calibration_report.md`), dan skor prioritas yang memakai hasil prediksi. Bagian ini berbasis aturan, bukan model terlatih.

Melatih ulang model (sekitar 2 menit, CPU biasa):

```bash
python scripts/train_models.py
```

Model tersimpan di `data/models/`. Jika model gradient boosting gagal dimuat karena beda versi scikit-learn,
sistem otomatis memakai jaringan spiking saja; jalankan perintah di atas untuk memulihkan ensemble.

## Sumber data (tanpa perangkat keras)

- `CsvSensorSource` memutar ulang `data/traffic.csv` (Traffic Prediction Dataset, 4 junction → 4 jalur Utara/Selatan/Timur/Barat).
- `SyntheticSensorSource` membangkitkan profil Normal, Rush Hour, Emergency, Night.
- `VideoSensorSource` (opsional) menghitung kendaraan dari file video dengan YOLOv8; aktifkan dengan memasang `ultralytics` dan `opencv-python-headless`.
- `OfflineSensorSource` mensimulasikan kamera mati untuk skenario *Sensor Offline*.

## Alur singkat

1. Sensor membaca jumlah kendaraan per jalur → disimpan ke `Deteksi`.
2. Neuron LIF per jalur menghitung membrane potential dan spike → `AktivitasNeuron`.
3. Skor prioritas menentukan jalur hijau dan durasinya → `KeputusanSinyal`.
4. Petugas mengajukan rute darurat; Dijkstra memilih rute, jalur yang dilewati dicatat di `DetailRute`.
5. Setelah diaktifkan, jalur pada rute dipaksa hijau di siklus berikutnya.

## Tim

Arya Satya Andhika Akbar (187241003), Hassya Azzamahksyari Oksigendaru (187241019), Muhammad Rizki Fahrezi (187241075), Ryandar Anugrah Fajr (187241094).

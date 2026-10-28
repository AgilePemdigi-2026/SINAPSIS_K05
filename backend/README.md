# SINAPSIS Backend

Backend FastAPI untuk SINAPSIS: sistem AI neuromorfik adaptif pengendali arus lalu lintas (Proyek PPL Kelompok 5, Universitas Airlangga, 2026).
Diturunkan dari prototipe lomba NERIC (MSU iREX 2026), lalu disusun ulang mengikuti SRS, use case, CDM/PDM, dan class diagram.
Petunjuk menjalankan dari awal (clone, venv, dashboard, akun demo) ada di [README utama](../README.md).

## Fitur

| Fitur | Aktor | Endpoint utama |
|---|---|---|
| Login dan autentikasi role | Administrator, Petugas | `POST /api/auth/login` |
| Pantau kondisi lalu lintas | Keduanya | Dashboard `/dashboard`; `GET /api/monitoring/dashboard`, `POST /api/monitoring/refresh` |
| Prediksi kepadatan jam berikutnya (model terlatih) | Keduanya | `GET /api/prediction/{id}`, `GET /api/prediction/model-info` |
| Kelola sistem (persimpangan, parameter AI, pengguna, simulasi) | Administrator | `/api/admin/...` |
| Permintaan rute darurat dan koridor hijau | Petugas | `/api/emergency/...` |

## Arsitektur

```
backend/
├── app/
│   ├── main.py              # Aplikasi FastAPI, halaman /dashboard, WebSocket
│   ├── models.py            # Entity = 10 tabel CDM/PDM
│   ├── schemas/             # Model request (Pydantic)
│   ├── routers/             # Boundary: auth, monitoring, prediction, admin, emergency
│   ├── services/            # Control: logika bisnis
│   │   ├── neuromorphic.py      # Mesin LIF + jaringan E-I + threshold adaptif (murni, tanpa DB)
│   │   ├── monitoring_service.py# Sensor -> LIF -> simpan DB, ringkasan dashboard
│   │   ├── routing_service.py   # Dijkstra berbobot kepadatan
│   │   ├── sensor_source.py     # CSV / sintetis / offline / video YOLOv8 (opsional)
│   │   ├── simulation_service.py
│   │   └── seed.py              # Data demo
│   ├── ml/                  # Model terlatih: dataset, jaringan spiking (NumPy), predictor
│   └── core/                # Konfigurasi, database, keamanan (bcrypt + JWT + role)
├── data/
│   ├── traffic.csv          # Dataset lalu lintas (4 junction, per jam)
│   ├── road_graph.json      # Graf jalan contoh untuk Dijkstra
│   ├── calibration.json     # Hasil kalibrasi parameter LIF
│   └── models/              # Model prediksi terlatih (gbm.joblib, snn.npz, metrics.json)
├── scripts/
│   ├── calibrate.py         # Kalibrasi parameter LIF dari data
│   └── train_models.py      # Melatih dan mengevaluasi model prediksi
├── tests/                   # 53 tes otomatis
└── docs/                    # Laporan kalibrasi, laporan model, catatan progres
```

Pembagian Boundary / Control / Entity mengikuti class diagram pada laporan. Folder `frontend/` berada di root repo (sejajar `backend/`)
dan disajikan oleh backend pada alamat `/dashboard`.

## Menjalankan

```bash
python -m venv venv
source venv/bin/activate          # Windows: .\venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env              # Windows: copy .env.example .env
uvicorn app.main:app --reload
```

Perlu Python 3.10 atau lebih baru. Database default adalah SQLite (`sinapsis.db`, dibuat otomatis). Untuk PostgreSQL ubah `DATABASE_URL`,
misalnya `postgresql+psycopg://user:pass@localhost/sinapsis` (dan `pip install "psycopg[binary]"`); dukungan ini belum diuji.

## Variabel lingkungan (`.env`)

| Variabel | Bawaan | Keterangan |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./sinapsis.db` | Alamat database |
| `SECRET_KEY` | (contoh) | Kunci penandatangan token. **Ganti** dengan teks acak yang panjang |
| `ACCESS_TOKEN_MINUTES` | `480` | Masa berlaku token login |
| `BCRYPT_ROUNDS` | `12` | Biaya hash password (turunkan hanya untuk pengujian) |
| `SEED_DEMO_DATA` | `true` | Mengisi akun dan persimpangan demo saat tabel kosong |
| `DASHBOARD_PUBLIC` | `true` | Dashboard terbuka tanpa login (mode Sprint 1). Ubah ke `false` setelah halaman login selesai |
| `PILOT_INTERSECTION_ID` | `1` | Persimpangan yang memutar ulang `traffic.csv` (yang lain memakai data sintetis) |
| `MAX_VEHICLES` | `20` | Kapasitas acuan per jalur untuk skala kepadatan |
| `EMERGENCY_RATIO` | `0.85` | Rasio kepadatan jalur yang dianggap Kritis |
| `FRONTEND_DIR` | (otomatis `../frontend`) | Lokasi folder frontend bila berbeda |

## Mode dashboard tanpa login

Pada Sprint 1 fitur Login (F1) belum dikerjakan, sehingga endpoint baca dan refresh pemantauan serta prediksi terbuka tanpa login
(`DASHBOARD_PUBLIC=true`). Kelola Sistem, Rute Darurat, dan `POST /api/monitoring/cycle` tetap wajib login.
Mode ini hanya untuk demo lokal; setel `false` bila server dapat dijangkau pihak lain.

## Ringkasan endpoint

| Metode dan alamat | Akses |
|---|---|
| `POST /api/auth/login`, `GET /api/auth/me` | Login / pengguna saat ini |
| `GET /api/monitoring/dashboard`, `POST /api/monitoring/refresh` | Terbuka bila `DASHBOARD_PUBLIC=true`, selain itu Administrator dan Petugas |
| `GET /api/monitoring/history/{id}` | Sama seperti di atas |
| `POST /api/monitoring/cycle` | Administrator dan Petugas |
| `GET /api/prediction/{id}`, `GET /api/prediction/model-info` | Sama seperti dashboard |
| `GET, POST /api/admin/intersections` | Administrator |
| `GET, PUT /api/admin/parameters`, `GET /api/admin/parameters/history` | Administrator |
| `GET, POST /api/admin/users` | Administrator |
| `POST /api/admin/simulations` | Administrator |
| `POST /api/emergency/search`, `POST /api/emergency/{id}/activate`, `/cancel`, `/complete`, `GET /api/emergency` | Petugas |
| `WS /ws/live?token=<JWT>` | Administrator dan Petugas (selalu butuh token) |

Dokumentasi interaktif lengkap: `http://127.0.0.1:8000/docs`.

## Alur singkat

1. Sensor membaca jumlah kendaraan per jalur, disimpan ke `Deteksi`.
2. Neuron LIF tiap jalur menghitung potensial membran dan spike, disimpan ke `AktivitasNeuron`.
3. Skor prioritas (dengan prediksi jam berikutnya) menentukan jalur hijau dan durasinya, disimpan ke `KeputusanSinyal`.
4. Petugas mengajukan rute darurat; Dijkstra memilih rute, jalur yang dilewati dicatat di `DetailRute`.
5. Setelah diaktifkan, jalur pada rute dipaksa hijau di siklus berikutnya.

## AI

- **Mesin LIF** (`services/neuromorphic.py`): parameter dikalibrasi dari data (`scripts/calibrate.py`, laporan di `docs/calibration_report.md`).
  Ambang spike: jam sibuk 0,44, normal 0,76, malam 0,996; periode jam sibuk 12–13, 15–16, 19–23 dan malam 02–09.
- **Model prediksi** (`app/ml/`, `scripts/train_models.py`): gradient boosting dan jaringan spiking LIF yang dilatih dengan surrogate gradient (NumPy, tanpa PyTorch).
  Hasil di `docs/model_report.md`. Bila `gbm.joblib` tidak dapat dimuat (beda versi scikit-learn), sistem memakai jaringan spiking saja;
  jalankan `python scripts/train_models.py` untuk memulihkan ensemble.
- Parameter AI dapat diubah administrator lewat `PUT /api/admin/parameters` (`spike_threshold`, `min_green_time`, `max_green_time`, `amber_duration`).

## Sumber data (tanpa perangkat keras)

- `CsvSensorSource` memutar ulang `data/traffic.csv` (4 junction menjadi 4 jalur Utara, Selatan, Timur, Barat). Satu siklus memajukan satu jam data.
- `SyntheticSensorSource` membangkitkan profil Normal, Rush Hour, Emergency, Night.
- `OfflineSensorSource` mensimulasikan kamera mati untuk skenario Sensor Offline.
- `VideoSensorSource` (opsional) menghitung kendaraan dari video dengan YOLOv8; aktifkan dengan memasang `ultralytics` dan `opencv-python-headless`. Belum diuji karena video belum tersedia.

## Pengujian

```bash
pytest -q
```

53 tes (52 bila folder `frontend/` tidak ada): login, pemantauan, kelola sistem, rute darurat, mesin LIF, kalibrasi, model terlatih, dan dashboard.

## Dokumentasi

- [`docs/calibration_report.md`](docs/calibration_report.md): kalibrasi parameter LIF
- [`docs/model_report.md`](docs/model_report.md): pelatihan dan evaluasi model prediksi
- [`docs/progress/`](docs/progress/): catatan progres tiap tahap

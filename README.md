# SINAPSIS Sistem AI Neuromorfik Adaptif Pengendali Arus Lalu Lintas

*Integrated AI Traffic Flow Analytics & Proactive Emergency Routing Platform Studi Kasus: Persimpangan Padat*

Proyek praktikum **Pembangunan Perangkat Lunak (I4)**, Kelompok 5, Sistem Informasi, Fakultas Sains dan Teknologi, Universitas Airlangga, 2026.
Klien (studi kasus): Dinas Perhubungan (Dishub).

## Tentang proyek

Lampu lalu lintas konvensional memakai durasi tetap (*fixed-timer*) sehingga tidak menyesuaikan kepadatan yang berubah-ubah,
dan kendaraan darurat harus menunggu seperti kendaraan biasa. SINAPSIS mengatur durasi lampu secara adaptif memakai model
neuron Leaky Integrate-and-Fire (LIF), memprediksi kepadatan jam berikutnya dengan model yang dilatih dari data, dan menyiapkan
koridor hijau untuk kendaraan darurat (algoritma Dijkstra). Seluruhnya dipantau lewat dashboard web untuk petugas Dishub.

Proyek ini murni perangkat lunak (tanpa perangkat keras). Sumber data lalu lintas berupa dataset yang diputar ulang;
deteksi kendaraan dari video (YOLOv8) belum diaktifkan.

## Struktur repositori

| Folder | Isi |
|---|---|
| `backend/` | API FastAPI + SQLite, mesin LIF, model prediksi terlatih, tes otomatis. Detail: [`backend/README.md`](backend/README.md) |
| `frontend/` | Antarmuka web (Dashboard Pemantauan). Detail: [`frontend/README.md`](frontend/README.md) |
| `docs/` | Dokumen kerja tim, termasuk [alur kerja Git](docs/GIT_WORKFLOW.md) |
| `legacy-neric/` | Arsip prototipe lomba NERIC (MSU iREX 2026). |

## Cabang (branch) dan versi yang dijalankan

| Branch | Isi |
|---|---|
| `main` | Hasil akhir tiap sprint yang sudah ditinjau PM. **Jalankan versi ini untuk melihat hasil final.** |
| `sprint-1`, `sprint-2`, `sprint-3` | Pekerjaan yang sedang berjalan pada sprint tersebut |
| `dev/<nama>` | Branch pribadi anggota untuk mencatat progres dan kontribusi |

Aturan lengkap ada di [`docs/GIT_WORKFLOW.md`](docs/GIT_WORKFLOW.md).

## Cara menjalankan

### Prasyarat

- Python **3.10 atau lebih baru** (diuji pada Python 3.12) dan `pip`
- Git
- Browser modern (Chrome, Edge, atau Firefox)

Tidak perlu memasang database atau Node.js. Database memakai SQLite dan dibuat otomatis.

### Langkah (Windows PowerShell)

```powershell
git clone https://github.com/AgilePemdigi-2026/SINAPSIS_K05.git
cd SINAPSIS_K05
cd backend
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload
```

### Langkah (macOS / Linux)

```bash
git clone https://github.com/AgilePemdigi-2026/SINAPSIS_K05.git
cd SINAPSIS_K05/backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```

Setelah muncul `Application startup complete.`, buka:

| Alamat | Isi |
|---|---|
| `http://127.0.0.1:8000/dashboard` | Dashboard Pemantauan Lalu Lintas |
| `http://127.0.0.1:8000/docs` | Dokumentasi API interaktif (Swagger) |

Sebelum dipakai bersama, ubah `SECRET_KEY` di file `.env` menjadi teks acak yang panjang.

### Akun demo

Dibuat otomatis saat server pertama kali berjalan (hanya untuk pengembangan, jangan dipakai di produksi).

| Username | Password | Peran |
|---|---|---|
| `admin_sinapsis` | `adminSecure2026` | Administrator |
| `petugas_lalin01` | `petugasPass123` | Petugas Lalu Lintas |

Dashboard pada Sprint 1 dapat dibuka **tanpa login** (fitur Login dikerjakan di Sprint 2). Untuk mencoba fitur yang wajib login
(Kelola Sistem, Rute Darurat) pakai halaman `/docs`: jalankan `POST /api/auth/login`, salin `access_token`, klik **Authorize**, lalu tempel.

### Menjalankan tes

```powershell
pytest -q
```

Hasil yang diharapkan: `53 passed` (52 lulus dan 1 dilewati bila folder `frontend/` tidak ditemukan).

### Melatih ulang model prediksi (opsional)

```powershell
python scripts/train_models.py
```

Membutuhkan sekitar 2 sampai 3 menit dan menimpa isi `backend/data/models/`. Jalankan bila muncul pesan `gbm.joblib tidak dapat dimuat`
(beda versi scikit-learn); sistem tetap berjalan memakai jaringan spiking saja sampai model dilatih ulang.

### Mengatasi masalah umum

| Gejala | Penyebab dan solusi |
|---|---|
| `ModuleNotFoundError` | Lingkungan virtual belum aktif atau paket belum terpasang. Jalankan `.\venv\Scripts\activate` lalu `pip install -r requirements.txt` |
| PowerShell menolak mengaktifkan venv | Jalankan `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, lalu ulangi |
| `Address already in use` | Server lain masih berjalan. Hentikan dengan `Ctrl+C`, atau pakai port lain: `uvicorn app.main:app --port 8001` |
| `/dashboard` menampilkan "Folder frontend tidak ditemukan" | Jalankan dari repo lengkap (folder `frontend/` sejajar `backend/`), atau atur `FRONTEND_DIR` di `.env` |
| Dashboard kosong saat pertama dibuka | Tunggu beberapa detik atau tekan **Refresh Data** |
| Ingin mengulang data dari awal | Hentikan server, hapus `backend/sinapsis.db`, jalankan lagi |

## Membaca dashboard

| Bagian | Arti |
|---|---|
| Diagram persimpangan | Empat lengan (Utara, Selatan, Timur, Barat). Panjang batang = jumlah kendaraan, lingkaran = lampu (hijau/merah) beserta durasinya, tulisan SPIKE = neuron jalur itu menembak |
| Daftar status simpang | Lancar, Padat (jalur terpadat ≥ 50% kapasitas), Kritis (≥ 85%). Klik baris untuk mengganti diagram |
| Banner merah | Peringatan kemacetan saat ada simpang Kritis |
| Banner kuning | Sensor offline pada sebagian simpang |
| Prediksi jam berikutnya | Perkiraan kepadatan jam depan dari model terlatih; batang merah melewati ambang peringatan dini |
| Matriks telemetri | Ringkasan tiap simpang dari siklus terakhir |
| Mode otomatis | Memajukan satu siklus data tiap 3, 5, atau 10 detik. Matikan lalu pakai **Refresh Data** untuk satu langkah manual |

Catatan: "Waktu data (simulasi dataset)" adalah waktu pada dataset (2017) yang diputar ulang, bukan waktu nyata.

**Mengapa spike jarang muncul?** Ambang spike mengikuti periode (hasil kalibrasi dari data): jam sibuk 0,44, jam normal 0,76, jam malam 0,996.
Pada jam normal sebuah jalur harus berisi sekitar 18 dari 20 kendaraan secara bertahan agar neuron menembak, sedangkan pada jam sibuk sekitar 12.
Pada jam malam neuron tidak mungkin menembak. Karena itu spike banyak terlihat pada jam sibuk dan hampir tidak ada pada jam normal atau malam.

Memicu banner kemacetan untuk demo: login di `/docs` lalu `POST /api/monitoring/cycle` dengan isi
`{"id_persimpangan": 1, "vehicle_counts": [19, 3, 3, 3], "simulated_hour": 20}`. Matikan "Mode otomatis" agar tampilan tidak langsung tertimpa siklus berikutnya.

## Komponen AI

| Komponen | Jenis | Dilatih dari data? | Keterangan |
|---|---|---|---|
| Mesin keputusan LIF | Model neuron (rumus) dengan threshold adaptif dan skor prioritas | Tidak; parameter **dikalibrasi** dari data | `backend/docs/calibration_report.md` |
| Prediksi kepadatan jam berikutnya | Gradient boosting + jaringan spiking LIF (ensemble) | **Ya**, dari `traffic.csv` | MAE uji 0,1077 melawan 0,1338 pada pembanding "jam depan = jam ini" (sekitar 19,5% lebih kecil). `backend/docs/model_report.md` |
| Rute darurat | Algoritma Dijkstra berbobot kepadatan | Tidak (algoritma klasik) | Koridor hijau memaksa jalur pada rute menjadi hijau |
| Deteksi kendaraan YOLOv8 | Computer vision | Bobot pralatih | Kode siap, **belum aktif** (belum ada video) |

Keterbatasan yang perlu diketahui:

- Yang dilatih adalah model **prediksi**, bukan keputusan lampu. Durasi hijau tetap dihitung mesin LIF dengan aturan.
- Dataset berupa hitungan kendaraan per jam dari kota yang tidak diketahui. Hasil bukan bukti kinerja di lapangan, dan pengurangan waktu tunggu belum dibuktikan (rencana F12).
- Evaluasi memakai satu pembagian data kronologis (uji: Mei–Jun 2017) dan satu kali pelatihan, tanpa interval kepercayaan.
- Label "padat" pada kalibrasi dibuat sendiri (persentil-85), karena dataset tidak memiliki label kemacetan.

## Tracker sprint

> **Aturan:** setiap sprint yang selesai ditulis di bagian ini oleh PM pada saat Sprint Review, lalu digabung ke `main`.
> Jangan menghapus atau menimpa sprint sebelumnya; tambahkan sprint baru di bawahnya.

### Burndown (poin)

| Titik | Ideal | Aktual |
|---|---|---|
| Awal | 43 | 43 |
| Akhir Sprint 1 | 27 | 27 |
| Akhir Sprint 2 | 12 | _(isi saat Sprint Review)_ |
| Akhir Sprint 3 | 0 | _(isi saat Sprint Review)_ |

Aktual hanya dikurangi untuk backlog yang memenuhi Definition of Done.

### Sprint 1  Fondasi backend, mesin AI, dan dashboard

- **Periode:** _(isi tanggal mulai – selesai)_
- **Status:** Berjalan _(ubah menjadi "Selesai" saat Sprint Review)_
- **Target:** 16 poin

| ID | Backlog | Poin | Status | Bukti |
|---|---|---|---|---|
| F2 | Dashboard pemantauan lalu lintas (diagram dan status simpang) | 4 | Berjalan | Halaman `/dashboard`, `backend/tests/test_dashboard_ui.py` |
| F4 | Core AI neuromorfik LIF (potensial membran dan spike) | 5 | Berjalan | `backend/app/services/neuromorphic.py`, `backend/docs/calibration_report.md` |
| F6 | Parameter sistem AI (spike threshold, durasi hijau) | 3 | API selesai; halaman Kelola Sistem belum | `PUT /api/admin/parameters`, `backend/tests/test_admin.py` |
| F13 | Prediksi kepadatan jam berikutnya (model terlatih) | 4 | Berjalan | `backend/docs/model_report.md`, `backend/tests/test_ml.py` |

**Hasil sampai saat ini**

- Backend FastAPI dengan 10 tabel sesuai CDM/PDM, 53 tes otomatis lulus.
- Mesin LIF dengan parameter dikalibrasi dari data (F1 uji 0,690 melawan 0,652 pada nilai awal).
- Dua model prediksi terlatih dan ensemble-nya, dievaluasi pada data uji kronologis.
- Dashboard pemantauan: diagram persimpangan, daftar status, peringatan kemacetan, Sensor Offline, prediksi, telemetri.
- Fitur di luar target Sprint 1 yang sudah ada di backend lebih awal: login role, kelola persimpangan dan pengguna, rute darurat, simulasi skenario.

**Belum dan keterbatasan**

- Halaman web untuk Login dan Kelola Sistem belum ada (Sprint 2).
- Umpan CCTV belum tersambung; jumlah kendaraan dari dataset.
- Dashboard dibuka tanpa login pada sprint ini (`DASHBOARD_PUBLIC=true`).
- Tampilan belum diuji pada banyak browser.

**Penanda:** tag `sprint-1-selesai` _(dibuat PM setelah `sprint-1` digabung ke `main`)_

### Sprint 2 Belum dimulai

Rencana backlog: F1 Login dan autentikasi role (3), F7 Registrasi pengguna (2), F5 Registrasi persimpangan (3), F3 Integrasi YOLOv8 (5), F12 Pembanding adaptif vs timer tetap (2) = 15 poin.
Sebagian backend fitur ini sudah dibuat lebih awal; yang dikerjakan di sprint ini adalah halaman web dan pengujiannya.

### Sprint 3 Belum dimulai

Rencana backlog: F8 Permintaan rute darurat (4), F9 Aktivasi koridor hijau (4), F10 Notifikasi kemacetan dan penanganan sensor offline (2), F11 Simulasi skenario (2) = 12 poin.

## Dokumentasi lanjutan

| Dokumen | Isi |
|---|---|
| [`backend/README.md`](backend/README.md) | Arsitektur, variabel lingkungan, daftar endpoint |
| [`backend/docs/calibration_report.md`](backend/docs/calibration_report.md) | Kalibrasi parameter LIF dari data |
| [`backend/docs/model_report.md`](backend/docs/model_report.md) | Pelatihan dan evaluasi model prediksi |
| [`backend/docs/progress/`](backend/docs/progress/) | Catatan progres tiap tahap |
| [`frontend/README.md`](frontend/README.md) | Folder frontend dan bentuk data API |
| [`docs/GIT_WORKFLOW.md`](docs/GIT_WORKFLOW.md) | Alur kerja Git kelompok |

## Tim

Kelompok 5 Sistem Informasi, Universitas Airlangga.

| Nama | NIM |
|---|---|
| Arya Satya Andhika Akbar | 187241003 |
| Hassya Azzamahksyari Oksigendaru | 187241019 |
| Muhammad Rizki Fahrezi | 187241075 |
| Ryandar Anugrah Fajr | 187241094 |

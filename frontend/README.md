# frontend — SINAPSIS

Antarmuka web SINAPSIS. Pada Sprint 1 berisi **Dashboard Pemantauan Lalu Lintas (F2)** berupa HTML, CSS, dan JavaScript murni
(sesuai SRS: "Web Application Modern: HTML5, CSS3, JavaScript, Map Canvas Vector"). Tidak perlu Node atau proses build.

## Isi

| File | Fungsi |
|---|---|
| `dashboard.html` | Kerangka halaman dan penanda elemen |
| `dashboard.css` | Gaya (tema merah SINAPSIS, tabel, diagram) |
| `dashboard.js` | Memanggil API, menggambar diagram SVG, daftar status, prediksi, telemetri |

## Menjalankan

Backend menyajikan folder ini otomatis. Dari folder `backend`:

```bash
uvicorn app.main:app --reload
```

Buka `http://127.0.0.1:8000/dashboard`. Berkas diakses sebagai `/static/<nama-file>`.
Lokasi folder dapat diganti dengan variabel lingkungan `FRONTEND_DIR`.

Selama mengubah file di sini, cukup muat ulang browser (Ctrl+F5). Tidak ada langkah build.

## API yang dipakai

| Endpoint | Keterangan |
|---|---|
| `GET /api/monitoring/dashboard` | Ringkasan semua simpang (dipakai saat halaman dibuka) |
| `POST /api/monitoring/refresh` | Memajukan satu siklus lalu mengembalikan ringkasan yang sama |
| `GET /api/prediction/{id}` | Prediksi jam berikutnya per jalur (opsional; sebagian sudah ada di ringkasan) |

Dokumentasi lengkap dan uji coba: `http://127.0.0.1:8000/docs`.
Pada Sprint 1 endpoint di atas terbuka tanpa login (`DASHBOARD_PUBLIC=true` di `backend/.env`). Setelah halaman login dibuat, token dikirim lewat header `Authorization: Bearer <token>`.

### Bentuk data ringkasan (`/api/monitoring/dashboard`)

Tingkat atas: `diperbarui` (UTC), `waktu_data` (waktu dataset), `simpang[]`, `congestion_alert`, `pesan_alert`, `pesan_sensor`,
`total_kendaraan`, `kapasitas_jalur`, `ambang_peringatan_dini_pct`.

Tiap `simpang[]`: `id_persimpangan`, `nama_lokasi`, `status` (`Lancar`, `Padat`, `Kritis`, `Sensor Offline`, `Belum ada data`),
`jumlah_kendaraan`, `sensor_offline`, `periode`, `siklus`, `ambang`, `jalur_terpadat`, `densitas_maks_pct`, `prediksi_maks_pct`,
`model_prediksi`, `status_algoritma`, `data_usang`, dan `jalur[]`.

Tiap `jalur[]`: `arah` (Utara, Selatan, Timur, Barat), `jumlah_kendaraan`, `densitas_pct`, `sinyal` (`HIJAU`/`MERAH`), `durasi`,
`spike`, `membrane_potential`, `peringkat`, `prediksi_rasio`, `alasan`.

## Aturan tampilan (dari Data Mockup)

- Tema merah SINAPSIS pada bilah atas; satu elemen dominan per layar (di dashboard: diagram persimpangan).
- Hijau dipakai hanya untuk arti harfiah (lampu hijau, status Lancar, aksi positif).
- Jangan menampilkan angka yang tidak punya sumber data (mis. kecepatan rata-rata): dataset hanya berisi jumlah kendaraan.

## Yang belum ada (Sprint berikutnya)

Halaman login, Kelola Sistem, Permintaan Darurat, Log Aktivitas, dan umpan video CCTV. Tab untuk halaman tersebut sudah ada di bilah atas dalam keadaan nonaktif.

## Bekerja di folder ini

Ikuti `docs/GIT_WORKFLOW.md`: kerjakan di branch pribadi (`dev/<nama>`), ubah hanya isi folder `frontend/`, lalu buka Pull Request ke branch sprint yang berjalan (mis. `sprint-1`) untuk ditinjau PM.
Bila nanti tim beralih ke framework (mis. React), buat subfolder baru dan arahkan `FRONTEND_DIR` ke hasil build-nya.

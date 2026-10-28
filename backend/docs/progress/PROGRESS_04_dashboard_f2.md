# Progress 04 — Dashboard Pemantauan Lalu Lintas (F2)

Tanggal: 26 Oktober 2026 · Kelompok 5 · Pembangunan Perangkat Lunak (I4)
Terkait: Sprint 1 — F2 "Dashboard Pemantauan Lalu Lintas Real-Time (Map & Status Simpang)", ukuran XL, 4 poin.
Login (F1) tidak termasuk Sprint 1, sehingga dashboard dibuka tanpa login.

## 1. Yang dikerjakan

- Halaman web `/dashboard` (HTML5, CSS3, JavaScript murni, sesuai SRS: "Web Application Modern (HTML5, CSS3, JavaScript, Map Canvas Vector)"). Berkasnya berada di folder **`frontend/`** (terpisah dari `backend/`) dan disajikan oleh backend. Tidak butuh Node atau proses build; cukup menjalankan server.
- Tata letak mengikuti Hi-Fi 4.3 (Data Mockup): bilah merah dengan navigasi, bilah status, banner alert, diagram skematik sebagai elemen utama, daftar status simpang, matriks telemetri, dan footer.
- Mode tanpa login (`DASHBOARD_PUBLIC=true`): hanya endpoint pemantauan (baca, refresh) dan prediksi yang terbuka. `cycle`, Kelola Sistem, dan Rute Darurat tetap wajib login.
- Payload dashboard diperkaya: rincian per jalur (jumlah kendaraan, densitas, sinyal, durasi, spike, peringkat, prediksi), periode, ambang, jalur terpadat, status algoritma, waktu data, dan ambang peringatan dini.
- 7 tes baru; total **53 tes lulus** (52 lulus dan 1 dilewati bila folder `frontend/` tidak ada).

### Revisi tampilan (27 Oktober 2026)

Tampilan awal dinilai terlalu seperti buatan templat dan diagram persimpangannya kurang terbaca. Perubahan:

- Gaya lebih tenang: font sistem, huruf biasa, bilah tabel terang, warna merah hanya untuk bilah atas dan keadaan kritis.
- Diagram persimpangan digambar seperti jalan sungguhan: aspal, marka, zebra cross, garis henti, antrean mobil di lajur masuk sisi kiri,
  kepala lampu per lengan, dan kartu info tiap arah (jumlah, persentase, bilah kepadatan, tanda Spike dan Koridor).
- Lima kartu ringkasan jaringan di atas diagram.
- Daftar status memuat bilah kepadatan; panel prediksi membandingkan kepadatan sekarang dengan prediksi jam berikutnya.
- Tata letak memakai flexbox biasa agar konsisten di berbagai browser.
- Lampu merah menampilkan teks "Merah", bukan angka. Angka sebelumnya adalah jatah hijau berikutnya sehingga menyesatkan.

## 2. Pemetaan ke SRS

| Persyaratan | Pemenuhan |
|---|---|
| REQ-7 Traffic Density Map, Intersection Status List, telemetri | Diagram skematik (SVG) dengan antrean mobil per jalur, daftar status, ringkasan per persimpangan |
| REQ-9 Peringatan kemacetan | Banner merah "Peringatan: Kemacetan Terdeteksi di Persimpangan ..." |
| REQ-10 Sensor Offline | Banner "Data pemantauan tidak tersedia untuk beberapa simpang." dan status "Sensor Offline" pada daftar |
| REQ-11 Refresh Data | Tombol Refresh Data dengan pesan "Data lalu lintas berhasil dimuat ulang." |
| Pembaruan berkala | Mode otomatis (3, 5, atau 10 detik) dan mode manual |

## 3. Perbedaan dari Hi-Fi (dan alasannya)

| Hi-Fi | Implementasi | Alasan |
|---|---|---|
| Kecepatan rata-rata, PCU/jam, V/C ratio, Total Phase Delay | Tidak ditampilkan; diganti total kendaraan, densitas maks, dan jalur terpadat | Dataset hanya berisi jumlah kendaraan; angka lain tidak ada sumbernya dan tidak boleh dikarang |
| "kendaraan/menit" | "Kendaraan" = jumlah pada siklus terakhir (4 jalur) | Satuan data adalah per siklus (per jam pada dataset) |
| CCTV live feed (dua thumbnail) | Panel keterangan "Umpan video belum tersambung" | Video belum tersedia |
| Tombol Aktifkan Koridor Hijau dan Kalibrasi Siklus AI di dashboard | Tidak ada | Membutuhkan login Petugas/Admin (di luar Sprint 1) |
| Lencana role di kanan atas | Tidak ada | Tidak ada login |
| Tab Kelola Sistem, Permintaan Darurat, Log Aktivitas | Tab ada tetapi nonaktif | Fitur belum dikerjakan |
| Tidak ada panel prediksi | Panel "Prediksi jam berikutnya" ditambahkan | Menampilkan model terlatih (F13) |
| "Map" pada nama backlog | Diagram skematik, bukan peta geografis | SRS menyebut "Map Canvas Vector" dan peta yang berupa placeholder; belum ada koordinat persimpangan di CDM |

## 4. Cara mencoba

```powershell
uvicorn app.main:app --reload
```
Buka `http://127.0.0.1:8000/dashboard`. Dashboard terisi sendiri pada pembukaan pertama. Beberapa hal yang bisa dicoba:
- Pilih simpang lain dari daftar status atau dropdown untuk mengganti diagram.
- Matikan "Mode otomatis" lalu tekan Refresh Data untuk memajukan satu siklus.
- Untuk memicu banner kemacetan: login di `/docs`, lalu `POST /api/monitoring/cycle` dengan `{"id_persimpangan": 1, "vehicle_counts": [19,3,3,3], "simulated_hour": 20}`. Dashboard akan menampilkan alert pada pembaruan berikutnya (matikan mode otomatis agar angkanya tidak langsung tertimpa siklus berikutnya).

## 5. Status uji

- 53 tes pytest lulus.
- Skrip dashboard dijalankan di lingkungan DOM (jsdom) dan diagramnya dirender menjadi gambar untuk diperiksa secara visual terhadap server sungguhan: render daftar status, diagram, metrik, prediksi, telemetri, interaksi pilih simpang, tombol Refresh, mode otomatis, serta kondisi alert, sensor offline, belum ada data, dan server mati. Tidak ada galat JavaScript.
- **Belum diuji di browser sungguhan.** Tampilan visual (warna, jarak, tata letak responsif) belum dilihat langsung dan perlu dicek di Chrome atau Edge.

## 6. Keterbatasan

- Pembaruan otomatis digerakkan oleh browser: setiap tab yang terbuka memajukan simulasi satu siklus per interval. Cukup untuk demo; bukan perilaku produksi.
- `DASHBOARD_PUBLIC=true` membuat pemantauan dapat dibuka siapa saja di jaringan yang bisa menjangkau server. Pakai hanya untuk demo lokal, dan set `false` setelah login selesai.
- Waktu data adalah waktu dataset (2017) yang diputar ulang, bukan waktu nyata. Ditampilkan terpisah dari jam sistem.
- Diagram selalu 4 lengan (Utara, Selatan, Timur, Barat), sesuai CDM (satu persimpangan = 4 jalur).
- Bagian prediksi hanya terisi pada simpang pilot (punya riwayat 24 jam dari dataset). Simpang lain butuh 24 siklus lebih dulu.

## 7. Langkah berikutnya

1. Cek tampilan di browser dan kirim tangkapan layar untuk penyesuaian visual.
2. Unggah ke GitHub lewat branch dan PR (alur di `docs/GIT_WORKFLOW.md`).
3. Perbarui dokumen Sprint (burndown 43 poin, tabel sprint, stand up).
4. F12, pipeline video, dan fitur Sprint 2 (Login, Kelola Sistem).

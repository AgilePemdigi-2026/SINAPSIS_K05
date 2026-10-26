# Progress 01 — Restrukturisasi Backend SINAPSIS

Tanggal: 25 Oktober 2026 · Kelompok 5 · Pembangunan Perangkat Lunak (I4)
Terkait: Sprint 1 (persiapan backend), backlog Feature 2, 4, 6 dan fondasi Feature 1, 8, 9.

## 1. Penilaian kode lama (NERIC)

| Komponen | Kondisi | Keputusan |
|---|---|---|
| `brain.py` (LIF, E-I, threshold adaptif, prioritas) | Logika bagus dan sudah teruji di lomba | Dipakai ulang, dipindah ke `services/neuromorphic.py` dan dibuat murni (tanpa DB/FastAPI) |
| `main.py` (642 baris, semua endpoint dalam satu file) | Sulit dirawat; tidak ada login, role, maupun manajemen pengguna | Dipecah ke `routers/` per fitur |
| InfluxDB + MQTT | Butuh server tambahan; MQTT untuk ESP32 tidak relevan karena proyek ini murni software | Diganti database relasional (SQLAlchemy). Data deteksi/neuron/keputusan masuk tabel CDM |
| `cv-backend/` (proses terpisah) | Dua backend terpisah menyulitkan | Digabung sebagai `VideoSensorSource` opsional |
| `Requirements.txt` | Terenkode UTF-16, memuat `venv` di repo | Diganti `requirements.txt` UTF-8 ringkas; `.gitignore` ditambahkan |
| Frontend React (`NericDashboard`) | Mengacu NERIC, bukan layar SINAPSIS | Belum disentuh (tahap berikutnya) |
| README | Masih NERIC | Ditulis ulang untuk SINAPSIS |

Kesimpulan: **inti AI dipertahankan, backend dirombak.** Alasannya, dokumen kuliah (CDM/PDM, class diagram, user story) menuntut login berbasis role, tabel relasional, dan pembagian Boundary/Control/Entity yang tidak ada di kode lama.

## 2. Hasil

- 10 tabel sesuai CDM/PDM: Pengguna, Persimpangan, Jalur, Deteksi, AktivitasNeuron, KeputusanSinyal, RuteDarurat, DetailRute (junction N-N), SimulasiSkenario, KonfigurasiSistem.
- Login bcrypt + JWT, dua role, pesan error persis seperti SRS.
- Dashboard: status Lancar/Padat/Kritis, congestion alert, Sensor Offline, Refresh Data, WebSocket `/ws/live`.
- Kelola Sistem: tambah persimpangan (otomatis 4 jalur), ubah parameter AI (tervalidasi, tercatat dengan waktu perubahan), tambah pengguna (aturan password: min. 8, kapital, angka), simulasi skenario (tidak mengotori tabel operasional).
- Rute darurat: Dijkstra berbobot kepadatan, koridor hijau memaksa jalur pada rute menjadi hijau, batal/selesai.
- Sumber data: `traffic.csv`, sintetis, offline, video YOLOv8 (opsional).
- **32 tes otomatis lulus** (`pytest -q`), ditambah uji jalan server nyata (login, refresh, WebSocket).

## 3. Pemetaan ke backlog Sprint

| Backlog | Status |
|---|---|
| F1 Login & Autentikasi Role | Backend selesai |
| F2 Dashboard Pemantauan | Backend selesai (belum ada UI) |
| F3 Integrasi YOLOv8 | Kerangka siap (`VideoSensorSource`), belum diuji dengan video |
| F4 Core LIF Engine | Selesai + uji unit |
| F5 Registrasi Persimpangan | Backend selesai (tanpa koordinat GIS) |
| F6 Parameter Sistem AI | Selesai |
| F7 Registrasi Pengguna | Selesai |
| F8–F9 Rute Darurat & Koridor Hijau | Selesai |
| F10 Congestion Alert & Sensor Offline | Selesai |
| F11 Simulasi Skenario | Selesai |

Catatan: backlog Sprint 1 resmi hanya F2, F4, F6. Pekerjaan ini melampaui itu karena fondasinya saling bergantung. Burndown Actual baru boleh dikurangi untuk fitur yang memenuhi Definition of Done setelah Sprint Review.

## 4. Ketidakkonsistenan dokumen yang perlu diputuskan tim

1. **Satuan Spike Threshold berbeda**: Lo-Fi memakai persen (75, baseline 60), BDD memakai 0.85, Hi-Fi memakai rasio 18.5 dengan batas 20. Kode memakai **rasio 0.05–1.0**. Dokumen sebaiknya diseragamkan.
2. **Persimpangan tanpa koordinat**: Lo-Fi/Hi-Fi memiliki Latitude/Longitude, tetapi CDM `Persimpangan` tidak. Backend mengikuti CDM. Jika koordinat dibutuhkan, tambahkan atribut di CDM dan PDM.
3. **Aktor "Pengemudi/Masyarakat"** muncul di tabel use case Pantau dan Rute Darurat, padahal Data Mockup menyatakan masyarakat tidak diberi akses. Backend hanya mengenal Administrator dan Petugas.
4. **Lokasi**: Hi-Fi menulis "Kota Bandung", Lo-Fi memakai "SIMPANG-JKT", contoh BDD memakai RSUD Dr. Soetomo (Surabaya). Graf jalan contoh memakai Surabaya.
5. **Level prioritas**: CDM berupa `Characters(30)`; kode menerima `High/Medium/Low`. Hi-Fi menulis "Prioritas 1: Ambulans".
6. **NIM** di SRS dan Data Mockup (187231xxx) berbeda dengan laporan dan Sprint1 (187241xxx).
7. **Laporan Minggu 10** masih memuat BPMN Poli THT RSUD, sedangkan domain sudah Dishub.

## 5. Asumsi dan batasan

- Graf jalan (`data/road_graph.json`) adalah contoh statis; persimpangan baru dari Admin belum otomatis masuk graf.
- Dataset punya 4 junction per timestamp, dipetakan ke 4 jalur satu persimpangan (pilot, seperti di NERIC). Junction 4 hanya punya 4.344 baris, jadi hanya timestamp lengkap yang diputar ulang.
- Hanya persimpangan pertama yang memakai data CSV, sisanya sintetis.
- Akun demo di seed hanya untuk pengembangan.
- Deteksi video belum diuji karena video dan bobot YOLO belum tersedia.

## 6. Langkah berikutnya (usulan)

1. Konfirmasi keputusan di bagian 4 (terutama satuan threshold dan koordinat).
2. Kirim video lalu lintas bila deteksi YOLOv8 ingin diaktifkan.
3. Ubah skenario BDD (Behat) menjadi tes `pytest-bdd`.
4. Sesuaikan frontend ke 6 layar Hi-Fi SINAPSIS dan sambungkan ke API ini.
5. Perbarui bagian Stand Up Agile pada dokumen Sprint.

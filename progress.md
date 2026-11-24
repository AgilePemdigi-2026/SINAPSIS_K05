# 🚦 SINAPSIS - Progress & Executive Project Summary

*Dokumen Pembaruan dan Rangkuman Perkembangan Proyek SINAPSIS*

## 1. Informasi Proyek & Tim

- **Nama Proyek:** SINAPSIS (Sistem AI Neuromorfik Adaptif Pengendali Arus Lalu Lintas)
- **Instansi:** Universitas Airlangga - Sistem Informasi (FST)
- **Tim Pengembang (Kelompok 5):**
  - Arya Satya Andhika Akbar (187241003)
  - Hassya Azzamahksyari Oksigendaru (187241019)
  - Muhammad Rizki Fahrezi (187241075)
  - Ryandar Anugrah Fajr (187241094)

## 2. Arsitektur & Spesifikasi Teknologi

- **Backend:** Python FastAPI (Modular Router, SQLAlchemy ORM, WebSockets real-time `/ws/live`).
- **Computer Vision Pipeline:** YOLOv8 (`yolo_service.py`) untuk deteksi kendaraan real-time dan anotasi bounding box.
- **Neuromorphic AI Core:** Leaky Integrate-and-Fire (LIF) Decision Engine untuk penyesuaian durasi sinyal hijau secara adaptif.
- **Frontend & Visualisasi:** Modern HTML5/CSS3, JavaScript, Leaflet.js (Map Canvas Vector), dan SVG Schematic Intersection Animation.

## 3. Rincian Fitur Utama & Progress Terkini

- [x] **Autentikasi & Management User (RBAC):** Login berbasis peran (Administrator dan Petugas Lalu Lintas).
- [x] **Modul Admin / Kelola Sistem (`admin_intersections.html` dan `admin.py`):**
  - Registrasi persimpangan baru dengan layout responsif (kolom kiri: form dan slot vision; kolom kanan: peta Leaflet, deskripsi arus, detektor loop virtual, serta tombol simpan).
  - Integrasi upload vision per lajur (Utara, Selatan, Timur, Barat) dengan pengolahan anotasi YOLOv8.
- [x] **Modul Dashboard Utama (`dashboard.html` dan `dashboard.js`):**
  - Visualisasi Diagram Skematik Persimpangan Aktif dengan animasi jumlah kendaraan real-time per lajur.
  - Widget Umpan CCTV dinamis yang menampilkan snapshot anotasi YOLOv8 sesuai ID Persimpangan yang dipilih.
  - Telemetri status persimpangan dan prediksi kepadatan jam berikutnya.
- [x] **Integrasi Pipeline End-to-End:**
  - Pemrosesan gambar vision -> inferensi YOLOv8 -> update database `Deteksi` -> kalkulasi neuromorfik LIF -> WebSocket push -> pembaruan indikator Dashboard.

## 4. Status Integrasi API & Endpoint Utama

- `POST /api/auth/login` - Autentikasi User
- `GET /api/monitoring/dashboard` dan `WS /ws/live` - Telemetri Monitoring Real-time
- `POST /api/vision/detect-image` - Inferensi YOLOv8 dan anotasi bounding box
- `POST /api/admin/intersections` - Registrasi dan manajemen node persimpangan

## 5. Rencana Pengembangan Selanjutnya (Next Steps)

- [ ] Penyempurnaan persistensi snapshot vision multi-persimpangan secara permanen pada database backend.
- [ ] Pengujian performa end-to-end latency (< 200 ms) pada skenario lalu lintas tinggi.
- [ ] Optimasi modul Proactive Emergency Routing (Koridor Hijau Darurat) menggunakan algoritma Dijkstra.

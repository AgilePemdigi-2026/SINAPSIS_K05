# Progress 06: F5 Kelola Sistem, Registrasi Persimpangan Baru (GIS)

Sumber: SRS 3.1.2 dan REQ-12/13, Data Mockup 4.2 (Hi-Fi), pembagian peran Sprint Minggu 12 (Fitur 5).

## Yang dikerjakan
- **Halaman** `/admin/intersections` (peta jaringan + tabel) dan `/admin/intersections/add` (form registrasi):
  breadcrumb, tab, sidebar "Modul Konfigurasi", form (nama lokasi wajib, latitude/longitude, deskripsi maks. 250 dengan penghitung,
  toggle Detektor Loop Virtual), panel Verifikasi Geo-spasial, tabel "Persimpangan Terdaftar" + Export Table (CSV).
- **Peta interaktif Leaflet 1.9.4** (disertakan di `static/vendor/leaflet`, tanpa CDN) dengan peta dasar OpenStreetMap:
  zoom (tombol +/- dan scroll setelah peta diklik), geser, tampilan awal menyesuaikan titik terdaftar, batas geser wilayah Indonesia.
  Pin berwarna menurut status dari `/api/monitoring/dashboard` (Lancar/Padat/Kritis/offline); nama simpang disembunyikan saat zoom jauh.
  **Mendaftar lewat peta**: pada halaman daftar, klik titik kosong lalu "Daftarkan di titik ini" membuka form dengan koordinat terisi;
  pada form, klik peta atau seret pin mengisi latitude/longitude, dan mengetik koordinat menggeser pin.
  Bila peta dasar gagal dimuat (offline), muncul pemberitahuan dan pin serta pengisian koordinat tetap berfungsi.
- **Backend**: kolom `latitude`, `longitude`, `detektor_virtual` pada `persimpangan`; validasi koordinat (berpasangan, -90..90, -180..180),
  deskripsi maks. 250; `ensure_schema()` menambah kolom ke `sinapsis.db` lama otomatis; seed mengisi koordinat perkiraan 4 simpang demo.
- Tautan "Kelola Sistem" di dashboard diaktifkan. Tampilan memakai palet dan komponen `dashboard.css` yang sama.
- **Tes**: `tests/test_intersections.py`, `tests/bdd/features/kelola_sistem.feature` (+ steps).

## Catatan
- Koordinat seed adalah PERKIRAAN untuk demo, bukan data survei. Peta dasar butuh internet saat demo (tile OpenStreetMap).
- Panel "Alokasi Perangkat" di Hi-Fi (kamera CAM-AI) diganti "Sumber Data Lajur" karena proyek ini simulasi tanpa perangkat keras.
- Tab "Parameter Sistem" dan "Tambah Pengguna" tampil nonaktif (API-nya sudah ada di `/api/admin/*`, UI belum).
- Akses halaman dibatasi: tanpa token diarahkan ke `/login`; peran selain Administrator melihat "Akses ditolak" (API tetap 403).

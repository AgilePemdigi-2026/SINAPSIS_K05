# PROGRESS 08 – F5: Parameter Sistem dan Tambah Pengguna (REQ-14, REQ-15)

Melengkapi modul Kelola Sistem: dua tab yang sebelumnya nonaktif kini berfungsi.

## Halaman
| Rute | Isi |
|---|---|
| `/admin/parameters` | Form Jenis Parameter + Nilai (validasi rentang/tipe), catatan teknis per parameter, notifikasi sukses dengan Transaction ID, tabel Parameter Aktif (nilai, satuan, baseline, rentang, status, aksi Ubah), riwayat perubahan |
| `/admin/users` | Daftar akun (nama, username, peran) + toast "Akun pengguna berhasil dibuat!" setelah redirect |
| `/admin/users/add` | Form Nama, Username (saran `xxx_dishub`), Kata Sandi Sementara (tampilkan/sembunyikan), Peran, info Hak Akses dinamis, Reset Isian |

Tab "Parameter Sistem" dan "Tambah Pengguna" aktif di semua halaman Kelola Sistem; sidebar mendapat tautan Parameter Sistem dan Manajemen Pengguna.

## Backend (perluasan, kompatibel)
- `GET /api/admin/parameters`: tambah `label`, `satuan`, `tipe`, `baseline`, `diubah_terakhir`.
- `PUT /api/admin/parameters`: tambah `id_transaksi` (TRX-nnnnnn), `waktu`, `catatan`.
- `GET /api/admin/parameters/history`: tambah `id_transaksi`, `diubah_oleh_nama`.
- `POST /api/admin/users`: respons memuat `role`.
- Rute halaman baru di `main.py` memakai `templates/admin_system.html`. Akses data tetap dibatasi API (hanya Administrator); non-admin melihat "Akses ditolak" tanpa memanggil API.

## Pengujian
- `tests/test_admin_system.py`, skenario BDD `kelola_parameter_pengguna.feature` (SRS: Update AI Threshold, Add New User Account).
- UAT Chromium: validasi (kosong/bukan angka/di luar rentang/bukan bulat), sukses + highlight baris, riwayat, reset, saran username, password lemah, username duplikat (409), redirect ke daftar, akses non-admin.

## Catatan / belum
- Kartu metrik mockup (Spike Sensitivity Index, dst.) dan panel "audit trail terdesentralisasi" tidak dibuat: datanya belum ada di sistem, dan tidak ingin menampilkan angka palsu.
- Parameter "Pedestrian Phase Extension" pada mockup belum ada di mesin sinyal, jadi belum tersedia.
- Submodul sidebar Konfigurasi Fase, Sensor & Kamera AI (domain Hassya), Kalibrasi Adaptif, Log Aktivitas masih "Segera hadir".

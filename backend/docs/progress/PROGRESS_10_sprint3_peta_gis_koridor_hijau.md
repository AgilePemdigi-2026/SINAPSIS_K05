# PROGRESS 10 - Sprint 3: Peta GIS 5 simpang, koridor hijau, loading state (Arya)

## Cakupan
- **Peta GIS di Dashboard** (Leaflet, vendored): 5 titik persimpangan berwarna menurut status kepadatan, popup (status, kendaraan, kepadatan, koordinat, tipe), daftar titik dengan koordinat, kolom Koordinat pada tabel ringkasan.
- **Persimpangan ke-5** pada seed: Simpang Kertajaya (koordinat perkiraan). Database lama otomatis ditambah persimpangan demo yang belum ada (hanya bila sudah memakai data demo).
- **Visualisasi Automated Green Corridor (Fitur 9)**: garis hijau beranimasi melintasi titik koridor, penanda bernomor berdenyut, banner "Mode darurat", chip di atas peta, tanda pada diagram dan daftar status persimpangan.
- **Loading state**: skeleton shimmer untuk KPI, diagram, daftar status, tabel, prediksi, dan peta; hilang saat data pertama tiba atau diganti pesan bila gagal dimuat. `prefers-reduced-motion` dihormati.

## Perubahan API (kompatibel mundur)
`GET /api/monitoring/dashboard` (juga siaran WebSocket) kini membawa:
- tiap item `simpang[]`: `latitude`, `longitude`, `koridor_hijau` (bool), `koridor` (`{emergency_id, urutan, total, jenis_kendaraan}` atau null);
- level atas `koridor_hijau[]`: `{emergency_id, jenis_kendaraan, diaktifkan, oleh, rute, urutan, tidak_terpetakan}`.

## Pemetaan koridor ke persimpangan
API koridor hijau (`/api/emergency/green-corridor/*`) menyimpan rute sebagai teks. Aturan di `services/corridor_view.py`:
1. `SIMPANG-03` / `SIMPANG03` / `3` -> persimpangan dengan `id_persimpangan` 3
2. nama persimpangan (tanpa membedakan huruf besar/kecil; `-` dan `_` dianggap spasi), mis. `SIMPANG-GUBENG`
Entri yang tidak cocok dilaporkan di `tidak_terpetakan` dan ditampilkan di chip peta.
Koridor yang statusnya bukan ACTIVE tidak digambar. Koridor berbasis database (`koridor_aktif` pada lajur) ikut menandai persimpangan.

## Berkas
- baru: `static/dashboard_map.js`, `services/corridor_view.py`, `tests/js/dashboard_map.test.js`, `tests/test_corridor_view.py`
- ubah: `static/dashboard.js`, `static/dashboard.css`, `templates/dashboard.html`, `services/monitoring_service.py`, `services/seed.py`
- tes disesuaikan karena seed kini 5 simpang: `test_monitoring.py`, `monitoring.feature`, `test_simulation_failsafe.py` (`total_persimpangan`, `persimpangan_adaptif`).

## Cara mencoba koridor hijau
Belum ada halaman UI untuk memicunya; gunakan `/docs`: `POST /api/emergency/green-corridor/activate` dengan
`{"emergency_id":"EMG-001","vehicle_type":"Ambulans","route_intersections":["SIMPANG-01","SIMPANG-03","SIMPANG-05"]}`,
lalu lepas dengan `POST /api/emergency/green-corridor/release/EMG-001`.

## Catatan
- Peta dasar memakai tile OpenStreetMap (perlu internet). Tanpa internet, titik, status, dan koridor tetap tampil dan muncul catatan.
- Koordinat Simpang Kertajaya perkiraan; sesuaikan dengan data GIS Ryandar bila berbeda.

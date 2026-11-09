# PROGRESS 07 – F5: Variasi lengan persimpangan (4 / 3 lengan)

Masukan presentasi: tidak semua persimpangan berbentuk perempatan. Sekarang satu persimpangan bisa punya
**3 lengan (pertigaan, lengan mana pun boleh tidak ada) atau 4 lengan (perempatan)** (Utara/Selatan/Timur/Barat). 2 lengan hanya ruas jalan biasa sehingga ditolak. Dipilih saat registrasi dan dipakai di seluruh sistem.

## Perubahan
- **Model data**: tidak ada perubahan skema. 1 lengan = 1 baris `Jalur`; jumlah baris menentukan bentuk (CDM: Persimpangan 1-N Jalur).
- **API**: `POST /api/admin/intersections` menerima `lengan` (opsional, default 4). Validasi: 3-4 lengan, nama dikenal, tanpa duplikat (422). Respons menambah `jumlah_lengan` dan `tipe` (Perempatan / Pertigaan). Daftar admin dan `GET /api/monitoring/dashboard` juga memuat `jumlah_lengan`, `tipe`.
- **Mesin & sensor**: engine LIF, sumber data sintetis, dan prediksi dibuat per jumlah lengan; `POST /api/monitoring/cycle` memvalidasi `vehicle_counts` sesuai jumlah lengan simpang itu. Simpang pilot (CSV) tetap 4 lengan. Routing darurat sudah melewati lengan yang tidak ada.
- **Registrasi (peta)**: pemilih lengan + pratinjau bentuk. Setelah titik dipilih, aplikasi membaca data jalan OpenStreetMap (Overpass API) di sekitar titik dan menyarankan lengan secara otomatis (sudut jalan dipetakan ke U/S/T/B; titik yang hanya ruas jalan tidak dianggap persimpangan). Pilihan admin tidak ditimpa; ada tombol "Pakai saran". Bila offline/gagal, muncul pesan dan pilih manual.
- **Dashboard**: diagram persimpangan hanya menggambar lengan yang ada (jalan, marka, zebra, lampu, antrean, label) dengan latar blok kota (gedung, taman) yang menyatu di sisi tanpa lengan, plus kompas; daftar status menandai simpang < 4 lengan.

## Pengujian
- `tests/test_arm_variants.py` (+ 3 skenario BDD di `kelola_sistem.feature`), `tests/js/arm_detect.test.js` (dijalankan dari pytest bila Node ada).
- UAT Chromium: deteksi T/perempatan, saran vs pilihan manual, blokir < 3 lengan, kegagalan Overpass, diagram 4 dan 3 lengan (semua orientasi).

## Catatan
- Deteksi otomatis butuh internet (Overpass API publik, bisa lambat/dibatasi). Tanpa itu, form tetap bisa dipakai manual.
- Peta berorientasi utara-di-atas, jadi arah lengan mengikuti arah mata angin; jalan diagonal dibulatkan ke arah terdekat.
- 4 simpang demo bawaan tetap perempatan (rute darurat bergantung pada lengan itu).

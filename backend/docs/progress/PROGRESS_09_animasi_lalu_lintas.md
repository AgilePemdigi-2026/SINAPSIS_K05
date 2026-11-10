# PROGRESS 09 – Animasi lalu lintas pada diagram dashboard

Masukan: diagram persimpangan terlalu statis. Diagram kini beranimasi dan **mengikuti data siklus terakhir**.

## Aturan tampilan
- **1 mobil/motor = 1 kendaraan** pada `jumlah_kendaraan`. Sebelumnya 1 ikon mewakili 2-3 kendaraan (maks. 8 ikon), sehingga data 20 hanya tampil 8 ikon; skema itu dihapus.
- **Lampu merah:** antrean diam. **Lampu hijau:** kendaraan dilepas satu per satu, melewati tengah persimpangan (lurus atau belok), lalu keluar lewat lajur keluar lengan tujuan.
- **Antrean selalu sama dengan data:** kendaraan baru datang dari tepi bila data naik; antrean terkuras lebih cepat bila data turun (hijau) atau kendaraan terakhir memudar (merah). Kendaraan yang sudah melintas tidak dihitung sebagai antrean.
- **Mengikuti lengan:** pertigaan hanya memakai lengan yang ada, tujuan belok tidak pernah ke lengan yang hilang. Lalu lintas sisi kiri (Indonesia).
- Campuran mobil (±70%) dan motor (±30%); layout 2 kolom saat antrean > 10; maksimal 24 kendaraan tampil per lengan (kapasitas data 20).
- Data usang/sensor offline: kendaraan berhenti (tidak ada yang dilepas).

## Teknis
- `static/traffic_anim.js`: simulasi murni (tanpa DOM), deterministik, diuji di Node. `dashboard.js` hanya merender node SVG dan menjalankan `requestAnimationFrame`.
- Simulasi bertahan antar render (polling 3/5/10 dtk), sehingga animasi tidak terputus saat data diperbarui; berganti persimpangan membuat simulasi baru yang langsung rapi sesuai data.
- Tombol **Animasi: hidup/mati** (disimpan di browser). Default mati bila sistem meminta `prefers-reduced-motion`. Saat mati: tampilan statis, tetap 1 kendaraan = 1 mobil.
- Performa: ±50-80 elemen SVG, ±60 fps pada uji Chromium; berhenti otomatis saat tab tidak aktif (rAF) dan saat diagram dilepas dari halaman.

## Pengujian
- `tests/js/traffic_anim.test.js` (12 uji: hitungan, merah diam, hijau melepas, naik/turun data, pertigaan, tanpa tumpang tindih 2 kolom, lintasan sisi kiri, determinisme), `tests/test_traffic_anim.py`.
- UAT Chromium: jumlah mobil per lengan, antrean merah diam, data berubah, pertigaan, tombol animasi + persist setelah reload, 0 error konsol.

## Catatan
- Mobil yang sedang melintas tidak ikut jumlah antrean, jadi total mobil di layar bisa sedikit di atas angka data saat hijau.
- Hanya tampilan: tidak mengubah keputusan lampu/algoritma. Durasi hijau tidak dihitung mundur secara visual karena data hanya memuat jatah durasi, bukan sisa waktu.

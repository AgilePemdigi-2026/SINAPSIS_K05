# Laporan Model Terlatih — Prediksi Kepadatan Jam Berikutnya (F13)

Skrip pelatihan: `scripts/train_models.py` · Hasil mentah: `data/models/metrics.json` · Dapat dilatih ulang dengan `python scripts/train_models.py` (sekitar 2 menit di CPU biasa).

## 1. Tujuan

Memberi sistem komponen AI yang **benar-benar dilatih dari data**: memperkirakan kepadatan tiap jalur pada jam berikutnya dari riwayat 24 jam dan waktu (jam, hari). Hasilnya dipakai untuk (a) peringatan dini kepadatan dan (b) ikut menentukan skor prioritas jalur di mesin keputusan LIF.

## 2. Data dan pembagian

- Sumber: `data/traffic.csv`, jumlah kendaraan per jam untuk 4 junction (Junction 1–3: Nov 2015 – Jun 2017, Junction 4: Jan – Jun 2017).
- Kepadatan dinyatakan sebagai **rasio** = kendaraan / persentil-95 junction (dihitung dari data latih saja, tanpa kebocoran).
- Pembagian **kronologis**: latih sebelum 1 Mar 2017 (36.312 sampel), validasi Mar–Apr 2017 (5.856), uji mulai 1 Mei 2017 (5.856).
- Masukan model: rasio 24 jam terakhir, jam, hari dalam seminggu. Keluaran: rasio jam berikutnya.
- Pemilihan model dan hiperparameter memakai **data validasi**. Data uji hanya dipakai untuk pelaporan akhir.

## 3. Model

| Model | Keterangan |
|---|---|
| Persistensi | Pembanding: jam depan = jam ini |
| Seasonal-naive 24 jam | Pembanding: jam depan = jam yang sama kemarin |
| Gradient Boosting | scikit-learn `HistGradientBoostingRegressor`; hiperparameter dipilih lewat grid pada validasi (learning rate 0,05, kedalaman 3, min. 60 sampel per daun) |
| **Jaringan spiking LIF terlatih** | 48 neuron LIF, arus masukan langsung, keluaran dari laju spike dan potensial membran akhir lewat regresi linear. Dilatih dengan **surrogate gradient** dan BPTT, ditulis sendiri dengan NumPy (tanpa PyTorch), 100 epoch, optimizer Adam. Gradien diverifikasi dengan beda hingga (galat relatif sekitar 1e-9) |
| Ensemble | Rata-rata Gradient Boosting dan jaringan spiking; terpilih sebagai model aktif karena MAE validasinya terkecil |

## 4. Hasil pada data uji (Mei–Jun 2017)

| Model | MAE | RMSE | WAPE | F1 peringatan dini |
|---|---|---|---|---|
| Persistensi | 0,1338 | 0,1999 | 16,4% | 0,873 |
| Seasonal-naive 24 jam | 0,1935 | 0,3005 | 23,7% | 0,803 |
| Gradient Boosting | 0,1173 | 0,1831 | 14,4% | 0,897 |
| Jaringan spiking LIF terlatih | 0,1101 | 0,1691 | 13,5% | 0,891 |
| **Ensemble** | **0,1077** | **0,1670** | **13,2%** | 0,897 |

MAE lebih kecil dibanding persistensi: Gradient Boosting 12,3%, jaringan spiking 17,7%, ensemble 19,5%.
Peringatan dini = memprediksi jam berikutnya akan "padat" (rasio ≥ 0,80, persentil-85 data latih).

MAE per junction (uji):

| Junction | Persistensi | Gradient Boosting | Spiking | Ensemble |
|---|---|---|---|---|
| 1 | 0,0891 | 0,0688 | 0,0602 | 0,0608 |
| 2 | 0,1557 | 0,1679 | 0,1402 | 0,1377 |
| 3 | 0,1157 | 0,0926 | 0,0947 | 0,0916 |
| 4 | 0,1748 | 0,1400 | 0,1454 | 0,1408 |

## 5. Temuan

1. Semua model terlatih mengalahkan pembanding pada data uji. Jaringan spiking (neuron LIF) menjadi model tunggal terbaik, dan ensemble sedikit lebih baik lagi.
2. Pada Junction 2, Gradient Boosting **lebih buruk** dari persistensi (0,1679 vs 0,1557). Junction 2 bervolume kecil (persentil-95 hanya 20 kendaraan per jam), sehingga hitungannya berisik. Ensemble dan jaringan spiking tetap lebih baik di sana.
3. Keuntungan pada peringatan dini lebih kecil daripada pada MAE (F1 0,873 menjadi 0,897).

## 6. Keterbatasan (perlu ditulis di laporan)

- **Satu kali pelatihan dan satu pembagian data.** Tidak ada interval kepercayaan. Kurva validasi jaringan spiking cukup berfluktuasi (MAE 0,102–0,116 antar-epoch), jadi selisih antar-model yang kecil sebaiknya tidak dibesar-besarkan.
- **Periode uji hanya dua bulan** (Mei–Jun 2017) dan dari satu dataset yang kotanya tidak diketahui. Hasilnya bukan bukti kinerja di Surabaya.
- **Yang dilatih adalah model prediksi, bukan keputusan lampu.** Durasi dan urutan hijau tetap dihitung oleh LIF dan skor prioritas dengan aturan buatan. Bobot prediksi di skor (0,15) ditetapkan tangan dan belum dituning.
- **Belum ada bukti pengaruh ke waktu tunggu.** Itu tujuan F12 (pembanding adaptif vs timer tetap).
- **Asumsi satu siklus = satu jam.** Model dilatih pada data per jam. Pada mode CSV tiap siklus memajukan satu jam data, sehingga sesuai. Bila nanti sumber datanya video (hitungan per detik/menit), hitungannya harus diagregasi per jam dulu sebelum masuk ke model.
- **Sedikit pergeseran skala saat dijalankan.** Saat pelatihan rasio memakai persentil-95 data latih; saat berjalan rasio = hitungan / 20, dengan hitungan CSV diskalakan memakai persentil-95 seluruh data dan dipotong di 20. Perbedaannya kecil tetapi ada.
- **Model Gradient Boosting disimpan dengan joblib**, sehingga bergantung pada versi scikit-learn. Bila gagal dimuat, sistem otomatis memakai jaringan spiking saja (tetap jalan). Pulihkan ensemble dengan menjalankan ulang `python scripts/train_models.py`.
- Hanya Junction 1–3 yang punya riwayat panjang; Junction 4 hanya Jan–Jun 2017 (1.392 sampel latih), sehingga paling sedikit belajar darinya.

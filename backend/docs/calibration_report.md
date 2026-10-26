# Laporan Kalibrasi Parameter LIF (F4 & F6)

Skrip: `scripts/calibrate.py` · Hasil mentah: `data/calibration.json` · Dapat diulang dengan `python scripts/calibrate.py`.

## 1. Tujuan

Parameter LIF dari prototipe lomba (threshold dasar 0.55, jam sibuk 7–9, 12–13, 16–19, malam 22–05) ditentukan tangan. Kalibrasi ini menurunkan nilainya dari data `traffic.csv` agar default Kelola Sistem (F6) punya dasar.

## 2. Data dan metode

- Dipakai hanya timestamp yang memuat keempat junction: **4.344 baris**, 1 Jan – 30 Jun 2017 (Junction 4 hanya ada pada periode ini).
- Pembagian kronologis: **2.172 baris latih** (awal) dan **2.172 baris uji** (akhir). Kalibrasi hanya melihat data latih.
- **Periode jam**: indeks kepadatan per jam (dinormalkan per jalur). Jam sibuk = indeks di atas persentil-75 dari 24 jam, jam malam = di bawah persentil-25.
- **Threshold dasar**: grid search 0.30–0.90 (langkah 0.02) memaksimalkan F1.
- **Label "padat"**: jumlah kendaraan sebuah jalur ≥ persentil-85 data latih jalur itu (ambang 19, 17, 17, 17). Dataset tidak memiliki label kemacetan, jadi label ini buatan.
- **Prediksi**: neuron jalur spike pada langkah itu atau dalam 3 langkah sebelumnya (masa istirahat neuron).

## 3. Hasil

| Konfigurasi | Data | Precision | Recall | F1 |
|---|---|---|---|---|
| Bawaan lomba (0.55, jam lama) | latih | 0.339 | 0.900 | 0.492 |
| Bawaan lomba (0.55, jam lama) | **uji** | 0.503 | 0.924 | **0.652** |
| Kalibrasi threshold saja (0.78) | **uji** | 0.599 | 0.776 | 0.676 |
| **Kalibrasi lengkap (0.76 + jam baru)** | latih | 0.429 | 0.791 | 0.557 |
| **Kalibrasi lengkap (0.76 + jam baru)** | **uji** | 0.598 | 0.816 | **0.690** |

Nilai hasil kalibrasi (sudah dipasang di `app/core/config.py`):

- `THRESHOLD_NORMAL = 0.76`
- Jam sibuk: **12–13, 15–16, 19–23** (bawaan lomba: 7–9, 12–13, 16–19)
- Jam malam: **02–09** (bawaan lomba: 22–05)

Laju spike per periode pada data uji (kalibrasi lengkap): sibuk 29,1%, normal 5,0%, malam 0%. Pada konfigurasi bawaan: sibuk 25,1%, normal 12,6%, malam 3,1%. Jadi perilaku adaptifnya (banyak spike saat sibuk, jarang saat sepi) lebih tegas.

## 4. Temuan

1. Pola jam pada dataset berbeda dari asumsi lomba. Kepadatan tertinggi ada sekitar pukul 10–12 dan 19–22, sedangkan terendah pukul 03–06. Dataset ini tidak menyebutkan kotanya, jadi pola ini tidak boleh diklaim sebagai pola Surabaya.
2. Kalibrasi menaikkan F1 uji dari 0.652 menjadi 0.690 (+0.038). Precision naik (0.503 → 0.598), recall turun (0.924 → 0.816): sistem lebih jarang memberi alarm palsu tetapi sedikit lebih sering melewatkan kepadatan.
3. Kalibrasi periode jam hanya menambah sekitar 0.014 F1 dibanding kalibrasi threshold saja. Sumbangan terbesar datang dari threshold.

## 5. Keterbatasan (perlu ditulis di laporan)

- **Label buatan.** Karena label "padat" adalah ambang kepadatan, F1 mengukur seberapa baik dinamika LIF (kebocoran, masa istirahat, inhibisi) mereproduksi ambang itu. Ini **bukan bukti** bahwa LIF lebih unggul dari ambang sederhana atau bahwa waktu tunggu berkurang.
- **Data per jam.** LIF dirancang untuk siklus lampu berdurasi detik; dataset ini hanya stand-in.
- **Enam bulan data.** Periode jam sibuk yang terpecah (12–13 dan 15–16 hanya satu jam) kemungkinan noise dari data yang pendek, bukan pola nyata.
- **Hanya 4.344 baris lengkap.** Data 2015–2016 tidak terpakai karena Junction 4 belum ada saat itu.
- Faktor jam sibuk (0.58) dan malam (1.31) diwarisi dari NERIC, tidak dikalibrasi.
- Parameter dinamika LIF (alpha 0.70, beta 0.30, leak 0.08, masa istirahat 3) tidak dikalibrasi pada tahap ini.

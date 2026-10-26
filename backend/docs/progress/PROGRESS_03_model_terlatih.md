# Progress 03 — Model AI Terlatih (F13) dan Finalisasi Sprint 1

Tanggal: 25 Oktober 2026 · Kelompok 5 · Pembangunan Perangkat Lunak (I4)
Terkait: Sprint 1 — F2 (Dashboard), F4 (Core AI LIF), F6 (Parameter AI), ditambah F13 (Prediksi kepadatan, model terlatih).

## 1. Yang dikerjakan

- **Dua model terlatih** untuk memprediksi kepadatan tiap jalur pada jam berikutnya:
  - Gradient Boosting (scikit-learn).
  - Jaringan spiking LIF yang dilatih dengan surrogate gradient dan BPTT, ditulis dengan NumPy (tanpa PyTorch). Turunan gradiennya diverifikasi dengan beda hingga.
  - Model aktif: ensemble keduanya (MAE validasi terkecil). Bila salah satu gagal dimuat, sistem tetap berjalan dengan model yang tersisa.
- `scripts/train_models.py`: pelatihan dan evaluasi yang dapat diulang. Data dibagi kronologis (latih, validasi, uji), dengan pembanding persistensi dan seasonal-naive.
- **Integrasi ke mesin keputusan**: prediksi masuk ke skor prioritas jalur (bobot 0,15). Tanpa model, skor memakai bobot asli.
- **API baru**: `GET /api/prediction/{id_persimpangan}` (prediksi per jalur + peringatan dini) dan `GET /api/prediction/model-info` (ringkasan evaluasi).
- Hasil siklus (`/api/monitoring/cycle`) kini memuat `predicted_ratio` per jalur dan nama model.
- Simpang pilot ditetapkan lewat konfigurasi (`PILOT_INTERSECTION_ID`, default 1), sebelumnya ditentukan oleh urutan akses.
- **46 tes otomatis lulus** (11 tes baru untuk bagian model dan integrasinya). Server juga dijalankan sungguhan dan dicoba lewat HTTP.
- Laporan model: `docs/model_report.md`.

## 2. Hasil evaluasi (data uji, Mei–Jun 2017)

| Model | MAE | F1 peringatan dini |
|---|---|---|
| Persistensi (pembanding) | 0,1338 | 0,873 |
| Gradient Boosting | 0,1173 | 0,897 |
| Jaringan spiking LIF terlatih | 0,1101 | 0,891 |
| **Ensemble (aktif)** | **0,1077** | 0,897 |

Penurunan MAE dibanding pembanding: ensemble 19,5%, jaringan spiking 17,7%, Gradient Boosting 12,3%.

## 3. Cara menjelaskan di laporan atau presentasi

- Boleh: "Sistem memiliki model prediksi kepadatan yang **dilatih dari dataset lalu lintas** (gradient boosting dan jaringan spiking LIF), dievaluasi pada data uji kronologis, dan hasilnya dipakai pada peringatan dini serta skor prioritas jalur."
- Tidak boleh: "keputusan lampu dilatih". Durasi dan urutan hijau tetap dihitung oleh LIF dan skor prioritas dengan aturan buatan. Yang dilatih adalah prediksinya.
- Tidak boleh: mengklaim waktu tunggu berkurang. Itu baru dibuktikan lewat F12.

## 4. Koreksi sprint (penting)

Saat menyusun ulang tabel sprint, ukuran tiap fitur kuhitung ulang dan ditemukan **selisih pada dokumen Sprint1**:

| Sprint | Fitur | Poin sebenarnya | Tertulis di dokumen Sprint1 |
|---|---|---|---|
| Sprint 1 | F2 (4) + F4 (5) + F6 (3) | **12** | 13 |
| Sprint 2 | F1 (3) + F7 (2) + F5 (3) + F3 (5) | **13** | 12 |
| Sprint 3 | F8 (4) + F9 (4) + F10 (2) + F11 (2) | 12 | 12 |

Total 37 tetap benar, tetapi sisa ideal setelah Sprint 1 seharusnya **25**, bukan 24. Total per ukuran (3 fitur M, 3 L, 3 XL, 2 XXL) pada dokumen sudah benar.

Usulan rencana baru dengan F12 (Pembanding adaptif vs timer tetap, ukuran M, 2 poin) dan F13 (Prediksi kepadatan terlatih, ukuran XL, 4 poin; XL karena memuat dua model, integrasi, dan evaluasi):

| Sprint | Backlog | Poin | Sisa ideal |
|---|---|---|---|
| Start | | 43 | 43 |
| Sprint 1 | F2, F4, F6, **F13** | 16 | 27 |
| Sprint 2 | F1, F7, F5, F3, **F12** | 15 | 12 |
| Sprint 3 | F8, F9, F10, F11 | 12 | 0 |

Titik Ideal Burndown menjadi 43 → 27 → 12 → 0. Burndown Actual tetap baru dikurangi setelah Sprint Review dengan Definition of Done terpenuhi.

## 5. Status dan keterbatasan

- F2, F4, F6, dan F13: sisi backend selesai dan teruji. Dashboard F2 baru berupa API (belum ada tampilan website).
- Satu pelatihan dan satu pembagian data, tanpa interval kepercayaan. Periode uji hanya dua bulan dari dataset yang kotanya tidak diketahui.
- Pada Junction 2, Gradient Boosting lebih buruk dari pembanding (ensemble tetap lebih baik).
- Bobot prediksi di skor prioritas (0,15) belum dituning.
- Mode CSV menganggap satu siklus = satu jam data. Sumber video nanti harus diagregasi per jam.
- Model Gradient Boosting bergantung pada versi scikit-learn. Bila gagal dimuat, jalankan `python scripts/train_models.py` ulang.
- Belum diuji di mesin pengguna setelah F13 (dijalankan hanya di lingkungan pengembangan ini).

## 6. Langkah berikutnya

1. Coba di VS Code (pasang ulang dependensi: `pip install -r requirements.txt`), lalu cek `/api/prediction/1`.
2. Perbarui dokumen Sprint (burndown 43 poin, tabel sprint, stand up).
3. F12: pembanding pengendali adaptif vs timer tetap.
4. Pipeline video YOLOv8 setelah video tersedia.

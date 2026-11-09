# Service Deteksi Kendaraan YOLO

## Ringkasan

Modul [`yolo_service.py`](./yolo_service.py) mengenkapsulasi inferensi
computer vision pada satu frame kamera. Service memuat model YOLOv8 secara
lazy, menjalankan prediksi, menyaring hasil menjadi kelas kendaraan yang
relevan, memetakan setiap kendaraan ke jalur berdasarkan posisi bounding box,
dan mengembalikan ringkasan serta detail deteksi.

Dependensi `ultralytics` diimpor hanya saat model dimuat. Dengan demikian,
modul dapat diimpor oleh aplikasi tanpa memaksa seluruh deployment memasang
dependensi YOLO pada saat startup.

## Konfigurasi model

- **Model default:** `yolov8n.pt`
- **Pemuat model:** `load_model(weights="yolov8n.pt")`
- **Confidence threshold default:** `0.15`
- **Rentang threshold yang valid:** `0.0` hingga `1.0`, inklusif
- **Prediksi:** `model.predict(source=frame, conf=self.confidence, verbose=False)`

Constructor menerima `weights`, instance `model` opsional untuk pengujian atau
injeksi model, `confidence`, dan `lane_mapper`. Nilai confidence di luar
rentang valid ditolak dengan `ValueError`.

## Kelas kendaraan yang difilter

Hanya hasil dengan `class_name` berikut yang dimasukkan ke respons:

- `car`
- `bus`
- `truck`
- `motorcycle`

Objek dari kelas lain diabaikan. Untuk setiap kendaraan yang lolos filter,
service menyimpan label kelas, confidence, koordinat bounding box, dan jalur.

## Lane Mapper berbasis kuadran

`quadrant_lane(center_x, center_y, width, height)` memetakan titik tengah
bounding box ke salah satu dari empat jalur pada `settings.LANE_NAMES`:

```text
["Utara", "Selatan", "Timur", "Barat"]
```

Algoritmanya membandingkan jarak ternormalisasi titik tengah terhadap garis
tengah frame:

1. Hitung jarak vertikal absolut dari `height / 2`.
2. Hitung jarak horizontal absolut dari `width / 2`.
3. Jika jarak vertikal lebih besar, kendaraan dianggap berada pada sumbu
   vertikal: `Utara` bila `center_y` di atas garis tengah, atau `Selatan`
   bila di bawahnya.
4. Jika tidak, kendaraan dianggap berada pada sumbu horizontal: `Timur`
   bila `center_x` di kanan garis tengah, atau `Barat` bila di kiri.

Jarak dibagi dengan dimensi frame masing-masing dan menggunakan `max(..., 1)`
untuk mencegah pembagian dengan nol. Lane mapper kustom dapat diinjeksi,
tetapi hasilnya harus salah satu nama jalur yang dikenal; jika tidak,
`detect()` mengangkat `ValueError`.

## Struktur output

Output `detect(frame)` mengikuti TypedDict berikut:

```python
class BoundingBox(TypedDict):
    x1: float
    y1: float
    x2: float
    y2: float

class VehicleDetection(TypedDict):
    class_name: str
    confidence: float
    bbox: BoundingBox
    lane: str

class DetectionResult(TypedDict):
    total: int
    counts: dict[str, int]
    detections: list[VehicleDetection]
```

Contoh:

```python
{
    "total": 1,
    "counts": {
        "Utara": 1,
        "Selatan": 0,
        "Timur": 0,
        "Barat": 0,
    },
    "detections": [
        {
            "class_name": "car",
            "confidence": 0.9123,
            "bbox": {"x1": 120.5, "y1": 80.0, "x2": 310.0, "y2": 245.75},
            "lane": "Utara",
        }
    ],
}
```

`counts` selalu diinisialisasi untuk seluruh jalur, termasuk jalur dengan
jumlah nol. `total` sama dengan panjang `detections`.

## Visualisasi deteksi

`YoloVehicleService.draw_detections(frame, result)` membuat salinan frame BGR
dan menggambar setiap bounding box menggunakan `cv2.rectangle`. Label pada
setiap kotak menggunakan format `<class_name> <confidence>` dan dirender
dengan `cv2.putText`. Helper mengembalikan frame teranotasi tanpa mengubah
frame asli.

## Perbaikan kompatibilitas tensor skalar

Helper `_scalar_float()` dan `_scalar_int()` menormalisasi nilai yang berasal
dari tensor Ultralytics/PyTorch ke tipe Python `float` dan `int`.
Perbaikannya memprioritaskan `.item()` bila tersedia sebelum fallback ke
indeks pertama atau konversi langsung.

Pengecekan `.item()` penting untuk menangani tensor berdimensi nol (0-D).
Tensor 0-D tidak dapat diakses dengan pola `value[0]`; memanggil `.item()`
mengambil nilai skalar secara aman. Helper ini digunakan untuk class id,
confidence, dan setiap koordinat bounding box sehingga format output tetap
konsisten di berbagai bentuk nilai tensor.

## Validasi input dan kegagalan

`detect()` mengharuskan `frame` berupa `numpy.ndarray` dengan minimal dua
dimensi. Input yang tidak memenuhi syarat menghasilkan `ValueError`.
Kegagalan memuat dependensi `ultralytics` menghasilkan `RuntimeError` dengan
instruksi pemasangan paket; router vision memetakan runtime error tersebut
ke respons layanan yang sesuai.

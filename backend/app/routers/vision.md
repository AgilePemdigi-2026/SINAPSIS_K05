# Router API Vision

## Ringkasan

Modul [`vision.py`](./vision.py) menyediakan perantara FastAPI untuk
memproses frame kamera menggunakan service deteksi kendaraan YOLOv8.
Router menerima gambar dari klien, memvalidasi tipe dan isi frame, mengubah
bytes gambar menjadi frame OpenCV, lalu meneruskan frame tersebut ke
`YoloVehicleService`.

Router didaftarkan dengan prefix `/api/vision` dan tag dokumentasi
`Computer Vision`. Instance service dibuat secara lazy melalui
`get_yolo_service()` dan di-cache satu kali menggunakan `lru_cache`, sehingga
model tidak dimuat ketika aplikasi baru dimulai.

## Endpoint

### `POST /api/vision/detect`

Mendeteksi kendaraan dari satu frame gambar.

#### Input

- **Content-Type:** `multipart/form-data`
- **Field:** `frame`
- **Tipe:** `UploadFile`
- **Field opsional:** `lane` (`str`), salah satu dari `Utara`, `Selatan`,
  `Timur`, atau `Barat`
- **Format yang disarankan:** JPEG atau PNG
- **Validasi:** `content_type` harus diawali `image/`; bytes gambar harus dapat
  didekode oleh OpenCV sebagai frame BGR.

Jika `lane` diisi, seluruh deteksi dari frame dipetakan 100% ke lajur tersebut.
Jika tidak diisi, service menggunakan pemetaan kuadran bawaan berdasarkan
posisi bounding box.

Contoh permintaan:

```bash
curl -X POST http://localhost:8000/api/vision/detect \
  -F "frame=@frame.jpg" \
  -F "lane=Utara"
```

#### Respons berhasil

Respons JSON mengikuti `DetectionResult` dari service:

```json
{
  "total": 1,
  "counts": {
    "Utara": 1,
    "Selatan": 0,
    "Timur": 0,
    "Barat": 0
  },
  "detections": [
    {
      "class_name": "car",
      "confidence": 0.9123,
      "bbox": {
        "x1": 120.5,
        "y1": 80.0,
        "x2": 310.0,
        "y2": 245.75
      },
      "lane": "Utara"
    }
  ]
}
```

Keterangan:

- `total` adalah jumlah deteksi yang termasuk kelas kendaraan yang
  didukung.
- `counts` berisi jumlah kendaraan per jalur.
- `detections` berisi detail setiap kendaraan; `bbox` menggunakan koordinat
  piksel `(x1, y1, x2, y2)`.
- Nilai `confidence` dibulatkan hingga empat angka desimal.

### `WebSocket /api/vision/stream`

Memproses frame gambar secara berulang melalui koneksi WebSocket.

1. Klien membuka koneksi dan mengirim frame sebagai pesan binary.
2. Server mendekode dan memproses setiap frame.
3. Server mengirim `DetectionResult` sebagai pesan JSON untuk setiap frame.
4. Jika terjadi kesalahan pada satu frame, server mengirim objek
   `{"error": "..."}`. Kesalahan runtime pada service menyebabkan server
   mengirim error lalu menutup koneksi dengan kode `1011`.

Koneksi ditutup tanpa respons tambahan ketika klien melakukan disconnect.

### `POST /api/vision/detect-image`

Mendeteksi kendaraan dan mengembalikan gambar JPEG yang telah diberi
bounding box serta label class-confidence. Input menggunakan multipart dengan
field `frame` dan field `lane` opsional. Jika `lane` diisi, semua deteksi
dipetakan ke lajur tersebut; jika tidak, pemetaan kuadran bawaan digunakan.

Endpoint ini mengembalikan `Content-Type: image/jpeg`, sehingga hasilnya dapat
dibuka langsung sebagai gambar dari browser atau Swagger UI.

## Integrasi dengan `yolo_service.py`

Router memanggil:

```python
result = get_yolo_service().detect(decode_frame(await frame.read()))
```

`decode_frame()` bertanggung jawab atas validasi bytes kosong dan decoding
OpenCV. `YoloVehicleService.detect()` bertanggung jawab atas inferensi
YOLOv8, penyaringan kelas kendaraan, pemetaan jalur, dan pembentukan respons
JSON. Detail model, threshold, lane mapper, dan TypedDict tersedia di
[`yolo_services.md`](../services/yolo_services.md).

## Penanganan error

| Kondisi | Kode | Perilaku |
|---|---:|---|
| Field `frame` tidak dikirim | 422 | Validasi parameter FastAPI |
| Frame kosong | 400 | `decode_frame()` mengembalikan `Frame kosong.` |
| Content type bukan gambar | 415 | Router mengembalikan `Gunakan content-type gambar.` |
| Bytes bukan gambar valid | 415 | OpenCV gagal mendekode frame |
| Dependensi YOLO/OpenCV atau runtime model bermasalah | 503 | Error runtime dipetakan menjadi HTTP 503 |
| Kesalahan tak tertangani di luar kondisi yang dipetakan | 500 | Ditangani oleh exception handler default FastAPI |

Pada endpoint WebSocket, error frame dikirim sebagai JSON `error` agar koneksi
tetap dapat digunakan bila kesalahan bersifat lokal pada frame. Error runtime
service dianggap fatal untuk sesi tersebut dan koneksi ditutup.

## `POST /api/vision/detect-intersection`

Memproses beberapa gambar kamera persimpangan dalam satu request. Endpoint
menyediakan empat field upload opsional yang eksplisit:

- `frame_utara`: gambar kamera lajur `Utara`
- `frame_selatan`: gambar kamera lajur `Selatan`
- `frame_timur`: gambar kamera lajur `Timur`
- `frame_barat`: gambar kamera lajur `Barat`

Setiap file menggunakan lane mapper konstan sesuai nama field-nya, sehingga
seluruh deteksi dari kamera tersebut dihitung ke lajur yang sesuai. Minimal
satu frame harus dikirim.

Respons menggabungkan hasil seluruh frame:

```json
{
  "total": 0,
  "counts": {
    "Utara": 0,
    "Selatan": 0,
    "Timur": 0,
    "Barat": 0
  },
  "detections": [],
  "visualizations": {
    "Utara": "data:image/jpeg;base64,...",
    "Selatan": "data:image/jpeg;base64,..."
  }
}
```

`detections` berisi detail kendaraan dari semua frame, sedangkan `total` dan
`counts` adalah akumulasi lintas kamera. `visualizations` berisi Data URL
Base64 JPEG untuk setiap lajur yang frame-nya dikirim; nilai dapat langsung
digunakan sebagai sumber gambar pada browser.

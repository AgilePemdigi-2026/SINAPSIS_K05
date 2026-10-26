# SINAPSIS v3 — Multi-Intersection Micro-Simulation Dashboard
**IRaX International Competition — Neuromorphic Intersection Controller**

## 🚀 Quick Start

### Linux / macOS
```bash
chmod +x run.sh
./run.sh
```

### Windows
```
Klik dua kali  run.bat
```

Buka browser → **http://localhost:5173**

---

## 📁 Struktur Project

```
neric-v3/
├── run.sh              ← Start script Linux/macOS
├── run.bat             ← Start script Windows
├── frontend/           ← React + Vite + Tailwind
│   ├── src/
│   │   ├── components/
│   │   │   ├── MicroSimulationBoard.jsx  ← MERGED: Multi-intersection canvas
│   │   │   ├── Dashboard.jsx             ← Main layout + data wiring
│   │   │   ├── CityGrid.jsx              ← Canvas renderer (v2 topology)
│   │   │   └── ...
│   │   ├── hooks/
│   │   │   ├── useNericSimulator.js      ← LIF brain (JS)
│   │   │   ├── useNericRestApi.js        ← REST polling ke backend
│   │   │   ├── useNericWebSocket.js      ← WS fallback
│   │   │   └── useCVStream.js            ← CV video stream
│   │   └── lib/constants.js             ← Konfigurasi (URL, topology)
│   └── vite.config.js                   ← Proxy → localhost:8001
└── cv-backend/         ← FastAPI + YOLOv8
    ├── main.py          ← CV Backend (upload video, stream deteksi)
    ├── requirements.txt
    └── best.pt          ← ⚠ LETAKKAN FILE INI DI SINI
```

---

## ⚙️ Cara Kerja Data

```
[Frontend Simulator (LIF JS)]
        ↓ vehicle_counts N/S/E/W
[POST /api/decide (Brain Backend)]   ← opsional, jika ada
        ↓ decisions JSON
[Dashboard merged state]
        ↓ props: lanes, emergencyActive, mode
[MicroSimulationBoard]
        ↓
  J1 (INT_A) ← lights dari backend / simulator
  J2–J5      ← autonomous local simulation
```

---

## 🎮 Fitur Dashboard

| Tab | Konten |
|---|---|
| **Live Sim** | Canvas multi-intersection J1–J5 dengan kendaraan animasi |
| **City Grid** | Peta kota lengkap 3 perempatan + 2 pertigaan |
| **Brain Activity** | Grafik potensial membran neuron LIF |
| **Emergency Map** | Leaflet map rute ambulans ke RSUD Dr. Soetomo |
| **Analytics** | Chart historis kepadatan per jalur |

---

## 🔌 Tambah best.pt (YOLO)

```bash
cp /path/to/best.pt cv-backend/best.pt
```

Restart CV Backend → upload video otomatis pakai YOLOv8.  
Tanpa `best.pt`, backend tetap jalan dengan **simulation mode**.

---

## 🌐 Koneksi Backend Eksternal (ngrok)

Edit `frontend/vite.config.js`:
```js
const NERIC_BACKEND_URL = 'https://NGROK_URL_KAMU'
const CV_BACKEND_URL    = 'http://localhost:8001'
```

Edit `frontend/src/lib/constants.js`:
```js
export const WS_DEFAULT_URL = 'ws://localhost:8000/ws/brain'
```

# SINAPSIS: Sistem AI Neuromorfik Adaptif Pengendali Arus Lalu Lintas

**Implementation of Adaptive Neuromorphic AI and Real-Time Perception Layer to Optimize Urban Traffic Flow and Proactive Emergency Routing**

SINAPSIS (*Sistem AI Neuromorfik Adaptif Pengendali Arus Lalu Lintas*) adalah platform telemetri dan kendali lalu lintas cerdas berbasis web yang dirancang khusus untuk Dinas Perhubungan. Menggantikan sistem *fixed-timer* konvensional, SINAPSIS mengatur durasi sinyal lampu lalu lintas secara dinamis menggunakan model neuron buatan Leaky Integrate-and-Fire (LIF) serta menyediakan koridor hijau proaktif untuk kendaraan darurat menggunakan algoritma Dijkstra.

---

## Authors (Group 5 - Information Systems)

- **Muhammad Rizki Fahrezi** (187241075)
- **Arya Satya Andhika Akbar** (187231003)
- **Hassya Azzamahksyari Oksigendaru** (187231019) 
- **Ryandar Anugrah Fajr** (187231094) 

*Faculty of Science and Technology, Universitas Airlangga, Indonesia.*

---

## System Overview

Sistem lalu lintas konvensional sering kali gagal beradaptasi dengan lonjakan kepadatan kendaraan secara mendadak. SINAPSIS menyelesaikan efisiensi lalu lintas perkotaan melalui arsitektur empat tingkatan:

1. **Perception Layer (Computer Vision):** Deteksi dan penghitungan volume kendaraan secara *real-time* di 4 arah persimpangan menggunakan YOLOv8 dan OpenCV.
2. **Neuromorphic Processing Core:** Logika neuron buatan Leaky Integrate-and-Fire (LIF) yang mengubah akumulasi kepadatan kendaraan menjadi potensial membran (*membrane potential*) dan memicu *spike* keputusan sinyal adaptif.
3. **Proactive Emergency Routing:** Algoritma graf berbasis Dijkstra yang mengintervensi sinyal lampu untuk membuka koridor hijau (*green corridor*) secara otomatis bagi kendaraan darurat sebelum tiba di persimpangan.
4. **Command Center Dashboard:** Dashboard pemantauan web berlatensi rendah yang dibangun dengan FastAPI, WebSockets, dan MQTT untuk pemantauan telemetri kontinu serta intervensi manual.

---

## Technical Architecture & Stack

- **Backend Framework:** FastAPI (Python 3.11+)
- **Computer Vision & Tracking:** YOLOv8 (Ultralytics), OpenCV, ByteTrack
- **Neuromorphic AI Logic:** Custom Leaky Integrate-and-Fire (LIF) Engine menggunakan NumPy & SciPy
- **Emergency Routing Engine:** NetworkX / Dijkstra Algorithm
- **Time-Series Telemetry DB:** InfluxDB 3.0
- **Relational DB:** PostgreSQL
- **Real-Time Streaming:** WebSockets (Dashboard) & MQTT Broker / Mosquitto (Signal Controllers)

---

## System Features

1. **Role-Based Authentication:** Antarmuka khusus dan pembatasan hak akses untuk Administrator dan Petugas Lalu Lintas.
2. **Real-Time Traffic Monitoring:** Peta *density map* interaktif, daftar telemetri status persimpangan, metrik V/C ratio, serta notifikasi *congestion alert* otomatis.
3. **System Administration:** Pendaftaran node persimpangan baru, kalibrasi *AI Spike Threshold*, dan manajemen akun pengguna.
4. **Emergency Green Corridor Request:** Perhitungan rute optimal Dijkstra dengan modal pratinjau rute visual dan kapabilitas *override* sinyal lampu.

---

## Prerequisites

Pastikan lingkungan dan dependensi berikut telah siap sebelum instalasi lokal:
- Python 3.11+
- PostgreSQL & InfluxDB 3.0 Instance
- Mosquitto MQTT Broker
- Node.js / Modern Browser (Chrome/Firefox) yang mendukung WebSockets

---

## Installation & Deployment

### 1. Repository Setup
```bash
git clone [https://github.com/AgilePemdigi-2026/SINAPSIS_K05.git](https://github.com/AgilePemdigi-2026/SINAPSIS_K05.git)
cd SINAPSIS_K05

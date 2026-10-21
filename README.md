# SINAPSIS / NERIC: Neuromorphic-Inspired Responsive Intersection Controller

**Implementation of Adaptive Neuromorphic AI and Real-Time Perception Layer to Optimize Urban Traffic Flow and Proactive Emergency Routing**

SINAPSIS (*Sistem AI Neuromorfik Adaptif Pengendali Arus Lalu Lintas*) / NERIC is an intelligent web-based traffic telemetry and control platform designed for the Transport Department (*Dinas Perhubungan*). By replacing conventional fixed-timer systems, NERIC dynamically regulates signal durations using spiking neuron models (LIF) and provides proactive green corridors for emergency vehicles using Dijkstra routing[cite: 104, 106].

---

## Authors (Group 5 - Information Systems)

- **Muhammad Rizki Fahrezi** (187241075) 
- **Arya Satya Andhika Akbar** (187241003) 
- **Hassya Azzamahksyari Oksigendaru** (187241019) 
- **Ryandar Anugrah Fajr** (187241094) 

*Faculty of Science and Technology, Universitas Airlangga, Indonesia.*

---

## System Overview

Traditional traffic signaling fails to adapt dynamically to real-time congestion spikes[cite: 106]. SINAPSIS addresses urban traffic inefficiency through a four-tier architecture:

1. **Perception Layer (Computer Vision):** Real-time vehicle detection and counting across 4 intersection directions using YOLOv8 and OpenCV.
2. **Neuromorphic Processing Core:** Leaky Integrate-and-Fire (LIF) artificial neuron logic that translates vehicle density into membrane potential and triggers adaptive signal spikes.
3. **Proactive Emergency Routing:** Dijkstra-based graph algorithm that preempts signals to automatically open green corridors for emergency vehicles before arrival.
4. **Command Center Dashboard:** Low-latency web dashboard built with FastAPI, WebSockets, and MQTT for continuous telemetry monitoring and manual intervention.

---

## Technical Architecture & Stack

- **Backend Framework:** FastAPI (Python 3.11+)
- **Computer Vision & Tracking:** YOLOv8 (Ultralytics), OpenCV, ByteTrack
- **Neuromorphic AI Logic:** Custom Leaky Integrate-and-Fire (LIF) Engine using NumPy & SciPy
- **Emergency Routing Engine:** NetworkX / Dijkstra Algorithm
- **Time-Series Telemetry DB:** InfluxDB 3.0
- **Relational DB:** PostgreSQL
- **Real-Time Streaming:** WebSockets (Dashboard) & MQTT Broker / Mosquitto (Signal Controllers)

---

## System Features

1. **Role-Based Authentication:** Dedicated interfaces and access control for System Administrators and Traffic Officers.
2. **Real-Time Traffic Monitoring:** Interactive map canvas, intersection status telemetry, V/C ratio metrics, and automated congestion alerts.
3. **System Administration:** Node registration, AI Spike Threshold calibration, and user management.
4. **Emergency Green Corridor Request:** Dijkstra routing calculation with visual preemption review and signal override capabilities.

---

## Prerequisites

Ensure the following environments are set up prior to local installation:
- Python 3.11+
- PostgreSQL & InfluxDB 3.0 instance
- Mosquitto MQTT Broker
- Node.js / Modern Browser (Chrome/Firefox) supporting WebSocket

---

## Installation & Deployment

### 1. Repository Setup
```bash
git clone [https://github.com/AgilePemdigi-2026/SINAPSIS_K05.git](https://github.com/AgilePemdigi-2026/SINAPSIS_K05.git)
cd SINAPSIS_K05

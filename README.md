# SINAPSIS Sistem AI Neuromorfik Adaptif Pengendali Arus Lalu Lintas

*Integrated AI Traffic Flow Analytics & Proactive Emergency Routing Platform Studi Kasus: Persimpangan Padat*

Proyek praktikum **Pembangunan Perangkat Lunak (I4)**, Kelompok 5, Sistem Informasi, Fakultas Sains dan Teknologi, Universitas Airlangga, 2026.
Klien (studi kasus): Dinas Perhubungan (Dishub).

SINAPSIS mengatur durasi lampu lalu lintas secara adaptif memakai model neuron Leaky Integrate-and-Fire (LIF),
dilengkapi model prediksi kepadatan yang dilatih dari data dan koridor hijau untuk kendaraan darurat (algoritma Dijkstra).

## Struktur repositori

| Folder | Isi |
|---|---|
| `backend/` | Backend FastAPI + SQLite, mesin LIF, model prediksi terlatih, tes otomatis. Petunjuk lengkap: [`backend/README.md`](backend/README.md) |
| `legacy-neric/` | Arsip prototipe lomba NERIC (MSU iREX 2026). Tidak dipakai di proyek kuliah; disimpan sebagai referensi dan sumber komponen yang mungkin dipakai ulang |
| `docs/` | Dokumen kerja tim, termasuk [`alur kerja Git`](docs/GIT_WORKFLOW.md) |

## Menjalankan backend

```bash
cd backend
python -m venv venv
source venv/bin/activate          # Windows: .\venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env              # Windows: copy .env.example .env
uvicorn app.main:app --reload
```

Dokumentasi API interaktif: `http://127.0.0.1:8000/docs`. Tes: `cd backend && pytest -q`.

## Alur kerja tim

Semua perubahan lewat branch dan Pull Request. Aturan lengkap: [`docs/GIT_WORKFLOW.md`](docs/GIT_WORKFLOW.md).

## Tim

Arya Satya Andhika Akbar, Hassya Azzamahksyari Oksigendaru, Muhammad Rizki Fahrezi, Ryandar Anugrah Fajr.

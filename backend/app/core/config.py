"""Konfigurasi aplikasi (dibaca dari environment / file .env)."""
import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    APP_NAME = "SINAPSIS API"
    VERSION = "1.0.0"

    DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./sinapsis.db")
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-only-secret-ubah-di-produksi")
    ALGORITHM = "HS256"
    ACCESS_TOKEN_MINUTES = int(os.getenv("ACCESS_TOKEN_MINUTES", 480))
    BCRYPT_ROUNDS = int(os.getenv("BCRYPT_ROUNDS", 12))
    SEED_DEMO_DATA = os.getenv("SEED_DEMO_DATA", "true").lower() == "true"

    # Jalur persimpangan (4 arah, sesuai CDM: Persimpangan 1-N Jalur)
    LANE_NAMES = ["Utara", "Selatan", "Timur", "Barat"]
    MAX_VEHICLES = int(os.getenv("MAX_VEHICLES", 20))
    PILOT_INTERSECTION_ID = int(os.getenv("PILOT_INTERSECTION_ID", 1))  # simpang yang memutar ulang traffic.csv
    EMERGENCY_RATIO = float(os.getenv("EMERGENCY_RATIO", 0.85))

    # Durasi lampu (detik)
    GREEN_MIN = 10
    GREEN_MAX = 60
    YELLOW = 3

    # Parameter model LIF (diwarisi dari NERIC)
    ALPHA = 0.70
    BETA = 0.30
    LEAK = 0.08
    REFRACTORY = 3
    EXCITATORY = 0.12
    INHIBITORY = 0.08

    # Threshold adaptif. Nilai dasar & periode jam hasil kalibrasi data (scripts/calibrate.py,
    # lihat docs/calibration_report.md). Faktor sibuk/malam diwarisi dari NERIC (0.32/0.55 dan 0.72/0.55).
    THRESHOLD_NORMAL = 0.76
    RUSH_FACTOR = 0.58
    NIGHT_FACTOR = 1.31
    RUSH_HOURS = [(12, 13), (15, 16), (19, 23)]
    NIGHT_HOURS = [(2, 9)]


settings = Settings()

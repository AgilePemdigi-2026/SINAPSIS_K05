"""Kalibrasi parameter LIF dari data (scripts/calibrate.py)."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import calibrate  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.services.sensor_source import CsvSensorSource  # noqa: E402


def test_calibration_is_reproducible_and_matches_config():
    saved = json.loads((ROOT / "data" / "calibration.json").read_text())
    rows = CsvSensorSource().rows
    train = rows[: len(rows) // 2]
    rush, night, _ = calibrate.derive_periods(train)
    assert [list(x) for x in rush] == saved["periode_hasil_kalibrasi"]["rush_hours"]
    assert [list(x) for x in night] == saved["periode_hasil_kalibrasi"]["night_hours"]
    # nilai di config harus sama dengan hasil kalibrasi yang tersimpan
    assert settings.THRESHOLD_NORMAL == saved["spike_threshold_dasar_hasil_kalibrasi"]
    assert [list(x) for x in settings.RUSH_HOURS] == saved["periode_hasil_kalibrasi"]["rush_hours"]


def test_calibrated_beats_default_on_holdout():
    saved = json.loads((ROOT / "data" / "calibration.json").read_text())
    assert saved["hasil_kalibrasi_lengkap"]["test"]["f1"] > saved["hasil_bawaan"]["test"]["f1"]

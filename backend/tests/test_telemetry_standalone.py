"""Smoke test mandiri untuk model telemetry InfluxDB SINAPSIS.

Jalankan dari root repository dengan:
    py backend/tests/test_telemetry_standalone.py

Skrip ini hanya menguji pembentukan payload dan serialisasi Line Protocol;
tidak membutuhkan server InfluxDB yang sedang berjalan.
"""
from __future__ import annotations

import json
import sys
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path


# Allow direct execution without installing the backend as a package.
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.models import Telemetry


def main() -> None:
    """Create, validate, serialize, and print telemetry payloads."""
    timestamp = datetime.now(timezone.utc)
    samples = [
        Telemetry(
            timestamp=timestamp,
            lane_name="Utara",
            vehicle_count=12,
            membrane_potential=0.88,
            spike=True,
            threshold=0.76,
        ),
        Telemetry(
            timestamp=timestamp,
            lane_name="Selatan",
            vehicle_count=5,
            membrane_potential=0.42,
            spike=False,
            threshold=0.76,
        ),
    ]

    payloads = []
    line_protocol = []
    for telemetry in samples:
        payload = asdict(telemetry)
        payload["timestamp"] = telemetry.timestamp.isoformat()
        payloads.append(payload)

        line = telemetry.to_line_protocol()
        if not line.strip():
            raise AssertionError("Line Protocol telemetry tidak boleh kosong")
        line_protocol.append(line)

    assert all(isinstance(item["vehicle_count"], int) for item in payloads)
    assert all(isinstance(item["membrane_potential"], float) for item in payloads)
    assert all(isinstance(item["spike"], bool) for item in payloads)
    assert all("threshold=" in line for line in line_protocol)
    assert all("vehicle_count=" in line for line in line_protocol)

    print("Telemetry payload siap dikirim ke InfluxDB:")
    print(json.dumps(payloads, indent=2, ensure_ascii=False))
    print("\nInfluxDB Line Protocol:")
    print("\n".join(line_protocol))


if __name__ == "__main__":
    main()

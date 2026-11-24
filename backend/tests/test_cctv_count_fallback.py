"""Hitungan kendaraan di tampilan CCTV: jangan tampil 0 palsu sebelum YOLO mengirim hasil."""
import re
from pathlib import Path

JS = (Path(__file__).resolve().parents[1] / "app" / "static" / "dashboard.js").read_text(encoding="utf-8")


def test_counts_only_used_when_detection_result_exists():
    body = JS[JS.index("function detectionCount"):]
    body = body[:body.index("/* ---------- jaringan")]
    first_if = re.search(r"if \((.*?)\) \{", body, re.S).group(1)
    assert "item.detection_result" in first_if and "item.counts" in first_if
    assert "jumlah_kendaraan" in body

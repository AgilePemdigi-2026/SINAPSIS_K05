"""Pilihan tampilan dashboard: Animasi | CCTV (hanya frontend, memakai payload yang sudah ada)."""
from pathlib import Path

STATIC = Path(__file__).resolve().parents[1] / "app" / "static"


def test_dashboard_has_view_switch(client):
    page = client.get("/dashboard").text
    assert 'id="viewAnim"' in page and 'id="viewCctv"' in page
    assert "Diagram skematik persimpangan aktif" in page


def test_view_switch_reads_existing_snapshots_only():
    js = (STATIC / "dashboard.js").read_text(encoding="utf-8")
    assert "renderCctvWall" in js and "item.snapshots" in js
    assert "sinapsis_view" in js
    css = (STATIC / "dashboard.css").read_text(encoding="utf-8")
    assert ".cctv-wall" in css and ".view-seg" in css

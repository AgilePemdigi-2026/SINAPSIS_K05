"""Animasi lalu lintas pada diagram dashboard: 1 kendaraan = 1 mobil, mengikuti lengan dan data terbaru."""
import shutil
import subprocess
from pathlib import Path

import pytest

JS_TEST = Path(__file__).parent / "js" / "traffic_anim.test.js"


def test_dashboard_loads_traffic_engine_before_dashboard_js(client):
    html = client.get("/dashboard").text
    assert html.index("/static/traffic_anim.js") < html.index("/static/dashboard.js")
    assert client.get("/static/traffic_anim.js").status_code == 200
    assert 'id="animToggle"' in html and "Animasi" in html


def test_one_vehicle_equals_one_car_not_icon_scaling(client):
    js = client.get("/static/dashboard.js").text
    assert "VEH_PER_ICON" not in js and "MAX_ICONS" not in js and "drawQueue" not in js
    assert "SinapsisTraffic" in js and "prefers-reduced-motion" in js
    legend = client.get("/dashboard").text
    assert "satu kendaraan" in legend and "mewakili sekitar" not in legend


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js tidak terpasang")
def test_traffic_simulation_js_unit():
    r = subprocess.run(["node", str(JS_TEST)], capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr + r.stdout

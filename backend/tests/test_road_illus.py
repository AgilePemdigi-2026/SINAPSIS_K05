"""Ilustrasi jalan hasil generate dari lengan yang digambar (tanpa data OpenStreetMap)."""
import shutil
import subprocess
from pathlib import Path

import pytest

JS_TEST = Path(__file__).parent / "js" / "road_illus.test.js"


def test_dashboard_loads_road_illus_before_dashboard_js(client):
    html = client.get("/dashboard").text
    assert html.index("/static/road_illus.js") < html.index("/static/dashboard.js")
    assert client.get("/static/road_illus.js").status_code == 200


def test_registration_page_loads_illustration_modules(client):
    page = client.get("/admin/intersections/add").text
    assert "/static/traffic_anim.js" in page and "/static/road_illus.js" in page
    assert page.index("/static/road_illus.js") < page.index("/static/admin_intersections.js")


def test_dashboard_draws_generated_illustration_not_osm_roads(client):
    js = client.get("/static/dashboard.js").text
    assert "SinapsisRoadIllus" in js and "illus-under" in js and "illus-marks" in js
    # tidak ada pengambilan data jalan dari Overpass untuk ilustrasi
    assert "overpass" not in js.lower()


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js tidak terpasang")
def test_road_illus_js_unit():
    r = subprocess.run(["node", str(JS_TEST)], capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr + r.stdout

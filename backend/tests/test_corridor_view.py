"""Fitur 9 pada dashboard: pemetaan koridor hijau ke persimpangan, serta koordinat 5 simpang di payload."""
import shutil
import subprocess
from pathlib import Path

import pytest

from app.services import corridor_view, green_corridor_service
from app.services.seed import DEMO_COORDS, DEMO_INTERSECTIONS

DASH = "/api/monitoring/dashboard"
ITEMS = [{"id_persimpangan": i, "nama_lokasi": n} for i, (n, _) in enumerate(DEMO_INTERSECTIONS, start=1)]


@pytest.fixture(autouse=True)
def _bersih():
    green_corridor_service.ACTIVE_CORRIDORS.clear()
    green_corridor_service.INTERSECTION_OVERRIDES.clear()
    yield
    green_corridor_service.ACTIVE_CORRIDORS.clear()
    green_corridor_service.INTERSECTION_OVERRIDES.clear()


def test_seed_memuat_lima_simpang_dengan_koordinat():
    assert len(DEMO_INTERSECTIONS) == 5
    assert all(nama in DEMO_COORDS for nama, _ in DEMO_INTERSECTIONS)


@pytest.mark.parametrize("token,expected", [
    ("SIMPANG-01", 1), ("simpang-3", 3), ("SIMPANG05", 5), ("2", 2),
    ("SIMPANG-GUBENG", 1), ("Simpang Raya", 3), ("SIMPANG-09", None), ("xyz", None),
])
def test_resolve_id(token, expected):
    assert corridor_view.resolve_id(token, ITEMS) == expected


def test_build_dan_annotate_urutan():
    active = {"EMG-1": {"status": "ACTIVE", "vehicle_type": "Ambulans", "triggered_by": "u", "activated_at": "t",
                        "route_intersections": ["SIMPANG-01", "SIMPANG-03", "SIMPANG-05", "SIMPANG-09", "SIMPANG-03"]}}
    corridors = corridor_view.build(active, ITEMS)
    assert corridors[0]["urutan"] == [1, 3, 5] and corridors[0]["tidak_terpetakan"] == ["SIMPANG-09"]
    items = [{"id_persimpangan": i["id_persimpangan"], "koridor_aktif": False} for i in ITEMS]
    corridor_view.annotate(items, corridors)
    assert [x["koridor_hijau"] for x in items] == [True, False, True, False, True]
    assert items[2]["koridor"]["urutan"] == 2 and items[2]["koridor"]["total"] == 3 and items[1]["koridor"] is None


def test_koridor_lepas_tidak_ditampilkan():
    active = {"EMG-2": {"status": "RELEASED", "route_intersections": ["SIMPANG-01"]}}
    assert corridor_view.build(active, ITEMS) == []


def test_dashboard_membawa_koordinat_dan_lima_simpang(client, admin):
    d = client.get(DASH, headers=admin).json()
    assert len(d["simpang"]) == 5 and d["koridor_hijau"] == []
    for s in d["simpang"]:
        assert (s["latitude"], s["longitude"]) == DEMO_COORDS[s["nama_lokasi"]]
        assert s["koridor_hijau"] is False and s["koridor"] is None


def test_koridor_hijau_aktif_muncul_di_dashboard(client, admin):
    r = client.post("/api/emergency/green-corridor/activate", headers=admin, json={
        "emergency_id": "EMG-777", "vehicle_type": "Ambulans",
        "route_intersections": ["SIMPANG-01", "SIMPANG-02", "SIMPANG-05"]})
    assert r.status_code == 201, r.text
    d = client.get(DASH, headers=admin).json()
    assert d["koridor_hijau"][0]["emergency_id"] == "EMG-777" and d["koridor_hijau"][0]["urutan"] == [1, 2, 5]
    flags = {s["id_persimpangan"]: s["koridor_hijau"] for s in d["simpang"]}
    assert flags == {1: True, 2: True, 3: False, 4: False, 5: True}
    client.post("/api/emergency/green-corridor/release/EMG-777", headers=admin)
    d = client.get(DASH, headers=admin).json()
    assert d["koridor_hijau"] == [] and not any(s["koridor_hijau"] for s in d["simpang"])


def test_dashboard_memuat_peta_leaflet_dan_skeleton(client):
    html = client.get("/dashboard").text
    assert 'id="gisMap"' in html and 'id="statusList"' in html and 'id="bannerCorridor"' in html
    # peta digabung ke panel "Peta & status persimpangan" (tidak ada lagi panel peta terpisah yang redundan)
    assert 'class="panel gis"' not in html and 'id="gisList"' not in html
    assert html.index('id="gisMap"') < html.index('id="statusList"')
    assert html.index("/static/vendor/leaflet/leaflet.js") < html.index("/static/dashboard_map.js") \
        < html.index("/static/dashboard.js")
    for path in ("/static/dashboard_map.js", "/static/vendor/leaflet/leaflet.js", "/static/vendor/leaflet/leaflet.css"):
        assert client.get(path).status_code == 200


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js tidak terpasang")
def test_dashboard_map_js_unit():
    r = subprocess.run(["node", str(Path(__file__).parent / "js" / "dashboard_map.test.js")],
                       capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr + r.stdout

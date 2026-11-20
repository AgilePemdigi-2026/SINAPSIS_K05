"""Persimpangan 5+ lengan: lengan diberi label angka ("Lengan 1".."Lengan N"), bukan mata angin."""
import pytest

from app.services.arms import arm_type, is_numbered, normalize_arms, numbered_names

URL = "/api/admin/intersections"
DASH = "/api/monitoring/dashboard"


def _dash_item(client, admin, nama):
    return next(s for s in client.get(DASH, headers=admin).json()["simpang"] if s["nama_lokasi"] == nama)


@pytest.mark.parametrize("n", [5, 6, 7, 8])
def test_register_numbered_by_count(client, admin, n):
    nama = f"Simpang {n} Lengan"
    r = client.post(URL, headers=admin, json={"nama_lokasi": nama, "jumlah_lengan": n})
    assert r.status_code == 201, r.text
    assert r.json()["jumlah_lengan"] == n and r.json()["data_awal"] is True
    item = _dash_item(client, admin, nama)
    assert [j["arah"] for j in item["jalur"]] == numbered_names(n)
    assert item["jumlah_lengan"] == n and item["status"] != "Belum ada data"
    assert set(item["snapshots"]) == set(numbered_names(n))
    assert [f["arah"] for f in item["vision_feeds"]] == numbered_names(n)


def test_register_numbered_by_list(client, admin):
    r = client.post(URL, headers=admin, json={"nama_lokasi": "Simpang Daftar 5", "lengan": numbered_names(5)})
    assert r.status_code == 201 and r.json()["tipe"] == "Persimpangan 5 lengan"


@pytest.mark.parametrize("body", [
    {"jumlah_lengan": 9},
    {"jumlah_lengan": 2},
    {"lengan": ["Lengan 1", "Lengan 2"]},                                      # < 3 lengan
    {"lengan": ["Lengan 1", "Lengan 2", "Lengan 3", "Lengan 4", "Lengan 6"]},  # tidak berurutan
    {"lengan": ["Utara", "Lengan 1", "Lengan 2", "Lengan 3", "Lengan 4"]},     # campur
])
def test_invalid_numbered_rejected(client, admin, body):
    r = client.post(URL, headers=admin, json={"nama_lokasi": "Simpang Salah", **body})
    assert r.status_code == 422


def test_compass_arms_unchanged(client, admin):
    r = client.post(URL, headers=admin, json={"nama_lokasi": "Simpang Kompas", "jumlah_lengan": 4})
    assert r.status_code == 201
    assert [j["arah"] for j in _dash_item(client, admin, "Simpang Kompas")["jalur"]] == ["Utara", "Selatan", "Timur", "Barat"]


def test_normalize_helpers():
    assert normalize_arms(numbered_names(5)) == numbered_names(5)
    assert is_numbered(numbered_names(6)) and not is_numbered(["Utara", "Timur"])
    assert arm_type(numbered_names(5)) == "Persimpangan 5 lengan"
    with pytest.raises(ValueError):
        normalize_arms(numbered_names(9))


def test_bearing_default_and_custom(client, admin):
    from app.services.arms import default_bearings
    assert default_bearings(["Utara", "Selatan", "Timur", "Barat"]) == {"Utara": 0.0, "Selatan": 180.0, "Timur": 90.0, "Barat": 270.0}
    assert default_bearings(numbered_names(4))["Lengan 2"] == 90.0
    arms = numbered_names(5)
    r = client.post(URL, headers=admin, json={"nama_lokasi": "Simpang Bearing", "jumlah_lengan": 5,
                                              "bearing": {"Lengan 1": 12.5, "Lengan 2": 80, "Lengan 3": 150, "Lengan 4": 215, "Lengan 5": 300}})
    assert r.status_code == 201, r.text
    item = _dash_item(client, admin, "Simpang Bearing")
    assert item["bearing"]["Lengan 1"] == 12.5 and item["bearing"]["Lengan 5"] == 300.0 and set(item["bearing"]) == set(arms)


def test_bearing_default_in_payload_and_validation(client, admin):
    assert client.post(URL, headers=admin, json={"nama_lokasi": "Simpang Tanpa Bearing"}).status_code == 201
    assert _dash_item(client, admin, "Simpang Tanpa Bearing")["bearing"]["Timur"] == 90.0
    for bad in ({"Barat2": 10}, {"Utara": 400}, {"Utara": "x"}):
        assert client.post(URL, headers=admin, json={"nama_lokasi": "Simpang Bearing Salah", "bearing": bad}).status_code == 422


def test_update_bearing_existing_intersection(client, admin):
    r = client.post(URL, headers=admin, json={"nama_lokasi": "Simpang Atur Arah", "jumlah_lengan": 4})
    pid = r.json()["id_persimpangan"]
    ok = client.put(f"{URL}/{pid}/bearing", headers=admin, json={"bearing": {"Utara": 8, "Timur": 90, "Selatan": 181, "Barat": 293}})
    assert ok.status_code == 200, ok.text
    assert _dash_item(client, admin, "Simpang Atur Arah")["bearing"] == {"Utara": 8.0, "Timur": 90.0, "Selatan": 181.0, "Barat": 293.0}
    assert client.put(f"{URL}/{pid}/bearing", headers=admin, json={"bearing": {"Lengan 9": 1}}).status_code == 422
    assert client.put(f"{URL}/99999/bearing", headers=admin, json={"bearing": {}}).status_code == 404


def test_delete_intersection_and_batch(client, admin):
    ids = []
    for n in ("Hapus A", "Hapus B", "Hapus C"):
        ids.append(client.post(URL, headers=admin, json={"nama_lokasi": n}).json()["id_persimpangan"])
    r = client.delete(f"{URL}/{ids[0]}", headers=admin)
    assert r.status_code == 200 and r.json()["dihapus"] == 1
    assert client.delete(f"{URL}/{ids[0]}", headers=admin).status_code == 404
    r = client.post(f"{URL}/delete-batch", headers=admin, json={"ids": ids[1:] + [987654]})
    assert r.status_code == 200 and r.json()["dihapus"] == 2
    names = {s["nama_lokasi"] for s in client.get(DASH, headers=admin).json()["simpang"]}
    assert not names & {"Hapus A", "Hapus B", "Hapus C"}
    assert client.post(f"{URL}/delete-batch", headers=admin, json={"ids": []}).status_code == 422


def test_delete_requires_admin(client, petugas):
    assert client.delete(f"{URL}/1", headers=petugas).status_code in (401, 403)


PATH5 = {f"Lengan {i}": [[-7.2655 + 0.0001 * i, 112.752], [-7.2655 + 0.0003 * i, 112.7525 + 0.0002 * i]] for i in range(1, 4)}


def test_numbered_three_and_four_arms_with_drawn_paths(client, admin):
    r = client.post(URL, headers=admin, json={"nama_lokasi": "Simpang Gambar", "latitude": -7.2655, "longitude": 112.752,
                                              "lengan": numbered_names(3), "garis_lengan": PATH5})
    assert r.status_code == 201, r.text
    assert r.json()["tipe"].lower().startswith("pertigaan")
    item = _dash_item(client, admin, "Simpang Gambar")
    assert [j["arah"] for j in item["jalur"]] == numbered_names(3)
    assert set(item["garis_lengan"]) == set(PATH5) and item["garis_lengan"]["Lengan 2"][1] == PATH5["Lengan 2"][1]


@pytest.mark.parametrize("bad", [
    {"Lengan 9": [[-7.2, 112.7], [-7.21, 112.71]]},   # lengan tidak ada
    {"Lengan 1": [[-7.2, 112.7]]},                    # satu titik
    {"Lengan 1": [[-7.2, 112.7], [999, 112.71]]},     # di luar rentang
    {"Lengan 1": [[-7.2, 112.7], [-7.21]]},           # bukan pasangan lat/lon
])
def test_invalid_drawn_paths_rejected(client, admin, bad):
    r = client.post(URL, headers=admin, json={"nama_lokasi": "Simpang Garis Salah", "lengan": numbered_names(3), "garis_lengan": bad})
    assert r.status_code == 422


def test_update_drawn_paths_existing_intersection(client, admin):
    pid = client.post(URL, headers=admin, json={"nama_lokasi": "Simpang Gambar Ulang", "jumlah_lengan": 4}).json()["id_persimpangan"]
    ok = client.put(f"{URL}/{pid}/garis-lengan", headers=admin,
                    json={"garis_lengan": {"Utara": [[-7.2, 112.7], [-7.19, 112.7]], "Timur": [[-7.2, 112.7], [-7.2, 112.71]]}})
    assert ok.status_code == 200, ok.text
    item = _dash_item(client, admin, "Simpang Gambar Ulang")
    assert set(item["garis_lengan"]) == {"Utara", "Timur"}
    assert client.put(f"{URL}/{pid}/garis-lengan", headers=admin, json={"garis_lengan": {"Barat2": [[1, 2], [3, 4]]}}).status_code == 422
    assert client.put(f"{URL}/99999/garis-lengan", headers=admin, json={"garis_lengan": {}}).status_code == 404

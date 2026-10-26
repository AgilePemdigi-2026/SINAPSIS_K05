"""Fitur Kelola Sistem (skenario BDD 'System and Parameter Configuration')."""


def test_add_intersection_success(client, admin):
    r = client.post("/api/admin/intersections", headers=admin,
                    json={"nama_lokasi": "Simpang Empat Gubeng", "deskripsi": "Persimpangan jalur utama arah timur-barat"})
    assert r.status_code == 201 and r.json()["pesan"] == "Persimpangan baru berhasil ditambahkan!"
    items = client.get("/api/admin/intersections", headers=admin).json()
    new = [i for i in items if i["nama_lokasi"] == "Simpang Empat Gubeng"][0]
    assert [j["arah"] for j in new["jalur"]] == ["Utara", "Selatan", "Timur", "Barat"]


def test_add_intersection_empty_name(client, admin):
    r = client.post("/api/admin/intersections", headers=admin, json={"nama_lokasi": ""})
    assert r.status_code == 422 and r.json()["detail"] == "Nama lokasi persimpangan wajib diisi!"


def test_update_parameter_changes_behaviour(client, admin):
    r = client.put("/api/admin/parameters", headers=admin, json={"jenis_parameter": "spike_threshold", "nilai": 0.85})
    assert r.status_code == 200 and r.json()["pesan"] == "Parameter konfigurasi berhasil diperbarui!"
    params = {p["jenis_parameter"]: p["nilai_aktif"] for p in client.get("/api/admin/parameters", headers=admin).json()}
    assert params["spike_threshold"] == 0.85
    # threshold tinggi -> jalur sedang tidak spike pada jam normal
    out = client.post("/api/monitoring/cycle", headers=admin,
                      json={"id_persimpangan": 1, "vehicle_counts": [12, 5, 8, 3], "simulated_hour": 10}).json()
    assert out["threshold"] == 0.85 and not any(l["spike"] for l in out["lanes"])
    hist = client.get("/api/admin/parameters/history", headers=admin).json()
    assert hist[0]["jenis_parameter"] == "spike_threshold" and hist[0]["nilai"] == "0.85"


def test_update_parameter_validation(client, admin):
    assert client.put("/api/admin/parameters", headers=admin, json={"jenis_parameter": "spike_threshold", "nilai": 5}).status_code == 422
    assert client.put("/api/admin/parameters", headers=admin, json={"jenis_parameter": "tidak_ada", "nilai": 1}).status_code == 422
    assert client.put("/api/admin/parameters", headers=admin, json={"jenis_parameter": "min_green_time", "nilai": 60}).status_code == 422


def test_add_user_success_and_can_login(client, admin):
    r = client.post("/api/admin/users", headers=admin, json={
        "nama": "Budi Santoso", "username": "budisantoso", "password": "budiSecure2026", "role": "Petugas Lalu Lintas"})
    assert r.status_code == 201 and r.json()["pesan"] == "Akun pengguna berhasil dibuat!"
    assert client.post("/api/auth/login", json={"username": "budisantoso", "password": "budiSecure2026"}).status_code == 200


def test_add_user_validation(client, admin):
    base = {"nama": "X", "username": "userbaru", "password": "Abcdefg1", "role": "Petugas Lalu Lintas"}
    assert client.post("/api/admin/users", headers=admin, json={**base, "password": "lemah"}).status_code == 422
    assert client.post("/api/admin/users", headers=admin, json={**base, "role": "Superuser"}).status_code == 422
    assert client.post("/api/admin/users", headers=admin, json={**base, "username": "admin_sinapsis"}).status_code == 409
    assert client.post("/api/admin/users", headers=admin, json={**base, "nama": ""}).status_code == 422


def test_simulation_does_not_touch_operational_tables(client, admin):
    r = client.post("/api/admin/simulations", headers=admin, json={
        "profil": "RUSH_HOUR", "jumlah_siklus": 20, "simulasi_sensor_failure": True, "seed": 7})
    assert r.status_code == 200
    body = r.json()
    assert body["siklus_sensor_offline"] == 5 and len(body["total_spike_per_jalur"]) == 4
    assert client.get("/api/monitoring/history/1", headers=admin).json()["deteksi"] == []
    assert client.post("/api/admin/simulations", headers=admin, json={"profil": "XYZ"}).status_code == 422

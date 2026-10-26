"""Fitur Permintaan Rute Darurat (skenario BDD 'Emergency Green Corridor Routing')."""
BODY = {"lokasi_awal": "RSUD Dr. Soetomo", "tujuan": "Jalan Darmo", "level_prioritas": "High"}


def test_search_optimal_route(client, petugas):
    r = client.post("/api/emergency/search", headers=petugas, json=BODY)
    assert r.status_code == 200
    d = r.json()
    assert d["pesan"] == "Rute Darurat Optimal Ditemukan" and d["status"] == "Diajukan"
    assert d["rute"] == ["RSUD Dr. Soetomo", "Simpang Gubeng", "Simpang Pemuda", "Jalan Darmo"]
    assert d["jumlah_persimpangan"] == 2 and [j["urutan"] for j in d["jalur_dilewati"]] == [1, 2]


def test_empty_destination(client, petugas):
    r = client.post("/api/emergency/search", headers=petugas, json={**BODY, "tujuan": ""})
    assert r.status_code == 422 and r.json()["detail"] == "Lokasi tujuan wajib diisi!"


def test_unknown_location_and_bad_priority(client, petugas):
    assert client.post("/api/emergency/search", headers=petugas, json={**BODY, "tujuan": "Atlantis"}).status_code == 404
    assert client.post("/api/emergency/search", headers=petugas, json={**BODY, "level_prioritas": "Urgent"}).status_code == 422


def test_activate_corridor_forces_green(client, petugas):
    rid = client.post("/api/emergency/search", headers=petugas, json=BODY).json()["id_rute"]
    r = client.post(f"/api/emergency/{rid}/activate", headers=petugas)
    assert r.status_code == 200 and r.json()["pesan"] == "Koridor hijau darurat berhasil diaktifkan!"
    assert r.json()["status"] == "Aktif"
    # Siklus berikutnya di Simpang Gubeng (id 1): jalur arah 'Barat' (masuk dari RSUD) dipaksa hijau
    out = client.post("/api/monitoring/cycle", headers=petugas,
                      json={"id_persimpangan": 1, "vehicle_counts": [10, 10, 10, 1], "simulated_hour": 10}).json()
    assert out["corridor_active"] is True
    barat = [l for l in out["lanes"] if l["arah"] == "Barat"][0]
    assert barat["signal"] == "HIJAU"
    # setelah selesai, koridor tidak lagi memaksa
    client.post(f"/api/emergency/{rid}/complete", headers=petugas)
    out = client.post("/api/monitoring/cycle", headers=petugas,
                      json={"id_persimpangan": 1, "vehicle_counts": [10, 10, 10, 1], "simulated_hour": 10}).json()
    assert out["corridor_active"] is False


def test_cancel_preview_and_state_rules(client, petugas):
    rid = client.post("/api/emergency/search", headers=petugas, json=BODY).json()["id_rute"]
    c = client.post(f"/api/emergency/{rid}/cancel", headers=petugas)
    assert c.status_code == 200 and c.json()["status"] == "Dibatalkan"
    assert client.post(f"/api/emergency/{rid}/activate", headers=petugas).status_code == 409


def test_route_detours_around_congested_intersection(client, petugas):
    base = client.post("/api/emergency/search", headers=petugas, json=BODY).json()
    assert "Simpang Pemuda" in base["rute"]  # jalur terpendek saat lalu lintas lancar
    client.post("/api/monitoring/cycle", headers=petugas, json={"id_persimpangan": 2, "vehicle_counts": [20, 20, 20, 20]})
    detour = client.post("/api/emergency/search", headers=petugas, json=BODY).json()
    assert detour["rute"] == ["RSUD Dr. Soetomo", "Simpang Gubeng", "Simpang Raya", "Jalan Darmo"]
    assert detour["estimasi_menit"] >= base["estimasi_menit"]

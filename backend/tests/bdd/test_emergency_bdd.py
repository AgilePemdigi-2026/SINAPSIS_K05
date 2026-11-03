from pytest_bdd import given, parsers, scenarios, then, when

scenarios("features/emergency.feature")


def _cari(client, headers, asal, tujuan):
    return client.post("/api/emergency/search", headers=headers,
                       json={"lokasi_awal": asal, "tujuan": tujuan, "level_prioritas": "High"})


@when(parsers.re(r'saya mencari rute dari "(?P<asal>.*)" ke "(?P<tujuan>.*)"'), target_fixture="response")
def cari_rute(client, headers, asal, tujuan):
    return _cari(client, headers, asal, tujuan)


@given(parsers.parse('rute dari "{asal}" ke "{tujuan}" sudah diaktifkan'))
def aktifkan(client, headers, asal, tujuan):
    rid = _cari(client, headers, asal, tujuan).json()["id_rute"]
    assert client.post(f"/api/emergency/{rid}/activate", headers=headers).status_code == 200


@when("saya menjalankan siklus di Simpang Gubeng", target_fixture="response")
def siklus(client, headers):
    return client.post("/api/monitoring/cycle", headers=headers,
                       json={"id_persimpangan": 1, "vehicle_counts": [10, 10, 10, 1], "simulated_hour": 10})


@then(parsers.parse('rute yang ditemukan adalah "{rute}"'))
def cek_rute(response, rute):
    assert " > ".join(response.json()["rute"]) == rute


@then("koridor darurat aktif")
def cek_koridor(response):
    assert response.json()["corridor_active"] is True


@then(parsers.parse('lampu jalur {arah} berwarna "{warna}"'))
def cek_lampu(response, arah, warna):
    lane = next(l for l in response.json()["lanes"] if l["arah"] == arah)
    assert lane["signal"] == warna
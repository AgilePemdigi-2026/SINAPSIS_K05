"""Step definitions untuk simulasi_failsafe.feature (Fitur 11: Simulasi Skenario & Fail-Safe)."""
from pytest_bdd import given, parsers, scenarios, then, when

scenarios("features/simulasi_failsafe.feature")


@when(parsers.parse('saya menjalankan simulasi profil "{profil}" dengan {siklus:d} siklus dan gangguan cuaca'),
      target_fixture="response")
def simulasi_cuaca(client, headers, profil, siklus):
    return client.post("/api/admin/simulations", headers=headers, json={
        "profil": profil, "jumlah_siklus": siklus, "inject_weather_noise": True, "seed": 42
    })


@when(parsers.parse('saya menjalankan simulasi profil "{profil}" dengan {siklus:d} siklus dan gangguan sensor'),
      target_fixture="response")
def simulasi_sensor(client, headers, profil, siklus):
    return client.post("/api/admin/simulations", headers=headers, json={
        "profil": profil, "jumlah_siklus": siklus, "simulasi_sensor_failure": True, "seed": 42
    })


@when("saya memeriksa status fail-safe sistem", target_fixture="response")
def periksa_failsafe_status(client, headers):
    return client.get("/api/monitoring/fail-safe/status", headers=headers)


@when(parsers.parse("saya mengeksekusi siklus fail-safe pada persimpangan {pid:d}"),
      target_fixture="response")
def eksekusi_failsafe_simpang(client, headers, pid):
    return client.post(f"/api/monitoring/fail-safe/{pid}", headers=headers, params={"fixed_green": 25})


@then(parsers.parse("hasil simulasi memiliki {siklus:d} siklus"))
def cek_siklus(response, siklus):
    data = response.json()
    assert data["siklus"] == siklus


@then("rata-rata hijau per jalur terhitung")
def cek_rata_rata_hijau(response):
    data = response.json()
    assert len(data["rata_rata_hijau_per_jalur"]) == 4
    assert all(isinstance(v, (int, float)) for v in data["rata_rata_hijau_per_jalur"])


@then("simulasi mendeteksi siklus sensor offline")
def cek_sensor_offline(response):
    data = response.json()
    assert data["siklus_sensor_offline"] > 0


@then("mode fail-safe aktif dalam hasil simulasi")
def cek_failsafe_aktif(response):
    data = response.json()
    assert data["mode_fail_safe_aktif"] is True
    assert data["siklus_fail_safe"] > 0
    assert "Fail-Safe" in data["mekanisme_keamanan"]


@then("status fail-safe mencakup seluruh persimpangan")
def cek_status_persimpangan(response):
    data = response.json()
    assert "total_persimpangan" in data
    assert data["total_persimpangan"] >= 4
    assert len(data["status"]) >= 4


@then(parsers.parse('tepat satu jalur berstatus "{status}" pada mode fail-safe'))
def cek_interlocking_safety(response, status):
    data = response.json()
    assert data["fail_safe_active"] is True
    matching = [l for l in data["lanes"] if l["signal"] == status]
    assert len(matching) == 1, f"Harus tepat 1 jalur {status}"

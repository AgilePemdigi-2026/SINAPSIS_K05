"""Skenario BDD 'Kelola Sistem: parameter AI dan pengguna' (SRS 4.3.3 REQ-14, REQ-15)."""
from pytest_bdd import parsers, scenarios, then, when

scenarios("features/kelola_parameter_pengguna.feature")


@when(parsers.parse('saya mengubah parameter "{jenis}" menjadi {nilai:g}'), target_fixture="response")
def ubah_parameter(client, headers, jenis, nilai):
    return client.put("/api/admin/parameters", headers=headers, json={"jenis_parameter": jenis, "nilai": nilai})


@then(parsers.parse('parameter "{jenis}" bernilai aktif {nilai:g}'))
def cek_parameter(client, headers, jenis, nilai):
    rows = {r["jenis_parameter"]: r["nilai_aktif"] for r in client.get("/api/admin/parameters", headers=headers).json()}
    assert rows[jenis] == nilai


@when(parsers.parse('saya menambah pengguna "{nama}" dengan username "{username}" dan peran "{role}"'), target_fixture="response")
def tambah_pengguna(client, headers, nama, username, role):
    return client.post("/api/admin/users", headers=headers, json={"nama": nama, "username": username, "password": "budiSecure2026", "role": role})


@when(parsers.parse('saya menambah pengguna "{nama}" dengan password "{password}"'), target_fixture="response")
def tambah_pengguna_password(client, headers, nama, password):
    return client.post("/api/admin/users", headers=headers, json={"nama": nama, "username": "penggunauji", "password": password, "role": "Petugas Lalu Lintas"})


@then(parsers.parse('pesan respons adalah "{pesan}"'))
def cek_pesan(response, pesan):
    assert response.json()["pesan"] == pesan


@then(parsers.parse('pengguna diarahkan ke "{url}"'))
def cek_redirect(response, url):
    assert response.json()["redirect"] == url

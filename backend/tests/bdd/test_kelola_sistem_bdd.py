"""Skenario BDD 'Kelola Sistem: registrasi persimpangan' (SRS 4.3.3 REQ-12, REQ-13)."""
from pytest_bdd import parsers, scenarios, then, when

scenarios("features/kelola_sistem.feature")


@when(parsers.re(r'saya mendaftarkan persimpangan "(?P<nama>.*)" dengan deskripsi "(?P<desk>.*)" di koordinat "(?P<lat>.*)" dan "(?P<lon>.*)"'),
      target_fixture="response")
def daftar_dengan_koordinat(client, headers, nama, desk, lat, lon):
    return client.post("/api/admin/intersections", headers=headers, json={
        "nama_lokasi": nama, "deskripsi": desk, "latitude": float(lat), "longitude": float(lon)})


@when(parsers.re(r'saya mendaftarkan persimpangan "(?P<nama>.*)" tanpa koordinat'), target_fixture="response")
def daftar_tanpa_koordinat(client, headers, nama):
    return client.post("/api/admin/intersections", headers=headers, json={"nama_lokasi": nama})


@then(parsers.parse('pesan respons adalah "{pesan}"'))
def cek_pesan(response, pesan):
    assert response.json()["pesan"] == pesan


@then(parsers.parse('pengguna diarahkan ke "{url}"'))
def cek_redirect(response, url):
    assert response.json()["redirect"] == url


@then(parsers.parse('persimpangan "{nama}" tercatat dengan koordinat "{lat}" dan "{lon}"'))
def cek_tercatat(client, headers, nama, lat, lon):
    items = client.get("/api/admin/intersections", headers=headers).json()
    item = next(i for i in items if i["nama_lokasi"] == nama)
    assert (item["latitude"], item["longitude"]) == (float(lat), float(lon))

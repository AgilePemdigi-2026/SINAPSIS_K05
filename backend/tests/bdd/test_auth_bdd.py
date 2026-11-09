from pytest_bdd import parsers, scenarios, then, when

scenarios("features/auth.feature")


@when(parsers.re(r'pengguna login dengan username "(?P<username>.*)" dan password "(?P<password>.*)"'), target_fixture="response")
def login(client, username, password):
    return client.post("/api/auth/login", json={"username": username, "password": password})


@when("pengguna membuka endpoint dashboard pemantauan tanpa token", target_fixture="response")
def buka_dashboard_tanpa_token(client):
    return client.get("/api/monitoring/dashboard")


@when("saya membuka daftar pengguna di Kelola Sistem", target_fixture="response")
def buka_kelola_pengguna(client, headers):
    return client.get("/api/admin/users", headers=headers)


@then(parsers.parse('pesan respons adalah "{pesan}"'))
def cek_pesan(response, pesan):
    assert response.json()["pesan"] == pesan


@then(parsers.parse('pengguna diarahkan ke "{url}"'))
def cek_redirect(response, url):
    assert response.json()["redirect"] == url


@then(parsers.parse('menu yang tampil adalah "{menu}"'))
def cek_menu(response, menu):
    assert "; ".join(response.json()["menu"]) == menu


@then(parsers.parse('password pengguna "{username}" tersimpan sebagai hash bcrypt'))
def cek_hash(client, username):
    from app.core.database import SessionLocal
    from app.models import Pengguna
    with SessionLocal() as db:
        u = db.query(Pengguna).filter_by(username=username).one()
        assert u.password.startswith("$2") and "Secure2026" not in u.password
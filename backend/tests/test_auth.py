"""Skenario BDD 'User Authentication' (SRS / Bab V User Story)."""


def test_admin_login_success(client):
    r = client.post("/api/auth/login", json={"username": "admin_sinapsis", "password": "adminSecure2026"})
    assert r.status_code == 200
    body = r.json()
    assert body["pesan"] == "Login Berhasil!" and body["redirect"] == "/dashboard"
    assert body["menu"] == ["Pantau Kondisi Lalu Lintas", "Kelola Sistem"]


def test_petugas_login_success(client):
    r = client.post("/api/auth/login", json={"username": "petugas_lalin01", "password": "petugasPass123"})
    assert r.status_code == 200
    assert r.json()["menu"] == ["Pantau Kondisi Lalu Lintas", "Permintaan Rute Darurat"]


def test_login_missing_fields(client):
    r = client.post("/api/auth/login", json={"username": "", "password": ""})
    assert r.status_code == 400 and r.json()["detail"] == "Login gagal. Semua field harus diisi!"


def test_login_user_not_found(client):
    r = client.post("/api/auth/login", json={"username": "unknown_user", "password": "pass12345"})
    assert r.status_code == 401 and r.json()["detail"] == "Login gagal. Akun tidak terdaftar."


def test_login_wrong_password(client):
    r = client.post("/api/auth/login", json={"username": "admin_sinapsis", "password": "wrongpassword"})
    assert r.status_code == 401 and r.json()["detail"] == "Login gagal. Username atau password Anda salah."


def test_password_stored_as_hash(client):
    from app.core.database import SessionLocal
    from app.models import Pengguna
    with SessionLocal() as db:
        u = db.query(Pengguna).filter_by(username="admin_sinapsis").one()
        assert u.password != "adminSecure2026" and u.password.startswith("$2")


def test_protected_endpoint_requires_token(client):
    assert client.get("/api/monitoring/dashboard").status_code == 401


def test_role_separation(client, admin, petugas):
    assert client.get("/api/admin/users", headers=petugas).status_code == 403
    assert client.post("/api/emergency/search", headers=admin,
                       json={"lokasi_awal": "RSUD Dr. Soetomo", "tujuan": "Jalan Darmo"}).status_code == 403

"""Registrasi, Lupa Password, dan Reset Password (F7) + pastikan satu sistem akun dipakai semua fitur."""
from datetime import timedelta

import pytest

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.timeutil import utcnow
from app.models import Pengguna

NEW = {"full_name": "Petugas Baru", "username": "petugas_baru", "password": "Rahasia2026"}


def _login(client, username, password):
    return client.post("/api/auth/login", json={"username": username, "password": password})


def test_register_petugas_then_login(client):
    r = client.post("/api/auth/register", json=NEW)
    assert r.status_code == 201 and r.json()["role"] == "Petugas Lalu Lintas"
    login = _login(client, "petugas_baru", "Rahasia2026")
    assert login.status_code == 200 and login.json()["role"] == "Petugas Lalu Lintas"


def test_token_from_login_is_accepted_by_other_features(client):
    """Regresi: token hasil login harus dikenali endpoint dashboard (dulu 401 karena dua sistem login)."""
    client.post("/api/auth/register", json=NEW)
    token = _login(client, "petugas_baru", "Rahasia2026").json()["access_token"]
    r = client.get("/api/monitoring/dashboard", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200


def test_register_password_is_hashed(client):
    client.post("/api/auth/register", json=NEW)
    with SessionLocal() as db:
        u = db.query(Pengguna).filter_by(username="petugas_baru").one()
        assert u.password.startswith("$2") and "Rahasia2026" not in u.password


def test_register_admin_without_login_is_forbidden(client):
    r = client.post("/api/auth/register", json={**NEW, "role": "admin"})
    assert r.status_code == 403
    assert _login(client, "petugas_baru", "Rahasia2026").status_code == 401  # akun tidak terbentuk


def test_register_admin_by_petugas_is_forbidden(client, petugas):
    assert client.post("/api/auth/register", json={**NEW, "role": "admin"}, headers=petugas).status_code == 403


def test_register_admin_by_admin_is_allowed(client, admin):
    r = client.post("/api/auth/register", json={**NEW, "role": "Administrator"}, headers=admin)
    assert r.status_code == 201 and r.json()["role"] == "Administrator"


@pytest.mark.parametrize("payload,status", [
    ({**NEW, "username": ""}, 422),
    ({**NEW, "password": "pendek"}, 422),
    ({**NEW, "password": "tanpakapital1"}, 422),
    ({**NEW, "username": "a b"}, 422),
    ({**NEW, "role": "superuser"}, 422),
])
def test_register_validation(client, payload, status):
    assert client.post("/api/auth/register", json=payload).status_code == status


def test_register_duplicate_username(client):
    assert client.post("/api/auth/register", json={**NEW, "username": "admin_sinapsis"}).status_code == 409


def _forgot(client, username):
    return client.post("/api/auth/forgot-password", json={"username": username})


def test_forgot_and_reset_password_flow(client):
    token = _forgot(client, "petugas_lalin01").json()["reset_token"]
    r = client.post("/api/auth/reset-password", json={"reset_token": token, "new_password": "PasswordBaru1"})
    assert r.status_code == 200
    assert _login(client, "petugas_lalin01", "PasswordBaru1").status_code == 200
    assert _login(client, "petugas_lalin01", "petugasPass123").status_code == 401


def test_reset_token_is_single_use(client):
    token = _forgot(client, "petugas_lalin01").json()["reset_token"]
    body = {"reset_token": token, "new_password": "PasswordBaru1"}
    assert client.post("/api/auth/reset-password", json=body).status_code == 200
    assert client.post("/api/auth/reset-password", json=body).status_code == 400


def test_reset_token_expired(client):
    token = _forgot(client, "petugas_lalin01").json()["reset_token"]
    with SessionLocal() as db:
        u = db.query(Pengguna).filter_by(username="petugas_lalin01").one()
        u.reset_token_expires = utcnow() - timedelta(minutes=1)
        db.commit()
    r = client.post("/api/auth/reset-password", json={"reset_token": token, "new_password": "PasswordBaru1"})
    assert r.status_code == 400 and "kedaluwarsa" in r.json()["detail"]


def test_reset_token_invalid_and_weak_password(client):
    assert client.post("/api/auth/reset-password",
                       json={"reset_token": "salah", "new_password": "PasswordBaru1"}).status_code == 400
    token = _forgot(client, "petugas_lalin01").json()["reset_token"]
    assert client.post("/api/auth/reset-password",
                       json={"reset_token": token, "new_password": "lemah"}).status_code == 422


def test_reset_token_stored_as_hash(client):
    token = _forgot(client, "petugas_lalin01").json()["reset_token"]
    with SessionLocal() as db:
        assert db.query(Pengguna).filter_by(username="petugas_lalin01").one().reset_token != token


def test_forgot_unknown_username_does_not_reveal_account(client):
    r = _forgot(client, "tidak_ada")
    assert r.status_code == 200 and "reset_token" not in r.json()


def test_forgot_hides_token_when_not_exposed(client, monkeypatch):
    monkeypatch.setattr(settings, "EXPOSE_RESET_TOKEN", False)
    r = _forgot(client, "petugas_lalin01")
    assert r.status_code == 200 and "reset_token" not in r.json()

"""Langkah (step) BDD yang dipakai bersama oleh semua fitur. Fixture client/admin/petugas dari tests/conftest.py."""
from pytest_bdd import given, parsers, then


@given("sistem SINAPSIS berjalan dengan data awal")
def sistem_berjalan(client):
    return client


@given("saya login sebagai Administrator", target_fixture="headers")
def login_admin(admin):
    return admin


@given("saya login sebagai Petugas Lalu Lintas", target_fixture="headers")
def login_petugas(petugas):
    return petugas


@then(parsers.parse("respons berstatus {kode:d}"))
def cek_status(response, kode):
    assert response.status_code == kode, response.text


@then(parsers.parse('pesan galat adalah "{pesan}"'))
def cek_pesan_galat(response, pesan):
    assert response.json()["detail"] == pesan
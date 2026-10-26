import os
import tempfile

_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp.name}"
os.environ["SEED_DEMO_DATA"] = "true"
os.environ["BCRYPT_ROUNDS"] = "4"  # mempercepat tes; produksi pakai default 12

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.services import monitoring_service as svc  # noqa: E402
from app.services.seed import seed  # noqa: E402


@pytest.fixture()
def client():
    """Database bersih + data seed untuk setiap tes."""
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        seed(db)
    svc.hub.reset()
    with TestClient(app) as c:
        yield c


def _login(client, username, password):
    r = client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture()
def admin(client):
    return _login(client, "admin_sinapsis", "adminSecure2026")


@pytest.fixture()
def petugas(client):
    return _login(client, "petugas_lalin01", "petugasPass123")

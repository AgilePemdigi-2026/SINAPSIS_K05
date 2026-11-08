"""Koneksi database (SQLAlchemy). Default SQLite; ganti DATABASE_URL untuk PostgreSQL."""
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings

_args = {"check_same_thread": False} if settings.DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(settings.DATABASE_URL, connect_args=_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def ensure_schema() -> None:
    """Menambah kolom baru pada database lama (create_all tidak mengubah tabel yang sudah ada)."""
    from sqlalchemy import inspect, text

    insp = inspect(engine)
    if "pengguna" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("pengguna")}
    with engine.begin() as conn:
        if "reset_token" not in cols:
            conn.execute(text("ALTER TABLE pengguna ADD COLUMN reset_token VARCHAR(64)"))
        if "reset_token_expires" not in cols:
            conn.execute(text("ALTER TABLE pengguna ADD COLUMN reset_token_expires TIMESTAMP"))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

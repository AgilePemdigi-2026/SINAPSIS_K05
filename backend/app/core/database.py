"""Koneksi database (SQLAlchemy). Default SQLite; ganti DATABASE_URL untuk PostgreSQL."""
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings


def _resolve_database_url(url: str) -> str:
    """Anchor relative SQLite paths to the repository root, not the CWD."""
    if not url.startswith("sqlite:///"):
        return url
    raw_path = url.removeprefix("sqlite:///")
    if raw_path == ":memory:":
        return url
    path = Path(raw_path)
    if not path.is_absolute():
        path = (Path(__file__).resolve().parents[3] / path).resolve()
    return f"sqlite:///{path.as_posix()}"


DATABASE_URL = _resolve_database_url(settings.DATABASE_URL)
_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def ensure_schema() -> None:
    """Menambah kolom baru pada database lama (create_all tidak mengubah tabel yang sudah ada)."""
    from sqlalchemy import inspect, text

    # tabel -> {kolom: definisi SQL}; hanya kolom yang belum ada yang ditambahkan
    wanted = {
        "pengguna": {"reset_token": "VARCHAR(64)", "reset_token_expires": "TIMESTAMP"},
        "persimpangan": {
            "kode_simpang": "VARCHAR(30)",
            "latitude": "FLOAT",
            "longitude": "FLOAT",
            "detektor_virtual": "BOOLEAN NOT NULL DEFAULT TRUE",
            "aktif_loop_virtual": "BOOLEAN NOT NULL DEFAULT TRUE",
            "status_sensor": "VARCHAR(30) NOT NULL DEFAULT 'ONLINE'",
        },
        "jalur": {"vision_preview": "TEXT"},
    }
    insp = inspect(engine)
    tables = set(insp.get_table_names())
    with engine.begin() as conn:
        for table, columns in wanted.items():
            if table not in tables:
                continue
            have = {c["name"] for c in insp.get_columns(table)}
            for name, ddl in columns.items():
                if name not in have:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

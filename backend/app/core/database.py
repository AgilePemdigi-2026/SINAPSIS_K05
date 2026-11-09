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

    # tabel -> {kolom: definisi SQL}; hanya kolom yang belum ada yang ditambahkan
    wanted = {
        "pengguna": {"reset_token": "VARCHAR(64)", "reset_token_expires": "TIMESTAMP"},
        "persimpangan": {"latitude": "FLOAT", "longitude": "FLOAT",
                         "detektor_virtual": "BOOLEAN NOT NULL DEFAULT TRUE"},
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

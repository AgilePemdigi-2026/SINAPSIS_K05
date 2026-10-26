"""Waktu UTC tanpa tzinfo (cocok dengan kolom DateTime SQLite/PostgreSQL)."""
from datetime import datetime, timezone


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)

"""Database connection helpers (psycopg 3, plain SQL).

PostGIS and pgvector live in the `extensions` schema (Supabase's convention),
so every connection puts that schema on its search path.
"""

from __future__ import annotations

import psycopg
from psycopg.rows import dict_row

from worldgraph.config import get_settings

SEARCH_PATH_SQL = "set search_path to public, extensions"


class DatabaseNotConfiguredError(RuntimeError):
    """Raised when DATABASE_URL is missing or still the placeholder."""

    def __init__(self) -> None:
        super().__init__(
            "DATABASE_URL is not set. Copy .env.example to .env and paste your "
            "Supabase connection string (see README, 'Connect the database')."
        )


def database_url() -> str:
    settings = get_settings()
    if not settings.database_configured:
        raise DatabaseNotConfiguredError()
    assert settings.database_url is not None
    return settings.database_url


def configure_connection(conn: psycopg.Connection) -> None:
    """Run on every new connection (also used by the API's connection pool)."""
    with conn.cursor() as cur:
        cur.execute(SEARCH_PATH_SQL)
    if not conn.autocommit:
        conn.commit()


def connect(url: str | None = None, *, autocommit: bool = False) -> psycopg.Connection:
    """Open one connection. Rows come back as dicts.

    prepare_threshold=None turns off server-side prepared statements, which
    keeps us compatible with Supabase's connection pooler.
    """
    conn = psycopg.connect(
        url or database_url(),
        autocommit=autocommit,
        row_factory=dict_row,
        prepare_threshold=None,
        connect_timeout=10,
    )
    configure_connection(conn)
    return conn

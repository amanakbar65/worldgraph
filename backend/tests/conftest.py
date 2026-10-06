"""Shared test setup.

Tests never use your real .env database. Tests that need Postgres run only
when TEST_DATABASE_URL points at a server where the user may create
databases. Each test session creates its own temporary database there
(with PostGIS and pgvector) and drops it at the end.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator

import psycopg
import pytest
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from worldgraph.config import get_settings
from worldgraph.db import connect
from worldgraph.db.migrate import migrate


@pytest.fixture(autouse=True)
def _isolated_settings(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("DATABASE_URL", "")
    monkeypatch.setenv("WG_DEV_VIEWER_COUNTRY", "")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture(scope="session")
def migrated_db_url() -> Iterator[str]:
    """A brand-new database with every migration applied."""
    admin_url = os.environ.get("TEST_DATABASE_URL")
    if not admin_url:
        pytest.skip("Set TEST_DATABASE_URL to run database tests")
    name = f"wg_test_{uuid.uuid4().hex[:8]}"
    with psycopg.connect(admin_url, autocommit=True) as admin:
        admin.execute(f'create database "{name}"')
    url = make_conninfo(**{**conninfo_to_dict(admin_url), "dbname": name})
    try:
        with connect(url) as conn:
            migrate(conn)
        yield url
    finally:
        with psycopg.connect(admin_url, autocommit=True) as admin:
            admin.execute(f'drop database if exists "{name}" with (force)')


@pytest.fixture
def db(migrated_db_url: str) -> Iterator[psycopg.Connection]:
    """A connection whose changes are rolled back after each test."""
    with connect(migrated_db_url) as conn:
        yield conn
        conn.rollback()

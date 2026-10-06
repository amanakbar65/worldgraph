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
from datetime import UTC, datetime

import psycopg
import pytest
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from worldgraph.config import get_settings
from worldgraph.db import connect
from worldgraph.db.migrate import migrate

# Sample data is loaded relative to this moment, so tests are repeatable.
FIXED_NOW = datetime(2026, 10, 6, 12, 0, tzinfo=UTC)


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


@pytest.fixture(scope="session")
def seeded_db_url(migrated_db_url: str) -> str:
    """The migrated test database with the sample data loaded (fixed clock)."""
    from worldgraph.seed.build import build_bundle
    from worldgraph.seed.load import load_bundle

    bundle = build_bundle(now=FIXED_NOW)
    with connect(migrated_db_url) as conn:
        load_bundle(conn, bundle)
        # Move the sample clock to real time so "last 24 hours" means something.
        conn.execute("select api.refresh_sample_clock()")
        conn.commit()
    return migrated_db_url


@pytest.fixture
def sdb(seeded_db_url: str) -> Iterator[psycopg.Connection]:
    """A connection to the seeded database; changes are rolled back."""
    with connect(seeded_db_url) as conn:
        yield conn
        conn.rollback()

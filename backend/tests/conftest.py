"""Shared test setup.

Tests never use your real .env database. Tests marked `db` run only when
TEST_DATABASE_URL points at a throwaway Postgres (with PostGIS and pgvector).
"""

from __future__ import annotations

import os

import pytest

from worldgraph.config import get_settings


@pytest.fixture(autouse=True)
def _isolated_settings(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("DATABASE_URL", "")
    monkeypatch.setenv("WG_DEV_VIEWER_COUNTRY", "")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def test_db_url() -> str:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("Set TEST_DATABASE_URL to run database tests")
    return url

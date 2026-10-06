"""The WorldGraph API (FastAPI).

Run it with `uv run wg api`, then open http://localhost:8000/docs.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from worldgraph import __version__
from worldgraph.config import get_settings
from worldgraph.db import configure_connection


def _open_pool() -> ConnectionPool | None:
    settings = get_settings()
    if not settings.database_configured:
        return None
    pool = ConnectionPool(
        settings.database_url,
        min_size=1,
        max_size=5,
        open=False,
        timeout=5,
        configure=configure_connection,
        kwargs={"autocommit": True, "row_factory": dict_row, "prepare_threshold": None},
    )
    # Don't block start-up if the database is asleep or unreachable;
    # /api/health reports the problem instead.
    pool.open(wait=False)
    return pool


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.pool = _open_pool()
    yield
    if app.state.pool is not None:
        app.state.pool.close()


app = FastAPI(
    title="WorldGraph API",
    version=__version__,
    summary="What is changing in the world, why, what's likely next, and what it means for you.",
    lifespan=lifespan,
)


def _database_health(pool: ConnectionPool | None) -> dict[str, Any]:
    if pool is None:
        return {"status": "not_configured", "hint": "Set DATABASE_URL in .env"}
    try:
        with pool.connection() as conn:
            row = conn.execute(
                """
                select
                  (select extversion from pg_extension where extname = 'postgis') as postgis,
                  (select extversion from pg_extension where extname = 'vector') as pgvector,
                  to_regclass('public.node') is not null as has_schema
                """
            ).fetchone()
            counts: dict[str, int] = {}
            if row and row["has_schema"]:
                counts = (
                    conn.execute(
                        """
                    select
                      count(*) filter (where type = 'story') as stories,
                      count(*) filter (where type = 'forecast') as forecasts,
                      count(*) filter (where type not in ('story', 'forecast')) as entities,
                      count(*) filter (where is_sample) as sample_nodes
                    from node
                    """
                    ).fetchone()
                    or {}
                )
            has_schema = bool(row and row["has_schema"])
            return {
                "status": "ok",
                "postgis": row["postgis"] if row else None,
                "pgvector": row["pgvector"] if row else None,
                "schema": "ready" if has_schema else "missing: run `uv run wg db migrate`",
                "counts": counts,
            }
    except Exception as exc:  # noqa: BLE001 - health checks report, never raise
        return {"status": "unreachable", "error": type(exc).__name__, "detail": str(exc)[:200]}


@app.get("/api/health", tags=["system"])
def health() -> dict[str, Any]:
    """Is the API up, and can it reach the database?"""
    return {
        "status": "ok",
        "version": __version__,
        "environment": get_settings().wg_env,
        "database": _database_health(app.state.pool),
    }

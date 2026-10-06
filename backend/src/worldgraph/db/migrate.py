"""A tiny migration runner.

Migrations are plain SQL files in db/migrations/, named NNNN_short_name.sql.
Each runs once, inside a transaction, and is recorded in schema_migrations.
Never edit a migration after it has been applied anywhere; add a new file.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import psycopg

from worldgraph.db import SEARCH_PATH_SQL

MIGRATIONS_DIR = Path(__file__).parent / "migrations"
_NAME = re.compile(r"^(\d{4})_([a-z0-9_]+)\.sql$")

_CREATE_TABLE = """
create table if not exists public.schema_migrations (
    version text primary key,
    name text not null,
    applied_at timestamptz not null default now()
)
"""


@dataclass(frozen=True)
class Migration:
    version: str
    name: str
    path: Path

    def sql(self) -> str:
        return self.path.read_text(encoding="utf-8")


def list_migrations(directory: Path = MIGRATIONS_DIR) -> list[Migration]:
    migrations = []
    for path in sorted(directory.glob("*.sql")):
        match = _NAME.match(path.name)
        if not match:
            raise ValueError(f"Bad migration file name: {path.name} (expected NNNN_name.sql)")
        migrations.append(Migration(version=match[1], name=match[2], path=path))
    versions = [m.version for m in migrations]
    if len(versions) != len(set(versions)):
        raise ValueError("Two migration files share the same number.")
    return migrations


def applied_versions(conn: psycopg.Connection) -> set[str]:
    with conn.transaction():
        conn.execute(_CREATE_TABLE)
    rows = conn.execute("select version from public.schema_migrations").fetchall()
    return {row["version"] if isinstance(row, dict) else row[0] for row in rows}


def pending(conn: psycopg.Connection, directory: Path = MIGRATIONS_DIR) -> list[Migration]:
    done = applied_versions(conn)
    return [m for m in list_migrations(directory) if m.version not in done]


def migrate(conn: psycopg.Connection, directory: Path = MIGRATIONS_DIR) -> list[Migration]:
    """Apply every pending migration in order. Returns the ones applied."""
    applied = []
    for migration in pending(conn, directory):
        with conn.transaction():
            conn.execute(SEARCH_PATH_SQL)
            conn.execute(migration.sql())
            conn.execute(
                "insert into public.schema_migrations (version, name) values (%s, %s)",
                (migration.version, migration.name),
            )
        applied.append(migration)
    return applied

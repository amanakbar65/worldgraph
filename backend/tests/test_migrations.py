import psycopg
import pytest

from worldgraph.db.migrate import list_migrations, migrate, pending


def test_migration_files_are_well_named():
    migrations = list_migrations()
    assert migrations, "expected at least one migration"
    assert [m.version for m in migrations] == sorted(m.version for m in migrations)


def test_migrate_is_idempotent(db):
    assert pending(db) == []
    assert migrate(db) == []


def test_extensions_installed(db):
    rows = db.execute("select extname from pg_extension").fetchall()
    names = {r["extname"] for r in rows}
    assert {"postgis", "vector", "pg_trgm"} <= names


def test_node_id_format_is_enforced(db):
    with pytest.raises(psycopg.errors.CheckViolation):
        db.execute("insert into node (id, type, name) values ('Region:IN', 'region', 'India')")


def test_headline_word_limit_is_enforced(db):
    db.execute("insert into node (id, type, name) values ('story:x', 'story', 'x')")
    long_headline = " ".join(["word"] * 13)
    with pytest.raises(psycopg.errors.CheckViolation):
        db.execute(
            """insert into story (node_id, headline, so_what, event_type, impact, first_seen)
               values ('story:x', %s, 'Short so-what.', 'test', 'risk', now())""",
            (long_headline,),
        )


def test_conditional_links_need_a_forecast(db):
    db.execute(
        """insert into node (id, type, name) values
           ('story:a', 'story', 'a'), ('story:b', 'story', 'b')"""
    )
    for sid in ("story:a", "story:b"):
        db.execute(
            """insert into story (node_id, headline, so_what, event_type, impact, first_seen)
               values (%s, 'A headline', 'A so-what.', 'test', 'neutral', now())""",
            (sid,),
        )
    with pytest.raises(psycopg.errors.CheckViolation):
        db.execute(
            """insert into causal_link
               (src_story, dst_story, link_type, mechanism, direction, confidence, method)
               values ('story:a', 'story:b', 'conditional', 'raises input costs',
                       'up', 0.5, 'test')"""
        )


def test_every_table_has_row_level_security(db):
    rows = db.execute(
        """select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity"""
    ).fetchall()
    assert rows == [], f"tables without row-level security: {rows}"

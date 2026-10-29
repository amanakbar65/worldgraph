import json
import os
import uuid
from collections.abc import Iterator
from typing import Any

import psycopg
import pytest
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from worldgraph.db import connect
from worldgraph.db.migrate import (
    DOWN_DIR,
    FIRST_REVERSIBLE,
    MIGRATIONS_DIR,
    list_migrations,
    migrate,
    pending,
    rollback,
)


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


# ---------------------------------------------------------------------------
# Down files (0021 on) and reversibility
# ---------------------------------------------------------------------------


def test_new_migrations_have_down_files():
    for m in list_migrations():
        if m.version >= FIRST_REVERSIBLE:
            assert m.down_path.exists(), f"{m.path.name} needs {m.down_path.relative_to(MIGRATIONS_DIR)}"
            assert m.down_path.parent == DOWN_DIR
    # The runner reads only *.sql directly in migrations/, never down/.
    assert all(m.path.parent == MIGRATIONS_DIR for m in list_migrations())
    assert not any(m.path.name.endswith(".down.sql") for m in list_migrations())


@pytest.fixture
def scratch_db_url() -> Iterator[str]:
    """A brand-new, empty database of its own (the test migrates it up and down)."""
    admin_url = os.environ.get("TEST_DATABASE_URL")
    if not admin_url:
        pytest.skip("Set TEST_DATABASE_URL to run database tests")
    name = f"wg_test_rev_{uuid.uuid4().hex[:8]}"
    with psycopg.connect(admin_url, autocommit=True) as admin:
        admin.execute(f'create database "{name}"')
    try:
        yield make_conninfo(**{**conninfo_to_dict(admin_url), "dbname": name})
    finally:
        with psycopg.connect(admin_url, autocommit=True) as admin:
            admin.execute(f'drop database if exists "{name}" with (force)')


def _one(conn: psycopg.Connection, sql: str, *params: Any) -> Any:
    row = conn.execute(sql, params).fetchone()
    assert row is not None
    return next(iter(row.values()))


def _api(conn: psycopg.Connection, name: str, args: dict[str, Any]) -> Any:
    return _one(conn, f"select api.{name}(%s::jsonb)", json.dumps(args))


@pytest.mark.db
def test_migrations_reversible(scratch_db_url):
    """Up to head, down through every reversible migration, up again; the
    sample data loads and live-style rows (pipeline news, a forecast, AI
    analysis) are written at each head, and survive the trip."""
    from tests.conftest import FIXED_NOW
    from tests.contract import check
    from tests.live_style import write_all
    from worldgraph.seed.build import build_bundle
    from worldgraph.seed.load import load_bundle

    bundle = build_bundle(now=FIXED_NOW)
    reversible = [m.version for m in list_migrations() if m.version >= FIRST_REVERSIBLE]
    with connect(scratch_db_url) as conn:
        # 1. Head, sample data, live-style rows.
        migrate(conn)
        load_bundle(conn, bundle)
        first = write_all(conn, "rev-one", 0)
        conn.commit()
        nodes, edges, links = (
            _one(conn, "select count(*) from node"),
            _one(conn, "select count(*) from edge"),
            _one(conn, "select count(*) from causal_link"),
        )

        # 2. Down, newest first: the schema is 0020's again and the old api works.
        undone = rollback(conn, FIRST_REVERSIBLE)
        assert [m.version for m in undone] == sorted(reversible, reverse=True)
        assert _one(conn, "select max(version) from schema_migrations") < FIRST_REVERSIBLE
        assert _one(conn, "select to_regclass('public.node_type') is null")
        assert _one(conn, "select to_regclass('public.relation_type') is null")
        assert _one(conn, "select to_regclass('public.app_flag') is null")
        assert _one(conn, "select to_regnamespace('history') is null")
        assert (
            _one(
                conn,
                """select count(*) from information_schema.columns
               where table_schema = 'public' and column_name in ('source_id', 'created_by')""",
            )
            == 0
        )
        assert _one(conn, "select to_regclass('public.evidence_edge_idx') is null")
        assert _one(conn, "select count(*) from source where id in ('curated', 'crowd-forecasts')") == 0
        assert (
            _one(
                conn,
                """select count(*) from information_schema.columns
               where (table_name, column_name) in (('node', 'properties'), ('causal_link', 'polarity'))""",
            )
            == 0
        )
        assert (
            _one(
                conn,
                "select count(*) from pg_constraint where conname in ('node_type_check', 'edge_type_check')",
            )
            == 2
        )
        assert _one(conn, "select count(*) from node") == nodes
        assert _one(conn, "select count(*) from causal_link") == links
        # Only the links of relation types 0022 added are gone (operates → owns again).
        assert _one(conn, "select count(*) from edge") == edges
        assert (
            _one(conn, "select type from edge where src = 'org:dp-world' and dst = 'infra:jebel-ali-port'")
            == "owns"
        )
        entity = _api(conn, "entity", {"id": "org:dp-world", "sample": True})
        assert "properties" not in entity and entity["entity"]["name"] == "DP World"
        assert "flags" not in _api(conn, "meta", {})
        assert _api(conn, "graph", {"sample": True, "window": "30d"})["nodes"]
        cascade = _api(conn, "cascade", {"id": first["effect"]})
        assert cascade["links"] and "polarity" not in cascade["links"][0]
        assert "relation" not in _api(conn, "local_graph", {"id": "region:in", "depth": 2})["links"][0]
        # A curated node with free-text facts, as an older writer might leave it.
        conn.execute(
            """insert into node (id, type, subtype, name, props)
               values ('org:kg-facts', 'organization', 'company', 'Facts Co',
                       '{"facts": {"Founded": "1904", "Website": "https://facts.example", "Motto": "Ship it",
                                   "HQ": "region:dk"}}')"""
        )
        conn.commit()

        # 3. Up again: backfills run on the old-shape data.
        assert [m.version for m in migrate(conn)] == reversible
        facts = conn.execute("select properties, props from node where id = 'org:kg-facts'").fetchone()
        assert facts == {
            "properties": {
                "founded": "1904",
                "website": "https://facts.example",
                "headquarters": "region:dk",
            },
            "props": {"facts": {"Motto": "Ship it"}},
        }
        assert (
            _one(conn, "select properties ->> 'hs_code' from node where id = 'commodity:crude-oil'") == "2709"
        )
        assert _one(conn, "select properties -> 'scope' from node where id = 'policy:usmca'") == [
            "region:us",
            "region:mx",
            "region:ca",
        ]
        assert (
            _one(conn, "select type from edge where src = 'org:dp-world' and dst = 'infra:jebel-ali-port'")
            == "operates"
        )
        wrong = _one(
            conn,
            """select count(*) from causal_link cl join story s on s.node_id = cl.src_story
               where cl.polarity is distinct from
                     (case when s.direction = cl.direction then 1 else -1 end)""",
        )
        assert wrong == 0
        assert _one(conn, "select polarity from causal_link where dst_story = %s", first["effect"]) == 1
        # 0023's backfill on rows written before it: sources and creators.
        assert conn.execute(
            "select source_id, created_by from node where id = %s", (first["cause"],)
        ).fetchone() == {"source_id": "gdelt", "created_by": "pipeline:news"}
        # (write_all saves the news and the AI analysis in one transaction, so
        # every mention matches analysed_at; in production they are separate runs.)
        assert {
            r["created_by"]
            for r in conn.execute(
                "select distinct created_by from edge where src = %s and type = 'mentions'",
                (first["effect"],),
            ).fetchall()
        } <= {"pipeline:news", "ai:test-model"}
        assert (
            _one(
                conn,
                """select created_by from edge
                   where src = %s and type = 'mentions' and dst = 'commodity:crude-oil'""",
                first["effect"],
            )
            == "ai:test-model"
        )
        assert _one(conn, "select created_by from causal_link where dst_story = %s", first["effect"]) == (
            "ai:test-model"
        )
        assert conn.execute(
            "select source_id, created_by from node where id = %s", (first["forecast"],)
        ).fetchone() == {"source_id": "manifold", "created_by": "pipeline:forecasts"}
        assert _one(conn, "select source_id from node where id = 'region:in-gj'") == "natural-earth"
        assert _one(conn, "select source_id from node where id = 'org:dp-world'") == "curated"
        # 0024's baseline: history starts now, with a snapshot of the live graph.
        snapshots = _one(conn, "select count(*) from history.change_log where op = 'snapshot'")
        assert snapshots == _one(conn, "select count(*) from node where not is_sample") + _one(
            conn, "select count(*) from edge where not is_sample and type <> 'mentions'"
        ) + _one(
            conn, "select count(distinct src) from edge where not is_sample and type = 'mentions'"
        ) + _one(conn, "select count(*) from causal_link where not is_sample")
        mark = _one(conn, "select max(id) from history.change_log")

        # 4. The sample data loads again and the pipeline and AI analysis write again.
        load_bundle(conn, bundle)
        second = write_all(conn, "rev-two", 1)
        conn.commit()
        assert _one(conn, "select properties ->> 'headquarters' from node where id = 'org:dp-world'") == (
            "region:ae-du.dubai"
        )
        assert _one(conn, "select polarity from causal_link where dst_story = %s", second["effect"]) == 1
        assert (
            _one(conn, "select count(*) from edge where src = %s and type = 'mentions'", second["effect"]) > 0
        )
        assert (
            _one(conn, "select count(*) from edge where src = %s and type = 'about'", second["forecast"]) > 0
        )
        entity = check("entity", _api(conn, "entity", {"id": "org:dp-world", "sample": True}))
        assert entity["properties"] and entity["connections"]
        check("meta", _api(conn, "meta", {}))
        check("schema", _api(conn, "schema", {"sample": True}))
        check("cascade", _api(conn, "cascade", {"id": second["effect"]}))
        # Provenance and history for what was written after the round trip.
        check("provenance", _api(conn, "provenance", {"target": "node", "id": second["effect"]}))
        actors = {
            r["actor"]
            for r in conn.execute(
                "select distinct actor from history.change_log where id > %s", (mark,)
            ).fetchall()
        }
        # the news write declares no actor (the pipeline sets one per job); AI analysis does
        assert {"pipeline", "ai:test-model"} <= actors
        at = _one(conn, "select clock_timestamp()::text")
        as_of = check("graph_as_of", _api(conn, "graph_as_of", {"at": at, "sample": False, "window": "30d"}))
        assert {second["cause"], second["effect"]} <= {n["id"] for n in as_of["nodes"]}

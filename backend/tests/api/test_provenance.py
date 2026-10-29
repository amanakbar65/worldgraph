"""Phase A3: sources on everything (migration 0023).

Every node, edge and causal link names its source and creator; the database
refuses rows without them; the real writers (pipeline, forecasts, AI
analysis, sample data) set them; api.provenance explains any node or link;
graph, cascade and connection links say when they are weak.
"""

from __future__ import annotations

import json
from typing import Any

import psycopg
import pytest

from tests.api.test_story_graph import REAL_MONEY, add_real_money_forecast
from tests.contract import call, check
from tests.live_style import write_all
from worldgraph.db import connect

pytestmark = pytest.mark.db


def prov(conn: psycopg.Connection, target: str, ident: Any, **extra: Any) -> dict[str, Any]:
    return check("provenance", call(conn, "provenance", {"target": target, "id": ident, **extra}))


def error(conn: psycopg.Connection, name: str, args: dict[str, Any]) -> str:
    with pytest.raises(psycopg.errors.RaiseException) as caught:
        call(conn, name, args)
    conn.rollback()
    return str(caught.value).splitlines()[0]


def one(conn: psycopg.Connection, sql: str, *params: Any) -> Any:
    row = conn.execute(sql, params).fetchone()
    assert row is not None
    return next(iter(row.values()))


@pytest.fixture
def plain(seeded_db_url: str):
    """A connection that declares no actor or source (as a careless writer would)."""
    with connect(seeded_db_url) as conn:
        yield conn
        conn.rollback()


# ---------------------------------------------------------------------------
# Columns, backfill rules and the NOT NULL rule
# ---------------------------------------------------------------------------


def test_every_row_has_a_source_and_a_creator(sdb):
    for table in ("node", "edge"):
        assert one(sdb, f"select count(*) from {table} where source_id is null or created_by is null") == 0
    assert one(sdb, "select count(*) from causal_link where created_by is null") == 0
    nullable = {
        (r["table_name"], r["column_name"])
        for r in sdb.execute(
            """select table_name, column_name from information_schema.columns
               where table_schema = 'public' and is_nullable = 'YES'
                 and (table_name, column_name) in (('node', 'source_id'), ('node', 'created_by'),
                      ('edge', 'source_id'), ('edge', 'created_by'), ('causal_link', 'created_by'))"""
        ).fetchall()
    }
    assert nullable == set()


def test_the_seed_names_its_sources(sdb):
    rows = {
        r["id"]: (r["source_id"], r["created_by"], r["kind"])
        for r in sdb.execute(
            """select id, source_id, created_by, kind from node
               where id in ('region:in-gj', 'org:dp-world', 'region:eu', 'story:red-sea-attacks-reroute')"""
        ).fetchall()
    }
    assert rows["region:in-gj"] == ("natural-earth", "gazetteer", "reported")
    assert rows["org:dp-world"] == ("curated", "curated", "reported")
    assert rows["region:eu"] == ("curated", "curated", "reported")  # a bloc is curated, not a gazetteer row
    assert rows["story:red-sea-attacks-reroute"][:2] == ("sample", "sample")
    assert (
        one(
            sdb,
            """select count(*) from node
               where type = 'story' and subtype = 'projected' and kind <> 'projected'""",
        )
        == 0
    )
    part_of = sdb.execute(
        "select source_id, created_by from edge where src = 'region:in-gj' and type = 'part_of'"
    ).fetchone()
    assert part_of == {"source_id": "natural-earth", "created_by": "gazetteer"}
    operates = sdb.execute(
        "select source_id, created_by from edge where src = 'org:dp-world' and type = 'operates'"
    ).fetchone()
    assert operates == {"source_id": "curated", "created_by": "curated"}
    assert one(sdb, "select count(*) from edge where is_sample and source_id <> 'sample'") == 0
    assert one(sdb, "select count(*) from causal_link where is_sample and created_by <> 'sample'") == 0


def test_rows_without_a_source_or_creator_are_refused(plain):
    with pytest.raises(psycopg.errors.NotNullViolation):
        plain.execute("insert into node (id, type, name) values ('org:prov-none', 'organization', 'None Co')")
    plain.rollback()
    with pytest.raises(psycopg.errors.NotNullViolation):
        plain.execute(
            """insert into node (id, type, name, source_id)
               values ('org:prov-none', 'organization', 'None Co', 'curated')"""
        )
    plain.rollback()
    with pytest.raises(psycopg.errors.NotNullViolation):
        plain.execute("insert into edge (src, dst, type) values ('org:dp-world', 'region:ae', 'located_in')")
    plain.rollback()
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        plain.execute(
            """insert into node (id, type, name, source_id, created_by)
               values ('org:prov-none', 'organization', 'None Co', 'nowhere', 'test')"""
        )
    plain.rollback()
    # Named per row, or declared for the session.
    plain.execute(
        """insert into node (id, type, name, source_id, created_by)
           values ('org:prov-row', 'organization', 'Row Co', 'curated', 'curated')"""
    )
    plain.execute(
        "select set_config('wg.actor', 'enrichment:test', true), set_config('wg.source', 'curated', true)"
    )
    plain.execute(
        "insert into node (id, type, name) values ('org:prov-session', 'organization', 'Session Co')"
    )
    assert plain.execute(
        "select source_id, created_by from node where id = 'org:prov-session'"
    ).fetchone() == {"source_id": "curated", "created_by": "enrichment:test"}


def test_the_writers_name_source_and_creator(plain):
    """The pipeline, the forecast sync and AI analysis, on a session that declares nothing."""
    written = write_all(plain, "prov", 2)
    cause, effect, forecast = written["cause"], written["effect"], written["forecast"]
    story = plain.execute("select source_id, created_by, kind from node where id = %s", (cause,)).fetchone()
    assert story == {"source_id": "gdelt", "created_by": "pipeline:news", "kind": "reported"}
    by = {
        r["created_by"]
        for r in plain.execute(
            "select distinct created_by from edge where src = %s and type = 'mentions'", (effect,)
        ).fetchall()
    }
    assert by == {"pipeline:news", "ai:test-model"}
    assert one(plain, "select count(*) from edge where src = %s and source_id <> 'gdelt'", effect) == 0, (
        "a mention takes the story's source"
    )
    assert one(plain, "select created_by from causal_link where dst_story = %s", effect) == "ai:test-model"
    fc = plain.execute("select source_id, created_by from node where id = %s", (forecast,)).fetchone()
    assert fc == {"source_id": "manifold", "created_by": "pipeline:forecasts"}
    assert {
        (r["source_id"], r["created_by"])
        for r in plain.execute(
            "select source_id, created_by from edge where src = %s", (forecast,)
        ).fetchall()
    } == {("manifold", "pipeline:forecasts")}
    # save_analysis leaves the session's actor as it found it.
    assert one(plain, "select coalesce(current_setting('wg.actor', true), '')") == ""


def test_story_source_follows_the_feed(sdb):
    rule = {
        '["gdelt"]': "gdelt",
        '["gdelt", "rss"]': "news-feeds",
        '["rss", "usgs"]': "usgs",
        '["gdacs"]': "gdacs",
        "[]": "news-feeds",
    }
    for providers, source in rule.items():
        got = one(sdb, "select api._story_source(jsonb_build_object('providers', %s::jsonb))", providers)
        assert got == source, providers
    from worldgraph.pipeline.store import story_source

    for providers, source in rule.items():
        assert story_source(json.loads(providers)) == source, providers


def test_updated_at_follows_real_link_changes(sdb):
    sdb.execute(
        """update edge set updated_at = now() - interval '3 days', created_at = now() - interval '3 days'
           where src = 'org:dp-world' and type = 'operates'"""
    )
    sdb.commit()
    try:
        before = one(sdb, "select updated_at from edge where src = 'org:dp-world' and type = 'operates'")
        sdb.execute("update edge set props = props where src = 'org:dp-world' and type = 'operates'")
        assert (
            one(sdb, "select updated_at from edge where src = 'org:dp-world' and type = 'operates'") == before
        )
        sdb.execute("update edge set confidence = 0.9 where src = 'org:dp-world' and type = 'operates'")
        assert (
            one(sdb, "select updated_at from edge where src = 'org:dp-world' and type = 'operates'") > before
        )
    finally:
        sdb.rollback()
        sdb.execute(
            """update edge set updated_at = created_at, confidence = null
               where src = 'org:dp-world' and type = 'operates'"""
        )
        sdb.commit()


# ---------------------------------------------------------------------------
# Evidence for edges and nodes
# ---------------------------------------------------------------------------


def test_evidence_has_exactly_one_target(sdb):
    edge_id = one(sdb, "select id from edge where src = 'org:dp-world' and type = 'operates'")
    link_id = one(sdb, "select id from causal_link order by id limit 1")
    with pytest.raises(psycopg.errors.CheckViolation):
        sdb.execute(
            """insert into evidence (causal_link_id, edge_id, source_name, url, snippet)
               values (%s, %s, 'Both', 'https://x.example', 'Two targets.')""",
            (link_id, edge_id),
        )
    sdb.rollback()
    with pytest.raises(psycopg.errors.CheckViolation):
        sdb.execute(
            """insert into evidence (source_name, url, snippet)
               values ('None', 'https://x.example', 'No target.')"""
        )
    sdb.rollback()
    sdb.execute(
        """insert into evidence (edge_id, source_name, url, published_at, snippet)
           values (%s, 'DP World annual report', 'https://dpworld.example/report', '2026-03-01',
                   'DP World operates Jebel Ali under a long-term concession.')""",
        (edge_id,),
    )
    sdb.execute(
        """insert into evidence (node_id, source_name, url, snippet)
           values ('org:dp-world', 'Company site', 'https://dpworld.example', 'A global port operator.')"""
    )
    edge = prov(sdb, "edge", edge_id)
    assert edge["sources"][0]["name"] == "DP World annual report" and edge["sources"][0]["url"]
    assert len(edge["sources"]) == 1  # the evidence replaces the generic "WorldGraph curated" entry
    node = prov(sdb, "node", "org:dp-world")
    assert node["sources"] == [
        {
            "name": "Company site",
            "url": "https://dpworld.example",
            "snippet": "A global port operator.",
            "published_at": None,
            "title": None,
        }
    ]
    # Evidence goes with its edge.
    sdb.execute("delete from edge where id = %s", (edge_id,))
    assert one(sdb, "select count(*) from evidence where edge_id = %s", edge_id) == 0


# ---------------------------------------------------------------------------
# api.provenance
# ---------------------------------------------------------------------------


def test_provenance_of_curated_and_gazetteer_nodes(sdb):
    dp = prov(sdb, "node", "org:dp-world")
    assert dp["title"] == "DP World" and dp["kind"] == "reported" and not dp["weak"]
    assert dp["source"]["id"] == "curated" and dp["sources"][0]["name"] == "WorldGraph curated"
    assert dp["added_by"].startswith("WorldGraph curated · ")
    gj = prov(sdb, "node", "region:in-gj")
    assert gj["source"] == {
        "id": "natural-earth",
        "name": "Natural Earth",
        "url": "https://www.naturalearthdata.com",
        "attribution": "Borders and places: Natural Earth",
    }
    assert gj["added_by"].startswith("Natural Earth gazetteer · ")
    sample = prov(sdb, "node", "story:red-sea-attacks-reroute")
    assert sample["is_sample"] and sample["added_by"].startswith("Sample data · ")
    assert sample["sources"] and all(
        s["url"] is None for s in sample["sources"]
    )  # sample articles have no links


def test_provenance_of_a_live_story_mention_and_link(sdb):
    written = write_all(sdb, "prov-api", 1)
    cause, effect = written["cause"], written["effect"]
    story = prov(sdb, "node", effect)
    assert story["added_by"].startswith("News pipeline · AI analysis · ")
    assert story["confidence"] == 0.8 and story["source"]["id"] == "gdelt"
    assert {s["url"] for s in story["sources"]} >= {"https://a.example/prov-api/1"}
    assert all(s["title"] for s in story["sources"])
    # A mention the AI added: the story's own articles back it.
    mention = one(
        sdb,
        "select id from edge where src = %s and type = 'mentions' and created_by = 'ai:test-model' limit 1",
        effect,
    )
    m = prov(sdb, "edge", mention)
    assert m["added_by"].startswith("AI analysis · ") and m["created_by"] == "ai:test-model"
    assert m["title"].startswith("Freight rates climb at Indian ports mentions ")
    assert {s["url"] for s in m["sources"]} == {s["url"] for s in story["sources"]}
    # The causal link: its evidence, confidence and kind.
    link_id = one(sdb, "select id from causal_link where src_story = %s and dst_story = %s", cause, effect)
    link = prov(sdb, "link", link_id)
    assert link["kind"] == "inferred" and link["confidence"] == 0.7 and link["source"] is None
    assert link["sources"][0]["snippet"] == "Higher crude prices feed into bunker fuel and freight rates."
    assert link["title"] == "Saudi Arabia extends crude output cuts → Freight rates climb at Indian ports"
    assert not link["weak"]
    # Without evidence a link is weak.
    sdb.execute("delete from evidence where causal_link_id = %s", (link_id,))
    assert prov(sdb, "link", link_id)["weak"]
    # A forecast and what it is about come from its provider.
    fc = prov(sdb, "node", written["forecast"])
    assert fc["sources"][0]["name"] == "Manifold" and fc["sources"][0]["url"].startswith("https://manifold")
    about = one(sdb, "select id from edge where src = %s limit 1", written["forecast"])
    assert prov(sdb, "edge", str(about))["sources"][0]["name"] == "Manifold"  # ids may come as text


def test_provenance_marks_low_confidence_as_weak(sdb):
    edge_id = one(sdb, "select id from edge where src = 'org:dp-world' and type = 'operates'")
    sdb.execute("update edge set confidence = 0.3 where id = %s", (edge_id,))
    weak = prov(sdb, "edge", edge_id)
    assert weak["weak"] and weak["confidence"] == 0.3
    assert weak["title"] == "DP World operates Jebel Ali Port"


def test_provenance_hides_what_the_viewer_may_not_see(sdb):
    add_real_money_forecast(sdb)
    assert prov(sdb, "node", REAL_MONEY, _viewer={"country": "US"})["sources"][0]["name"]
    assert error(
        sdb, "provenance", {"target": "node", "id": REAL_MONEY, "_viewer": {"country": "IN"}}
    ).startswith("Not found")
    add_real_money_forecast(sdb)  # error() rolled back
    about = one(sdb, "select id from edge where src = %s and type = 'about' limit 1", REAL_MONEY)
    assert error(sdb, "provenance", {"target": "edge", "id": about, "_viewer": {"country": "IN"}}).startswith(
        "Not found"
    )


def test_provenance_errors_and_flag(sdb):
    assert error(sdb, "provenance", {"target": "story", "id": "x"}) == "target must be node, edge or link"
    assert error(sdb, "provenance", {"target": "edge", "id": "abc"}) == "id must be a number for edge"
    assert error(sdb, "provenance", {"target": "node"}) == "id is required"
    assert error(sdb, "provenance", {"target": "node", "id": "org:nope"}) == "Not found: org:nope"
    assert error(sdb, "provenance", {"target": "link", "id": 999999999}) == "Not found: link 999999999"
    sdb.execute("update app_flag set enabled = false where key = 'kg.provenance'")
    assert error(sdb, "provenance", {"target": "node", "id": "org:dp-world"}) == "Provenance is switched off"


def test_added_by_in_plain_words(sdb):
    words = {
        "pipeline:news": "News pipeline",
        "pipeline:forecasts": "Forecast sync",
        "pipeline:prune": "Pipeline",
        "ai:claude-opus-5-5": "AI analysis",
        "curated": "WorldGraph curated",
        "gazetteer": "Natural Earth gazetteer",
        "sample": "Sample data",
        "owner:revert:12": "Owner correction",
        "migration:0023": "Data upgrade",
        "enrichment:wikidata": "Enrichment",
    }
    for actor, expected in words.items():
        assert one(sdb, "select api._actor_words(%s)", actor) == expected
    assert (
        one(sdb, "select api._added_by('pipeline:news', '2026-10-22 10:00+00', 'AI analysis')")
        == "News pipeline · AI analysis · 22 Oct"
    )
    assert (
        one(sdb, "select api._added_by('ai:x', '2025-01-05 10:00+00', 'AI analysis')")
        == "AI analysis · 5 Jan 2025"
    )


# ---------------------------------------------------------------------------
# weak on graph, cascade and connection links
# ---------------------------------------------------------------------------


def test_graph_links_carry_weak_and_edge_confidence(sdb):
    sdb.execute(
        """update edge set confidence = 0.3
           where type = 'mentions' and src = 'story:red-sea-attacks-reroute' and dst = 'region:ye'"""
    )
    data = check("local_graph", call(sdb, "local_graph", {"id": "story:red-sea-attacks-reroute", "depth": 1}))
    links = {(lk["source"], lk["target"], lk["type"]): lk for lk in data["links"]}
    low = links[("story:red-sea-attacks-reroute", "region:ye", "mentions")]
    assert low["confidence"] == 0.3 and low["weak"] is True
    assert all(lk["weak"] is False for lk in data["links"] if not lk["causal"] and lk["confidence"] is None)
    for lk in data["links"]:
        if lk["causal"]:
            no_evidence = not one(sdb, "select count(*) from evidence where causal_link_id = %s", lk["id"])
            assert lk["weak"] == (lk["confidence"] < 0.5 or no_evidence)
    # min_confidence leaves out edges below it, as it does causal links.
    graph = call(sdb, "graph", {"sample": True, "window": "30d", "min_confidence": 0.5})
    assert ("story:red-sea-attacks-reroute", "region:ye", "mentions") not in {
        (lk["source"], lk["target"], lk["type"]) for lk in graph["links"]
    }
    sdb.execute("update app_flag set enabled = false where key = 'kg.provenance'")
    off = call(sdb, "local_graph", {"id": "story:red-sea-attacks-reroute", "depth": 1})
    assert all(lk["weak"] is False for lk in off["links"])


def test_cascade_and_connections_carry_weak(sdb):
    data = check("cascade", call(sdb, "cascade", {"id": "story:red-sea-attacks-reroute", "depth": 2}))
    assert data["links"] and all(
        lk["weak"] == (lk["confidence"] < 0.5 or not lk["evidence"]) for lk in data["links"]
    )
    sdb.execute("update edge set confidence = 0.2 where src = 'org:dp-world' and type = 'operates'")
    entity = check("entity", call(sdb, "entity", {"id": "infra:jebel-ali-port"}))
    item = next(g for g in entity["connections"] if g["relation"] == "operates")["items"][0]
    assert item["confidence"] == 0.2 and item["weak"] is True
    assert prov(sdb, "edge", item["edge_id"])["title"] == "DP World operates Jebel Ali Port"


def test_web_reader_can_ask_why(sdb):
    sdb.execute("set local role wg_web_reader")
    assert call(sdb, "provenance", {"target": "node", "id": "org:dp-world"})["sources"]

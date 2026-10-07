"""News items → stories, articles and edges in a real database (no network)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from worldgraph.pipeline import run
from worldgraph.pipeline.embed import HashEmbedder
from worldgraph.pipeline.entities import load_matcher
from worldgraph.pipeline.forecasts.common import Market, upsert
from worldgraph.pipeline.items import Item
from worldgraph.pipeline.places import load_places
from worldgraph.pipeline.prune import prune
from worldgraph.pipeline.themes import classify

pytestmark = pytest.mark.db


def item(
    url: str, title: str, *, provider: str = "gdelt", source: str = "example.com", hours: float = 1
) -> Item:
    places = load_places()
    place, countries = places.place_from_text(title)
    now = datetime.now(UTC)
    return Item(
        url=url,
        title=title,
        source_name=source,
        published_at=now - timedelta(hours=hours),
        provider=provider,
        place=place,
        countries=countries,
        cls=classify(title, base_score=10 if provider == "gdelt" else 4),
    )


OIL = "Saudi Arabia extends Brent crude output cuts into next year"


def stories(conn) -> dict[str, dict]:
    with conn.cursor() as cur:
        cur.execute(
            "select s.*, s.embedding is not null as has_embedding "
            "from story s join node n on n.id = s.node_id where not n.is_sample"
        )
        return {r["node_id"]: r for r in cur.fetchall()}


def test_items_become_stories_and_later_items_join_them(sdb):
    now = datetime.now(UTC)
    embedder = HashEmbedder()
    batch1 = [
        item("https://a.example/1", OIL, source="a.example"),
        item("https://b.example/2", OIL + " says ministry", source="b.example"),
        item(
            "https://c.example/3",
            "Brazil coffee frost hits harvest and prices jump",
            provider="rss",
            source="C News",
        ),
        item(
            "https://d.example/4", "Local bakery prices rise slightly", source="d.example"
        ),  # weak lone item
    ]
    stats = run.process(sdb, batch1, embedder, now)
    assert stats["new"] == 4 and stats["stories_new"] == 2 and stats["dropped_weak_singles"] == 1
    assert stats["articles"] == 3

    found = stories(sdb)
    assert len(found) == 2
    oil = next(s for s in found.values() if "Saudi" in s["headline"])
    assert oil["analysis_status"] == "pending" and oil["so_what"] is None and oil["has_embedding"]
    assert oil["source_count"] == 2 and oil["country_id"] == "region:sa"
    assert oil["importance"] > 0 and "energy" in oil["sectors"]
    with sdb.cursor() as cur:
        cur.execute("select dst from edge where src = %s and type = 'mentions'", (oil["node_id"],))
        targets = {r["dst"] for r in cur.fetchall()}
    assert {"commodity:crude-oil", "region:sa", "sector:energy"} <= targets

    # A later run: a new outlet with the same news joins the existing story.
    batch2 = [item("https://e.example/5", OIL + " to support prices", source="e.example")]
    stats = run.process(sdb, batch2, embedder, now)
    assert stats["stories_new"] == 0 and stats["stories_updated"] == 1
    assert stories(sdb)[oil["node_id"]]["source_count"] == 3

    # Links we already have are never processed again.
    assert run.process(sdb, batch2, embedder, now)["new"] == 0


def test_hazards_always_become_their_own_story(sdb):
    hazard = item(
        "https://quake.example/1", "M6.4 earthquake: 20 km E of Hualien City, Taiwan", provider="usgs"
    )
    hazard.hazard, hazard.magnitude = True, 3
    stats = run.process(sdb, [hazard], HashEmbedder(), datetime.now(UTC))
    assert stats["stories_new"] == 1
    (story,) = stories(sdb).values()
    assert story["impact"] == "risk" and story["magnitude"] == 3 and story["country_id"] == "region:tw"


def test_retention_rules(sdb):
    run.process(
        sdb,
        [item("https://c.example/old", "Brazil coffee frost hits harvest", provider="rss")],
        HashEmbedder(),
        datetime.now(UTC),
    )
    (sid,) = stories(sdb)
    with sdb.cursor() as cur:
        cur.execute("update story set last_seen = now() - interval '4 days' where node_id = %s", (sid,))
    counts = prune(sdb)
    assert counts["single_source"] == 1  # one source, never analysed, 4 days old
    assert stories(sdb) == {}
    with sdb.cursor() as cur:
        cur.execute("select count(*) as n from node where is_sample")
        assert cur.fetchone()["n"] > 0  # sample data is never touched


def test_forecast_upsert(sdb):
    now = datetime.now(UTC).replace(minute=30)
    market = Market(
        provider="manifold",
        ref="xyz",
        question="Will Saudi Arabia cut Brent crude output again in 2027?",
        url="https://manifold.markets/x/saudi-cut",
        probability=0.4,
        volume=20000,
        liquidity=900,
        end_date=now + timedelta(days=200),
        slug="saudi-cut",
        category="energy",
    )
    places, matcher = load_places(), load_matcher(sdb)
    assert upsert(sdb, market, places, matcher, now) is True
    market.probability = 0.45
    assert upsert(sdb, market, places, matcher, now + timedelta(hours=1)) is False
    with sdb.cursor() as cur:
        cur.execute("select card, region_id from api.forecast_card where id = 'forecast:manifold-saudi-cut'")
        row = cur.fetchone()
        cur.execute("select dst from edge where src = 'forecast:manifold-saudi-cut' and type = 'about'")
        about = {r["dst"] for r in cur.fetchall()}
    assert row["card"]["probability"] == 0.45 and row["card"]["url"] == "https://manifold.markets/x/saudi-cut"
    assert row["region_id"] == "region:sa" and "commodity:crude-oil" in about


def test_skipped_stories_disappear_and_are_not_ingested_again(sdb):
    embedder = HashEmbedder()
    first = item("https://c.example/skip", "Brazil coffee frost hits harvest", provider="rss")
    run.process(sdb, [first], embedder, datetime.now(UTC))
    (sid,) = stories(sdb)
    with sdb.cursor() as cur:
        cur.execute("update story set analysis_status = 'skipped' where node_id = %s", (sid,))
        cur.execute("select count(*) as n from node where id = %s", (sid,))
        assert cur.fetchone()["n"] == 0
        cur.execute("select count(*) as n from skipped_url where url = 'https://c.example/skip'")
        assert cur.fetchone()["n"] == 1
    assert run.process(sdb, [first], embedder, datetime.now(UTC))["new"] == 0

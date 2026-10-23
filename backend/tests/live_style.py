"""Write live-style rows through the real write paths (no network).

Production holds rows the sample data never makes: pipeline stories with
`mentions` edges, Manifold forecasts with `about` edges, and AI analysis
saved by api.save_analysis (headlines, entities and causal links). Tests
that change the schema write these first, migrate, then write again.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

import psycopg

from worldgraph.pipeline import run
from worldgraph.pipeline.embed import HashEmbedder
from worldgraph.pipeline.entities import load_matcher
from worldgraph.pipeline.forecasts.common import Market, upsert
from worldgraph.pipeline.items import Item
from worldgraph.pipeline.places import load_places
from worldgraph.pipeline.themes import classify


def _item(url: str, title: str, *, provider: str = "gdelt", source: str, hours: float) -> Item:
    places = load_places()
    place, countries = places.place_from_text(title)
    return Item(
        url=url,
        title=title,
        source_name=source,
        published_at=datetime.now(UTC) - timedelta(hours=hours),
        provider=provider,
        place=place,
        countries=countries,
        cls=classify(title, base_score=10 if provider == "gdelt" else 4),
    )


def _live_stories(conn: psycopg.Connection) -> dict[str, str]:
    """Live story id by headline."""
    rows = conn.execute(
        "select s.node_id, s.headline from story s join node n on n.id = s.node_id where not n.is_sample"
    ).fetchall()
    return {r["headline"]: r["node_id"] for r in rows}


# Different news each round, so a second round makes new stories instead of
# joining the first round's (the clustering would merge near-copies).
TITLES = [
    (
        "Saudi Arabia extends Brent crude output cuts",
        "Freight rates at Mundra Port in Gujarat, India climb as fuel costs rise",
    ),
    (
        "Copper miners in Chile halt output as strike spreads",
        "Vietnam electronics makers face higher copper wire costs",
    ),
    (
        "Brazil coffee frost damages arabica harvest",
        "Coffee roasters in Germany raise wholesale prices",
    ),
]


def write_news(conn: psycopg.Connection, tag: str, variant: int = 0) -> list[str]:
    """Two-source pipeline stories (pending drafts with mentions edges). Returns their ids."""
    titles = list(TITLES[variant % len(TITLES)])
    items = []
    for i, title in enumerate(titles):
        hours = 30 - 10 * i
        items += [
            _item(f"https://a.example/{tag}/{i}", title, source="a.example", hours=hours),
            _item(f"https://b.example/{tag}/{i}", title + " says ministry", source="b.example", hours=hours),
        ]
    before = set(_live_stories(conn).values())
    run.process(conn, items, HashEmbedder(), datetime.now(UTC))
    return [sid for sid in _live_stories(conn).values() if sid not in before]


def write_forecast(conn: psycopg.Connection, tag: str) -> str:
    """A Manifold-style market with about edges (to a region and crude oil)."""
    market = Market(
        provider="manifold",
        ref=f"ref-{tag}",
        question=f"Will Saudi Arabia cut Brent crude output again ({tag})?",
        url=f"https://manifold.markets/x/saudi-cut-{tag}",
        probability=0.4,
        volume=20000,
        liquidity=900,
        end_date=datetime.now(UTC) + timedelta(days=200),
        slug=f"saudi-cut-{tag}",
        category="energy",
    )
    upsert(conn, market, load_places(), load_matcher(conn), datetime.now(UTC))
    row = conn.execute(
        "select node_id from forecast where provider = 'manifold' and provider_ref = %s", (f"ref-{tag}",)
    ).fetchone()
    assert row is not None
    return row["node_id"]


def save_analysis(conn: psycopg.Connection, cause: str, effect: str) -> dict[str, Any]:
    """AI analysis of both stories; the effect gets a causal link from the cause."""

    def item(sid: str, headline: str, direction: str, links: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "id": sid,
            "headline": headline,
            "so_what": "Fuel and shipping costs rise for importers.",
            "event_type": "supply-shock",
            "impact": "risk",
            "direction": direction,
            "magnitude": 3,
            "horizon": "weeks",
            "confidence": 0.8,
            "sectors": ["energy", "logistics-trade"],
            "actions": ["Review fuel contracts"],
            "entities": ["commodity:crude-oil", "region:sa", "org:saudi-aramco", "infra:mundra-port"],
            "links": links,
        }

    link = {
        "from": cause,
        "link_type": "inferred",
        "mechanism": "raises fuel costs",
        "direction": "up",
        "confidence": 0.7,
        "evidence": "Higher crude prices feed into bunker fuel and freight rates.",
    }
    args = {
        "engine": "api",
        "model": "test-model",
        "items": [
            item(cause, "Saudi Arabia extends crude output cuts", "up", []),
            item(effect, "Freight rates climb at Indian ports", "up", [link]),
        ],
    }
    row = conn.execute("select api.save_analysis(%s::jsonb) as r", (json.dumps(args),)).fetchone()
    assert row is not None
    return row["r"]


def write_all(conn: psycopg.Connection, tag: str, variant: int = 0) -> dict[str, Any]:
    """News, a forecast and AI analysis with a causal link. Returns what was written."""
    stories = write_news(conn, tag, variant)
    assert len(stories) == 2, stories
    # Oldest first: the cause.
    seen = {
        r["node_id"]: r["first_seen"]
        for r in conn.execute(
            "select node_id, first_seen from story where node_id = any(%s)", (stories,)
        ).fetchall()
    }
    cause, effect = sorted(stories, key=lambda s: seen[s])
    forecast = write_forecast(conn, tag)
    saved = save_analysis(conn, cause, effect)
    assert saved["saved"] == 2 and saved["links_saved"] == 1, saved
    return {"cause": cause, "effect": effect, "forecast": forecast, "saved": saved}

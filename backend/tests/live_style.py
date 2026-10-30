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


# ---------------------------------------------------------------------------
# Production scale (bulk SQL in the pipeline's shapes; no network, seconds)
# ---------------------------------------------------------------------------

BULK_MODEL = "claude-opus-5-5"


def write_bulk(
    conn: psycopg.Connection,
    tag: str = "bulk",
    *,
    stories: int = 5000,
    articles: int = 6,
    mentions: int = 6,
    links: int = 1500,
    forecasts: int = 300,
) -> dict[str, int]:
    """Live rows at production scale, shaped like the pipeline's: stories
    (half analysed by AI) with articles and mentions edges (the AI's ones
    created at analysed_at), AI causal links with evidence, and Manifold
    forecasts with snapshots and about edges. Works on every schema since
    0020; on 0023 and later the session declares the actor and source.
    Returns the row counts written."""
    conn.execute(
        "select set_config('wg.actor', 'pipeline:news', true), set_config('wg.source', 'news-feeds', true)"
    )
    p = f"story:{tag}-"
    conn.execute(
        """
        create temp table _bulk_targets on commit drop as
        select row_number() over (order by n.id) as k, n.id
        from node n left join region r on r.node_id = n.id
        where not n.is_sample
          and ((n.type = 'region' and r.level in ('country', 'state'))
               or n.type in ('organization', 'commodity', 'infrastructure', 'sector', 'policy'))
        """
    )
    targets = conn.execute("select count(*) as n from _bulk_targets").fetchone()["n"]  # type: ignore[index]
    conn.execute(
        """
        insert into node (id, type, subtype, name, geom, is_sample)
        select %(p)s || g, 'story', 'event', 'Bulk live story number ' || g,
               st_geogfromtext('SRID=4326;POINT(' || (g %% 360 - 180) || ' ' || (g %% 140 - 70) || ')'), false
        from generate_series(1, %(n)s) g
        """,
        {"p": p, "n": stories},
    )
    conn.execute(
        """
        insert into story (node_id, kind, headline, so_what, event_type, impact, direction, magnitude,
                           confidence, importance, sectors, primary_region, country_id, first_seen, last_seen,
                           mention_count, source_count, analysis_status, analysed_at, analysis_engine,
                           analysis_model, props)
        select %(p)s || g, 'event',
               case when g %% 2 = 0 then 'Bulk story ' || g || ' moves markets'
                    else 'Bulk live story number ' || g end,
               case when g %% 2 = 0 then 'Costs change for importers.' end,
               'market-shift', (array['risk', 'opportunity', 'neutral'])[1 + g %% 3],
               case when g %% 2 = 0 then (array['up', 'down'])[1 + g %% 2] end,
               1 + g %% 5, case when g %% 2 = 0 then 0.7 end, (g * 7) %% 100,
               array[(array['energy', 'logistics-trade', 'agriculture-food', 'finance-macro'])[1 + g %% 4]],
               c.id, c.id,
               now() - make_interval(hours => (g * 11) %% (24 * 13)),
               now() - make_interval(hours => (g * 11) %% (24 * 13)) + interval '2 hours',
               %(a)s, 3, case when g %% 2 = 0 then 'done' else 'pending' end,
               case when g %% 2 = 0
                    then now() - make_interval(hours => (g * 11) %% (24 * 13)) + interval '3 hours' end,
               case when g %% 2 = 0 then 'api' end, case when g %% 2 = 0 then %(model)s end,
               jsonb_build_object('n', %(a)s, 'providers', case when g %% 3 = 0 then '["gdelt"]'::jsonb
                                                               else '["gdelt", "rss"]'::jsonb end)
        from generate_series(1, %(n)s) g
        cross join lateral (
            select r.node_id as id from region r
            where r.level = 'country'
              and r.node_id = (array['region:in', 'region:us', 'region:cn', 'region:de',
                                     'region:br', 'region:sa', 'region:jp'])[1 + g %% 7]
        ) c
        """,
        {"p": p, "n": stories, "a": articles, "model": BULK_MODEL},
    )
    conn.execute(
        """
        insert into article (story_id, url, source_name, title, published_at, lang, snippet)
        select s.node_id, 'https://news.example/' || %(tag)s || '/' || s.node_id || '/' || a,
               (array['Reuters', 'BBC', 'Mint', 'DW', 'CNBC'])[1 + a %% 5],
               'Article ' || a || ' about ' || s.headline, s.first_seen + make_interval(mins => a * 7), 'en',
               case when a = 1 then 'One sentence from the first article.' end
        from story s cross join generate_series(1, %(a)s) a
        where s.node_id like %(like)s
        """,
        {"tag": tag, "a": articles, "like": p + "%"},
    )
    conn.execute(
        """
        insert into edge (src, dst, type, created_at)
        select s.node_id, t.id, 'mentions',
               case when s.analysis_status = 'done' and m > %(half)s then s.analysed_at else s.first_seen end
        from story s
        cross join generate_series(1, %(m)s) m
        join _bulk_targets t on t.k = 1 + (abs(hashtext(s.node_id || ':' || m)) %% %(targets)s)
        where s.node_id like %(like)s
        on conflict do nothing
        """,
        {"m": mentions, "half": mentions // 2, "targets": targets, "like": p + "%"},
    )
    conn.execute(
        """
        insert into causal_link (src_story, dst_story, link_type, mechanism, direction, lag_days, confidence,
                                 method, model_version, created_at)
        select %(p)s || (g * 2 + 2), %(p)s || (g * 2), (array['reported', 'inferred'])[1 + g %% 2],
               'raises shipping costs', 'up', 0, 0.3 + (g %% 7) / 10.0, 'llm', %(model)s, now()
        from generate_series(1, least(%(l)s, %(n)s / 2 - 2)) g
        on conflict do nothing
        """,
        {"p": p, "l": links, "n": stories, "model": BULK_MODEL},
    )
    conn.execute(
        """
        insert into evidence (causal_link_id, source_name, url, published_at, snippet)
        select cl.id, 'AI analysis (api)', 'https://news.example/' || %(tag)s || '/' || cl.dst_story || '/1',
               now(), 'Higher costs pass through to freight.'
        from causal_link cl where cl.dst_story like %(like)s and cl.id %% 5 <> 0
        """,
        {"tag": tag, "like": p + "%"},
    )
    f = f"forecast:{tag}-"
    conn.execute(
        """
        insert into node (id, type, subtype, name, summary, is_sample)
        select %(f)s || g, 'forecast', 'binary', 'Will bulk question ' || g || ' resolve yes?',
               'Will bulk question ' || g || ' resolve yes?', false
        from generate_series(1, %(k)s) g
        """,
        {"f": f, "k": forecasts},
    )
    conn.execute(
        """
        insert into forecast (node_id, provider, provider_ref, question, short_title, category, end_date, url,
                              volume_unit, status)
        select %(f)s || g, 'manifold', %(tag)s || '-' || g, 'Will bulk question ' || g || ' resolve yes?',
               'Bulk question ' || g, 'economy', now() + interval '90 days',
               'https://manifold.markets/x/' || %(tag)s || '-' || g, 'MANA', 'open'
        from generate_series(1, %(k)s) g
        """,
        {"f": f, "k": forecasts, "tag": tag},
    )
    conn.execute(
        """
        insert into forecast_snapshot (forecast_id, ts, probability, volume, liquidity)
        select %(f)s || g, date_trunc('hour', now()) - make_interval(days => d), 0.4, 5000, 100
        from generate_series(1, %(k)s) g cross join generate_series(0, 29) d
        """,
        {"f": f, "k": forecasts},
    )
    conn.execute(
        """
        insert into edge (src, dst, type)
        select %(f)s || g, t.id, 'about'
        from generate_series(1, %(k)s) g
        cross join generate_series(1, 3) m
        join _bulk_targets t on t.k = 1 + (abs(hashtext(g || ':' || m)) %% %(targets)s)
        on conflict do nothing
        """,
        {"f": f, "k": forecasts, "targets": targets},
    )
    conn.execute("drop table _bulk_targets")
    conn.execute("analyze node; analyze edge; analyze story; analyze article; analyze causal_link")
    counts = conn.execute(
        """select (select count(*) from node) as nodes, (select count(*) from edge) as edges,
                  (select count(*) from story) as stories, (select count(*) from article) as articles,
                  (select count(*) from causal_link) as links"""
    ).fetchone()
    assert counts is not None
    return dict(counts)

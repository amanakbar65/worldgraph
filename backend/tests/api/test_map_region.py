"""api.meta, api.globe, api.top, api.region, api.compare and api.brief.

Every test runs against the seeded database (sample data, clock shifted so
the newest sample story is about 20 minutes old) and rolls back afterwards,
so rows inserted here never leak into other tests.
"""

from __future__ import annotations

import math
import time
from collections import Counter
from datetime import datetime
from typing import Any

import psycopg
import pytest

from tests.contract import call, check

SECTORS = [
    "energy",
    "agri-food",
    "manufacturing",
    "logistics-trade",
    "finance",
    "tech",
    "health",
    "real-estate",
    "consumer",
]
WINDOW_HOURS = {"24h": 24, "7d": 168, "30d": 720}
IMPACTS = ("risk", "opportunity", "neutral")
PM = "forecast:pm-test-market"
EMPTY_PROFILE = {
    "name": None,
    "sectors": [],
    "locations": [],
    "inputs": [],
    "suppliers": [],
    "markets": [],
    "competitors": [],
    "keywords": [],
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def viewer(country: str | None, **args: Any) -> dict[str, Any]:
    return {**args, "_viewer": {"country": country}} if country else args


def rows(conn: psycopg.Connection, sql: str, params: Any = None) -> list[dict[str, Any]]:
    return conn.execute(sql, params).fetchall()


def scalar(conn: psycopg.Connection, sql: str, params: Any = None) -> Any:
    row = conn.execute(sql, params).fetchone()
    assert row is not None
    return next(iter(row.values()))


def db_now(conn: psycopg.Connection) -> datetime:
    return scalar(conn, "select now() as now")


def ids(items: list[dict[str, Any]]) -> list[str]:
    return [item["id"] for item in items]


def card(brief: dict[str, Any], kind: str) -> dict[str, Any]:
    return next(c for c in brief["cards"] if c["kind"] == kind)


def raises_not_found(conn: psycopg.Connection, name: str, args: dict[str, Any]) -> None:
    with pytest.raises(psycopg.errors.RaiseException) as exc, conn.transaction():
        call(conn, name, args)
    assert exc.value.diag.message_primary.startswith("Not found")


def sample_events(conn: psycopg.Connection, hours: float) -> list[dict[str, Any]]:
    return rows(
        conn,
        """select s.node_id as id, s.impact, s.importance, s.sectors, s.first_seen, s.country_id,
                  s.admin1_id, s.primary_region, s.source_count,
                  st_x(s.location::geometry) as lon, st_y(s.location::geometry) as lat
           from story s join node n on n.id = s.node_id
           where s.kind = 'event' and n.is_sample and s.first_seen >= now() - %s * interval '1 hour'""",
        (hours,),
    )


def add_story(
    conn: psycopg.Connection,
    sid: str,
    *,
    impact: str = "neutral",
    importance: float = 50,
    hours_ago: float = 1,
    country: str | None = "region:br",
    admin1: str | None = None,
    primary: str | None = None,
    lon: float = -47.9,
    lat: float = -15.8,
    sectors: tuple[str, ...] = ("energy",),
    sources: int = 3,
) -> None:
    """A live (non-sample) event story."""
    point = f"SRID=4326;POINT({lon} {lat})"
    conn.execute(
        """insert into node (id, type, subtype, name, geom, is_sample)
           values (%s, 'story', 'event', %s, st_geogfromtext(%s), false)""",
        (sid, sid, point),
    )
    conn.execute(
        """insert into story (node_id, kind, headline, so_what, event_type, impact, importance, sectors,
                              primary_region, location, first_seen, last_seen, country_id, admin1_id,
                              source_count, mention_count)
           values (%s, 'event', 'A live test story', 'It matters for tests.', 'test', %s, %s, %s,
                   %s, st_geogfromtext(%s), now() - make_interval(secs => %s), now(), %s, %s, %s, %s)""",
        (
            sid,
            impact,
            importance,
            list(sectors),
            primary or country,
            point,
            hours_ago * 3600,
            country,
            admin1,
            sources,
            sources * 3,
        ),
    )


def add_link(conn: psycopg.Connection, src: str, dst: str, link_type: str = "reported") -> None:
    conn.execute(
        """insert into causal_link (src_story, dst_story, link_type, mechanism, direction, confidence, method)
           values (%s, %s, %s, 'raises input costs', 'up', 0.8, 'test')""",
        (src, dst, link_type),
    )


def add_polymarket_forecast(conn: psycopg.Connection) -> None:
    """A real-money forecast about India that moved 30 points today, provider enabled."""
    conn.execute("update forecast_provider set enabled = true where id = 'polymarket'")
    conn.execute(
        """insert into node (id, type, subtype, name, geom, is_sample)
           values (%s, 'forecast', 'binary', 'Test market', st_geogfromtext('SRID=4326;POINT(77.2 28.6)'),
                   false)""",
        (PM,),
    )
    conn.execute(
        """insert into forecast (node_id, provider, provider_ref, question, short_title, category, end_date,
                                 url, is_real_money, volume_unit)
           values (%s, 'polymarket', 'pm-test', 'Will the test market resolve YES?',
                   'Will the test market resolve YES', 'economy', now() + interval '3 days',
                   'https://polymarket.com/event/pm-test', true, 'USD')""",
        (PM,),
    )
    conn.execute(
        """insert into forecast_snapshot (forecast_id, ts, probability, volume, liquidity) values
           (%s, now() - interval '30 hours', 0.30, 900000, 200000),
           (%s, now() - interval '1 hour', 0.60, 1000000, 200000)""",
        (PM, PM),
    )
    conn.execute("insert into edge (src, dst, type) values (%s, 'region:in', 'about')", (PM,))


def about(conn: psycopg.Connection, targets: list[str]) -> set[str]:
    return {
        r["src"]
        for r in rows(conn, "select src from edge where type = 'about' and dst = any(%s)", (targets,))
    }


def visible_sample_forecasts(conn: psycopg.Connection) -> list[dict[str, Any]]:
    return rows(
        conn,
        """select id, change_24h, thin, end_date, region_id from api.forecast_card
           where status = 'open' and not hidden and provider = 'sample'""",
    )


# ---------------------------------------------------------------------------
# api.meta
# ---------------------------------------------------------------------------


def test_meta_contract_and_counts(sdb):
    data = check("meta", call(sdb, "meta"))
    expected_sample = scalar(
        sdb,
        """select count(*) from story s join node n on n.id = s.node_id
           where s.kind = 'event' and n.is_sample""",
    )
    assert data["data"]["sample_stories"] == expected_sample > 150
    assert data["data"]["live_stories"] == 0
    assert data["data"]["last_ingest_at"] is None
    assert data["data"]["showing_sample"] is True
    assert data["data"]["forecasts"] == len(visible_sample_forecasts(sdb))
    assert data["data"]["entities"] == scalar(
        sdb, "select count(*) from node where type not in ('story', 'forecast')"
    )


def test_meta_sectors_in_fixed_order(sdb):
    data = call(sdb, "meta")
    assert [s["id"] for s in data["sectors"]] == SECTORS
    assert all(s["icon"] and s["name"] for s in data["sectors"])
    assert data["sectors"][0] == {"id": "energy", "name": "Energy", "icon": "zap"}


def test_meta_sources_include_enabled_providers_once(sdb):
    data = call(sdb, "meta")
    source_ids = [s["id"] for s in data["sources"]]
    assert len(source_ids) == len(set(source_ids))
    assert {"natural-earth", "sample", "manifold"} <= set(source_ids)
    assert "polymarket" not in source_ids  # disabled by default
    assert "metaculus" not in source_ids
    manifold = next(s for s in data["sources"] if s["id"] == "manifold")
    assert manifold["homepage"] == "https://manifold.markets"


def test_meta_with_live_data(sdb):
    add_story(sdb, "story:live-meta-test", hours_ago=2)
    data = check("meta", call(sdb, "meta"))
    assert data["data"]["live_stories"] == 1
    assert data["data"]["showing_sample"] is False
    first_seen = scalar(sdb, "select first_seen from story where node_id = 'story:live-meta-test'")
    assert datetime.fromisoformat(data["data"]["last_ingest_at"]) == first_seen
    # Sample forecasts are not counted once live data hides the sample.
    assert data["data"]["forecasts"] == 0


# ---------------------------------------------------------------------------
# api.globe
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "args",
    [
        {"window": "24h"},
        {"window": "7d"},
        {"window": "30d"},
        {"window": "7d", "sectors": ["energy", "finance"]},
        {"window": "30d", "sectors": ["health"]},
        {"window": "7d", "sectors": []},
        {"window": "30d", "sample": False},
        {"window": "bogus"},
    ],
)
def test_globe_contract(sdb, args):
    data = check("globe", call(sdb, "globe", args))
    assert data["window"] == (args["window"] if args["window"] in WINDOW_HOURS else "7d")


@pytest.mark.parametrize("window", ["24h", "7d", "30d"])
def test_globe_events_follow_window_and_order(sdb, window):
    data = call(sdb, "globe", {"window": window})
    expected = sample_events(sdb, WINDOW_HOURS[window])
    assert sorted(ids(data["events"])) == sorted(r["id"] for r in expected)
    importances = [e["importance"] for e in data["events"]]
    assert importances == sorted(importances, reverse=True)
    by_id = {r["id"]: r for r in expected}
    for e in data["events"]:
        assert e["lon"] == pytest.approx(by_id[e["id"]]["lon"], abs=1e-4)
        assert e["lat"] == pytest.approx(by_id[e["id"]]["lat"], abs=1e-4)
        assert e["country_id"] == by_id[e["id"]]["country_id"]


def test_globe_sector_filter_uses_overlap(sdb):
    data = call(sdb, "globe", {"window": "30d", "sectors": ["energy", "health"]})
    expected = [r["id"] for r in sample_events(sdb, 720) if {"energy", "health"} & set(r["sectors"])]
    assert sorted(ids(data["events"])) == sorted(expected)
    assert all({"energy", "health"} & set(e["sectors"]) for e in data["events"])


def test_globe_countries_summarise_events(sdb):
    data = call(sdb, "globe", {"window": "30d"})
    per_country = Counter(e["country_id"] for e in data["events"] if e["country_id"])
    assert {c["id"]: c["count"] for c in data["countries"]} == dict(per_country)
    for c in data["countries"]:
        assert c["risk"] + c["opportunity"] + c["neutral"] == c["count"]
        assert c["score"] == pytest.approx((c["opportunity"] - c["risk"]) / c["count"], abs=1e-3)
    counts = [c["count"] for c in data["countries"]]
    assert counts == sorted(counts, reverse=True)


@pytest.mark.parametrize("window", ["24h", "30d"])
def test_globe_arcs_are_cross_border_links_into_the_event_set(sdb, window):
    data = call(sdb, "globe", {"window": window})
    event_ids = set(ids(data["events"]))
    links = rows(
        sdb,
        """select cl.id, cl.link_type, cl.src_story, cl.dst_story, a.country_id as src_country,
                  b.country_id as dst_country, a.first_seen as src_seen, b.impact as dst_impact,
                  st_x(a.location::geometry) as src_lon, st_y(a.location::geometry) as src_lat
           from causal_link cl
           join story a on a.node_id = cl.src_story
           join story b on b.node_id = cl.dst_story""",
    )
    now = db_now(sdb)
    expected = {
        lk["id"]
        for lk in links
        if lk["link_type"] in ("reported", "inferred")
        and lk["dst_story"] in event_ids
        and lk["src_seen"] is not None
        and (now - lk["src_seen"]).total_seconds() <= 30 * 86400
        and lk["src_country"]
        and lk["dst_country"]
        and lk["src_country"] != lk["dst_country"]
    }
    assert {a["id"] for a in data["arcs"]} == expected
    assert expected, "the sample should have cross-border arcs"
    by_id = {lk["id"]: lk for lk in links}
    for arc in data["arcs"]:
        lk = by_id[arc["id"]]
        assert arc["src_story"] == lk["src_story"] and arc["dst_story"] == lk["dst_story"]
        assert arc["src_country"] != arc["dst_country"]
        assert arc["impact"] == lk["dst_impact"]
        assert arc["src"] == pytest.approx([lk["src_lon"], lk["src_lat"]], abs=1e-4)


def test_globe_forecasts_are_located_and_ordered_by_move(sdb):
    data = call(sdb, "globe", {"window": "7d"})
    assert len(data["forecasts"]) == len(visible_sample_forecasts(sdb))
    assert all(f["lon"] is not None and f["lat"] is not None for f in data["forecasts"])
    moves = [abs(f["change_24h"]) for f in data["forecasts"] if f["change_24h"] is not None]
    assert moves == sorted(moves, reverse=True)
    # No window or sector filter on forecasts.
    narrow = call(sdb, "globe", {"window": "24h", "sectors": ["health"]})
    assert ids(narrow["forecasts"]) == ids(data["forecasts"])


def test_globe_without_sample_is_empty_but_keeps_live_rows(sdb):
    empty = check("globe", call(sdb, "globe", {"window": "30d", "sample": False}))
    assert empty["events"] == [] and empty["arcs"] == []
    assert empty["forecasts"] == [] and empty["countries"] == []

    add_story(sdb, "story:live-a", country="region:br", hours_ago=3)
    add_story(sdb, "story:live-b", country="region:de", lon=10.0, lat=51.0, hours_ago=1, impact="risk")
    add_link(sdb, "story:live-a", "story:live-b")
    for sample in (False, True):
        data = check("globe", call(sdb, "globe", {"window": "24h", "sample": sample}))
        assert {"story:live-a", "story:live-b"} <= set(ids(data["events"]))
        live_arcs = [a for a in data["arcs"] if a["dst_story"] == "story:live-b"]
        assert len(live_arcs) == 1
        assert live_arcs[0]["src"] == [-47.9, -15.8] and live_arcs[0]["impact"] == "risk"
    # Live data exists, so the default hides the sample.
    default = call(sdb, "globe", {"window": "30d"})
    assert set(ids(default["events"])) == {"story:live-a", "story:live-b"}


def test_globe_arcs_skip_same_country_and_other_link_types(sdb):
    add_story(sdb, "story:live-c", country="region:br", hours_ago=3)
    add_story(sdb, "story:live-d", country="region:br", hours_ago=1, lon=-43.2, lat=-22.9)
    add_story(sdb, "story:live-e", country="region:de", hours_ago=1, lon=10.0, lat=51.0)
    add_story(sdb, "story:live-old", country="region:fr", hours_ago=24 * 31, lon=2.3, lat=48.9)
    add_link(sdb, "story:live-c", "story:live-d")  # same country
    add_link(sdb, "story:live-c", "story:live-e", "projected")  # not a reported or inferred link
    add_link(sdb, "story:live-old", "story:live-e")  # source older than 30 days
    data = call(sdb, "globe", {"window": "24h", "sample": False})
    assert data["arcs"] == []
    add_link(sdb, "story:live-d", "story:live-e", "inferred")
    data = call(sdb, "globe", {"window": "24h", "sample": False})
    assert [(a["src_story"], a["dst_story"], a["link_type"]) for a in data["arcs"]] == [
        ("story:live-d", "story:live-e", "inferred")
    ]


def test_globe_caps_events_at_1500(sdb):
    sdb.execute(
        """insert into node (id, type, subtype, name, is_sample)
           select 'story:bulk-' || i, 'story', 'event', 'Bulk ' || i, false from generate_series(1, 1600) i"""
    )
    sdb.execute(
        """insert into story (node_id, kind, headline, so_what, event_type, impact, importance, sectors,
                              location, first_seen, source_count)
           select 'story:bulk-' || i, 'event', 'Bulk story', 'A bulk test story.', 'test', 'neutral',
                  (i % 100), '{energy}', st_geogfromtext('SRID=4326;POINT(10 10)'),
                  now() - interval '2 hours', 1
           from generate_series(1, 1600) i"""
    )
    started = time.perf_counter()
    data = check("globe", call(sdb, "globe", {"window": "24h", "sample": False}))
    assert (time.perf_counter() - started) < 0.5
    assert len(data["events"]) == 1500
    assert min(e["importance"] for e in data["events"]) >= 6  # the 100 least important are dropped


# ---------------------------------------------------------------------------
# api.top
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "args",
    [
        {"window": "24h"},
        {"window": "7d"},
        {"window": "30d", "sectors": ["tech"]},
        {"window": "24h", "sectors": ["real-estate", "health"]},
        {"window": "7d", "sample": False},
    ],
)
def test_top_contract(sdb, args):
    data = check("top", call(sdb, "top", args))
    assert len(data["stories"]) <= 5 and len(data["movers"]) <= 3


@pytest.mark.parametrize(("window", "sectors"), [("24h", None), ("7d", None), ("30d", ["agri-food"])])
def test_top_ranks_by_importance_with_recency_boost(sdb, window, sectors):
    args: dict[str, Any] = {"window": window}
    if sectors:
        args["sectors"] = sectors
    data = call(sdb, "top", args)
    now = db_now(sdb)
    candidates = [
        r for r in sample_events(sdb, WINDOW_HOURS[window]) if not sectors or set(sectors) & set(r["sectors"])
    ]

    def rank(r: dict[str, Any]) -> float:
        age_hours = max((now - r["first_seen"]).total_seconds(), 0) / 3600
        return r["importance"] + 25 * math.exp(-age_hours / 24)

    expected = [r["id"] for r in sorted(candidates, key=rank, reverse=True)[:5]]
    assert ids(data["stories"]) == expected
    assert all(s["kind"] == "event" for s in data["stories"])


def test_top_movers_are_big_moves_on_deep_markets(sdb):
    data = call(sdb, "top", {"window": "24h"})
    eligible = sorted(
        (f for f in visible_sample_forecasts(sdb) if not f["thin"] and abs(f["change_24h"] or 0) >= 0.03),
        key=lambda f: abs(f["change_24h"]),
        reverse=True,
    )
    assert ids(data["movers"]) == [f["id"] for f in eligible[:3]]
    assert all(not m["thin"] and abs(m["change_24h"]) >= 0.03 for m in data["movers"])


def test_top_without_sample_is_empty(sdb):
    data = call(sdb, "top", {"window": "30d", "sample": False})
    assert data == {"stories": [], "movers": []}


# ---------------------------------------------------------------------------
# api.region
# ---------------------------------------------------------------------------

REGION_CASES = [
    ("region:in", "country"),
    ("region:us", "country"),
    ("region:in-gj", "state"),
    ("region:in-dl", "state"),
    ("region:in-gj.surat", "city"),
    ("region:eu", "bloc"),
    ("region:ad", "country"),
]


@pytest.mark.parametrize(("region_id", "level"), REGION_CASES)
@pytest.mark.parametrize("window", ["24h", "7d", "30d"])
def test_region_contract(sdb, region_id, level, window):
    data = check("region", call(sdb, "region", {"id": region_id, "window": window}))
    assert data["region"]["id"] == region_id
    assert data["region"]["subtype"] == level
    assert [p["sector"] for p in data["sector_pulse"]] == SECTORS
    assert len(data["stories"]) <= 10 and len(data["decisions"]) <= 8 and len(data["kpis"]) <= 4


@pytest.mark.parametrize(("region_id", "_level"), REGION_CASES)
def test_region_contract_without_sample(sdb, region_id, _level):
    data = check("region", call(sdb, "region", {"id": region_id, "window": "30d", "sample": False}))
    assert data["stories"] == [] and data["decisions"] == [] and data["kpis"] == []
    assert data["kpi_scope"] is None
    assert all(p["count"] == 0 and p["impact"] == "neutral" for p in data["sector_pulse"])
    assert all(c["count"] == 0 for c in data["children"])
    assert all(not n["is_sample"] for n in data["graph"]["nodes"])


@pytest.mark.parametrize("bad_id", ["region:nowhere", "sector:energy", "story:not-a-region"])
def test_region_unknown_id(sdb, bad_id):
    raises_not_found(sdb, "region", {"id": bad_id, "window": "7d"})


def test_region_missing_id(sdb):
    raises_not_found(sdb, "region", {"window": "7d"})


@pytest.mark.parametrize(
    ("region_id", "expected"),
    [
        ("region:in", []),
        ("region:eu", []),
        ("region:in-gj", ["region:in"]),
        ("region:in-gj.surat", ["region:in", "region:in-gj"]),
    ],
)
def test_region_breadcrumb(sdb, region_id, expected):
    data = call(sdb, "region", {"id": region_id, "window": "7d"})
    assert ids(data["region"]["breadcrumb"]) == expected


def test_region_details(sdb):
    city = call(sdb, "region", {"id": "region:in-gj.surat", "window": "7d"})["region"]
    assert city["name"] == "Surat" and city["qid"] == "Q4629"
    assert city["population"] and city["population"] > 1_000_000
    assert city["lon"] == pytest.approx(72.84, abs=0.1) and city["lat"] == pytest.approx(21.2, abs=0.1)


def test_region_kpis_follow_preference_and_series_rules(sdb):
    data = call(sdb, "region", {"id": "region:in", "window": "7d"})
    assert data["kpi_scope"] == "region:in"
    assert ids(data["kpis"]) == [
        "indicator:in-cpi",
        "indicator:in-policy-rate",
        "indicator:in-fx",
        "indicator:in-power-demand",
    ]
    for kpi in data["kpis"]:
        points = rows(
            sdb,
            "select date, value from indicator_point where series_id = %s order by date",
            (kpi["id"],),
        )
        series = kpi["series"]
        assert len(series) == min(60, len(points))
        assert [p["d"] for p in series] == [p["date"].isoformat() for p in points[-len(series) :]]
        assert kpi["latest"] == series[-1]["v"] == points[-1]["value"]
        assert kpi["previous"] == points[-2]["value"]
        assert kpi["change"] == pytest.approx(kpi["latest"] - kpi["previous"], abs=1e-6)
        assert kpi["as_of"] == series[-1]["d"]
        assert kpi["is_sample"] is True
    fx = next(k for k in data["kpis"] if k["id"] == "indicator:in-fx")
    assert len(fx["series"]) == 60  # a 90-point daily series is trimmed to the last 60


def test_region_kpis_keep_the_four_preferred(sdb):
    extra = (("indicator:in-test-pmi", "Manufacturing PMI"), ("indicator:in-test-diesel", "Diesel price"))
    for sid, name in extra:
        sdb.execute(
            "insert into node (id, type, name, is_sample) values (%s, 'indicator', %s, true)", (sid, name)
        )
        sdb.execute(
            """insert into indicator_series
                   (node_id, subject_id, name, unit, frequency, higher_is, source_name)
               values (%s, 'region:in', %s, 'x', 'monthly', 'neutral', 'Test')""",
            (sid, name),
        )
        sdb.execute(
            "insert into indicator_point (series_id, date, value) values (%s, current_date, 1)", (sid,)
        )
    data = check("region", call(sdb, "region", {"id": "region:in", "window": "7d"}))
    assert ids(data["kpis"]) == [
        "indicator:in-cpi",
        "indicator:in-policy-rate",
        "indicator:in-fx",
        "indicator:in-test-diesel",  # fuel ranks above power and PMI
    ]
    single = next(k for k in data["kpis"] if k["id"] == "indicator:in-test-diesel")
    assert single["previous"] is None and single["change"] is None and len(single["series"]) == 1


@pytest.mark.parametrize(
    ("region_id", "scope"),
    [
        ("region:in-gj", "region:in-gj"),  # its own KPIs
        ("region:in-dl", "region:in"),  # state without KPIs: the country's
        ("region:in-gj.surat", "region:in"),  # city: the country's
        ("region:ad-02", None),  # neither has KPIs
        ("region:ad", None),
    ],
)
def test_region_kpi_fallback(sdb, region_id, scope):
    data = call(sdb, "region", {"id": region_id, "window": "7d"})
    assert data["kpi_scope"] == scope
    if scope is None:
        assert data["kpis"] == []
    else:
        subjects = {
            r["subject_id"]
            for r in rows(
                sdb,
                "select subject_id from indicator_series where node_id = any(%s)",
                (ids(data["kpis"]),),
            )
        }
        assert subjects == {scope}


@pytest.mark.parametrize(
    ("region_id", "column"),
    [
        ("region:in", "country_id"),
        ("region:in-gj", "admin1_id"),
        ("region:in-dl.new-delhi", "primary_region"),
    ],
)
def test_region_stories_are_the_top_ten_inside(sdb, region_id, column):
    data = call(sdb, "region", {"id": region_id, "window": "30d"})
    inside = [r for r in sample_events(sdb, 720) if r[column] == region_id]
    expected = sorted(inside, key=lambda r: (-r["importance"], -r["first_seen"].timestamp()))[:10]
    assert ids(data["stories"]) == [r["id"] for r in expected]
    assert data["stories"], "the sample has stories here"


def test_region_bloc_covers_member_countries_and_the_bloc_itself(sdb):
    members = {
        r["src"] for r in rows(sdb, "select src from edge where dst = 'region:eu' and type = 'member_of'")
    }
    assert len(members) == 27
    on_bloc = {
        r["src"] for r in rows(sdb, "select src from edge where dst = 'region:eu' and type = 'mentions'")
    }
    inside = [
        r
        for r in sample_events(sdb, 720)
        if r["country_id"] in members or (r["country_id"] is None and r["id"] in on_bloc)
    ]
    assert any(r["country_id"] is None for r in inside)  # the EU gas storage story sits on the bloc
    data = call(sdb, "compare", {"ids": ["region:eu", "region:de"], "window": "30d"})
    assert data["regions"][0]["counts"] == {k: sum(1 for r in inside if r["impact"] == k) for k in IMPACTS}
    panel = call(sdb, "region", {"id": "region:eu", "window": "30d"})
    expected = sorted(inside, key=lambda r: (-r["importance"], -r["first_seen"].timestamp()))[:10]
    assert ids(panel["stories"]) == [r["id"] for r in expected]
    assert sum(c["count"] for c in panel["children"]) == sum(1 for r in inside if r["country_id"])


@pytest.mark.parametrize("window", ["24h", "7d", "30d"])
def test_region_sector_pulse(sdb, window):
    data = call(sdb, "region", {"id": "region:in", "window": window})
    hours = WINDOW_HOURS[window]
    now = db_now(sdb)
    recent = [r for r in sample_events(sdb, 2 * hours) if r["country_id"] == "region:in"]
    current = [r for r in recent if (now - r["first_seen"]).total_seconds() <= hours * 3600]
    previous = [r for r in recent if (now - r["first_seen"]).total_seconds() > hours * 3600]
    for pulse in data["sector_pulse"]:
        cur = [r for r in current if pulse["sector"] in r["sectors"]]
        prev = [r for r in previous if pulse["sector"] in r["sectors"]]
        assert pulse["count"] == len(cur)
        expected_dir = "up" if len(cur) > len(prev) else "down" if len(cur) < len(prev) else None
        assert pulse["direction"] == expected_dir
        weight = {k: sum(r["importance"] for r in cur if r["impact"] == k) for k in IMPACTS}
        total = sum(weight.values())
        if not cur:
            assert pulse["impact"] == "neutral" and pulse["score"] == 0
            continue
        assert pulse["score"] == pytest.approx((weight["opportunity"] - weight["risk"]) / total, abs=1e-3)
        top = max(weight.values())
        winners = [k for k, v in weight.items() if v == top]
        assert pulse["impact"] == (winners[0] if len(winners) == 1 else "neutral")
    assert sum(p["count"] for p in data["sector_pulse"]) >= len(current)


def test_region_decisions(sdb):
    country = call(sdb, "region", {"id": "region:in", "window": "7d"})
    expected = sorted(
        (f for f in visible_sample_forecasts(sdb) if f["id"] in about(sdb, ["region:in"])),
        key=lambda f: (f["end_date"], f["id"]),
    )
    assert ids(country["decisions"]) == [f["id"] for f in expected][:8]
    assert country["decisions"]
    ends = [d["end_date"] for d in country["decisions"]]
    assert ends == sorted(ends)

    # A state also shows its country's decisions.
    state = call(sdb, "region", {"id": "region:in-gj", "window": "7d"})
    allowed = about(sdb, ["region:in", "region:in-gj"])
    assert set(ids(country["decisions"])) <= set(ids(state["decisions"]))
    assert all(d["id"] in allowed for d in state["decisions"])

    # A bloc shows forecasts about itself or its members.
    bloc = call(sdb, "region", {"id": "region:eu", "window": "7d"})
    members = [
        r["src"] for r in rows(sdb, "select src from edge where dst = 'region:eu' and type = 'member_of'")
    ]
    assert all(d["id"] in about(sdb, ["region:eu", *members]) for d in bloc["decisions"])
    assert bloc["decisions"]


def test_region_children_of_a_country_include_every_state(sdb):
    data = call(sdb, "region", {"id": "region:in", "window": "30d"})
    states = scalar(sdb, "select count(*) from region where parent_id = 'region:in' and level = 'state'")
    assert len(data["children"]) == states > 30
    assert all(c["subtype"] == "state" for c in data["children"])
    per_state = Counter(
        r["admin1_id"] for r in sample_events(sdb, 720) if r["country_id"] == "region:in" and r["admin1_id"]
    )
    assert {c["id"]: c["count"] for c in data["children"] if c["count"]} == dict(per_state)
    for c in data["children"]:
        assert c["risk"] + c["opportunity"] + c["neutral"] == c["count"]
        expected = (c["opportunity"] - c["risk"]) / c["count"] if c["count"] else 0
        assert c["score"] == pytest.approx(expected, abs=1e-3)
    counts = [c["count"] for c in data["children"]]
    assert counts == sorted(counts, reverse=True)


def test_region_children_of_state_bloc_and_city(sdb):
    state = call(sdb, "region", {"id": "region:in-gj", "window": "30d"})
    cities = scalar(sdb, "select count(*) from region where parent_id = 'region:in-gj' and level = 'city'")
    assert len(state["children"]) == cities > 0
    assert all(c["subtype"] == "city" for c in state["children"])
    per_city = Counter(
        r["primary_region"] for r in sample_events(sdb, 720) if r["admin1_id"] == "region:in-gj"
    )
    for c in state["children"]:
        assert c["count"] == per_city.get(c["id"], 0)

    bloc = call(sdb, "region", {"id": "region:eu", "window": "30d"})
    assert len(bloc["children"]) == 27 and all(c["subtype"] == "country" for c in bloc["children"])

    city = call(sdb, "region", {"id": "region:in-gj.surat", "window": "30d"})
    assert city["children"] == []


@pytest.mark.parametrize("region_id", ["region:in", "region:in-gj", "region:eu", "region:us-tx", "region:ad"])
def test_region_graph_is_a_consistent_local_graph(sdb, region_id):
    data = call(sdb, "region", {"id": region_id, "window": "30d"})
    graph = data["graph"]
    node_ids = ids(graph["nodes"])
    assert len(node_ids) == len(set(node_ids))
    assert region_id in node_ids
    for link in graph["links"]:
        assert link["source"] in node_ids and link["target"] in node_ids
    degree = Counter()
    for link in graph["links"]:
        degree[link["source"]] += 1
        degree[link["target"]] += 1
    for node in graph["nodes"]:
        assert node["degree"] == degree[node["id"]]
        assert (node["impact"] is not None) == (node["type"] == "story")
    child_ids = set(ids(data["children"]))
    assert len([n for n in node_ids if n in child_ids]) <= 12
    stories = [n for n in graph["nodes"] if n["type"] == "story"]
    assert len(stories) <= 25
    # Every story hangs off the region or one of its children.
    for s in stories:
        assert degree[s["id"]] >= 1
    causal = [lk for lk in graph["links"] if lk["causal"]]
    assert all(lk["type"] in ("reported", "inferred", "projected", "conditional") for lk in causal)
    assert all(lk["confidence"] is not None for lk in causal)


def test_region_graph_story_selection(sdb):
    data = call(sdb, "region", {"id": "region:in", "window": "30d"})
    inside = sorted(
        (r for r in sample_events(sdb, 720) if r["country_id"] == "region:in"),
        key=lambda r: (-r["importance"], -r["first_seen"].timestamp()),
    )
    graph_stories = {n["id"] for n in data["graph"]["nodes"] if n["type"] == "story"}
    assert graph_stories == {r["id"] for r in inside[:25]}
    fc_nodes = {n["id"] for n in data["graph"]["nodes"] if n["type"] == "forecast"}
    assert fc_nodes and fc_nodes <= about(sdb, ["region:in"])
    for n in data["graph"]["nodes"]:
        if n["type"] == "story":
            first_seen = scalar(sdb, "select first_seen from story where node_id = %s", (n["id"],))
            assert datetime.fromisoformat(n["created_at"]) == first_seen


# ---------------------------------------------------------------------------
# api.compare
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "args",
    [
        {"ids": ["region:in", "region:us"]},
        {"ids": ["region:in", "region:us", "region:in-gj"], "window": "30d"},
        {"ids": ["region:eu", "region:in-gj.surat"], "window": "24h"},
        {"ids": ["region:in", "region:cn"], "window": "7d", "sample": False},
    ],
)
def test_compare_contract(sdb, args):
    data = check("compare", call(sdb, "compare", args))
    assert [r["region"]["id"] for r in data["regions"]] == args["ids"]


def test_compare_matches_the_region_panel(sdb):
    data = call(sdb, "compare", {"ids": ["region:in", "region:in-dl", "region:us"], "window": "30d"})
    for item in data["regions"]:
        panel = call(sdb, "region", {"id": item["region"]["id"], "window": "30d"})
        assert item["kpis"] == panel["kpis"]
        assert item["sector_pulse"] == panel["sector_pulse"]
        inside = [
            r
            for r in sample_events(sdb, 720)
            if item["region"]["id"] in (r["country_id"], r["admin1_id"], r["primary_region"])
        ]
        assert item["counts"] == {k: sum(1 for r in inside if r["impact"] == k) for k in IMPACTS}
    assert data["regions"][1]["region"]["country_id"] == "region:in"


@pytest.mark.parametrize(
    "args",
    [
        {"ids": ["region:in"]},
        {"ids": []},
        {"ids": ["region:in", "region:in"]},
        {"ids": ["region:in", "region:us", "region:cn", "region:jp"]},
        {},
        {"ids": "region:in"},
    ],
)
def test_compare_needs_two_or_three_ids(sdb, args):
    with pytest.raises(psycopg.errors.RaiseException), sdb.transaction():
        call(sdb, "compare", args)


def test_compare_unknown_id(sdb):
    raises_not_found(sdb, "compare", {"ids": ["region:in", "region:nowhere"]})
    raises_not_found(sdb, "compare", {"ids": ["region:in", "commodity:crude-oil"]})


# ---------------------------------------------------------------------------
# api.brief
# ---------------------------------------------------------------------------

BRIEF_ORDER = [
    "top_risks",
    "top_opportunities",
    "biggest_movers",
    "odds_moved",
    "cascade_to_watch",
    "region_spotlight",
]


@pytest.mark.parametrize(
    "args",
    [
        {},
        {"profile": EMPTY_PROFILE},
        {"profile": {**EMPTY_PROFILE, "sectors": ["energy"], "locations": ["region:in"]}},
        {"sample": False},
        {"profile": None},
    ],
)
def test_brief_contract_and_card_order(sdb, args):
    data = check("brief", call(sdb, "brief", args))
    assert [c["kind"] for c in data["cards"]] == BRIEF_ORDER


def test_brief_cards_on_the_sample(sdb):
    data = call(sdb, "brief", {})
    day = sample_events(sdb, 24)
    assert len(day) >= 3  # so the window is the last 24 hours
    day_ids = {r["id"] for r in day}

    for kind, impact in (("top_risks", "risk"), ("top_opportunities", "opportunity")):
        stories = card(data, kind)["stories"]
        expected = sorted((r for r in day if r["impact"] == impact), key=lambda r: -r["importance"])[:3]
        assert ids(stories) == [r["id"] for r in expected]

    movers = card(data, "biggest_movers")["stories"]
    assert len(movers) == 3 and set(ids(movers)) <= day_ids
    top_sources = sorted(r["source_count"] for r in day)[-3:]
    assert sorted(s["source_count"] for s in movers) == top_sources

    odds = card(data, "odds_moved")["forecasts"]
    expected_odds = sorted(
        (f for f in visible_sample_forecasts(sdb) if f["change_24h"] is not None),
        key=lambda f: -abs(f["change_24h"]),
    )[:3]
    assert ids(odds) == [f["id"] for f in expected_odds]

    cascade = card(data, "cascade_to_watch")
    week = {r["id"] for r in sample_events(sdb, 168)}
    out = Counter(
        r["src_story"] for r in rows(sdb, "select src_story from causal_link") if r["src_story"] in week
    )
    assert cascade["focus"]["id"] in week
    assert cascade["effects"] == out[cascade["focus"]["id"]] == max(out.values())

    spotlight = card(data, "region_spotlight")
    per_country = Counter(r["country_id"] for r in day if r["country_id"])
    assert per_country[spotlight["region"]["id"]] == max(per_country.values())
    in_country = [r for r in day if r["country_id"] == spotlight["region"]["id"]]
    by_importance = sorted(in_country, key=lambda r: (-r["importance"], -r["first_seen"].timestamp()))
    assert ids(spotlight["stories"]) == [r["id"] for r in by_importance[:3]]
    opp = sum(1 for r in in_country if r["impact"] == "opportunity")
    risk = sum(1 for r in in_country if r["impact"] == "risk")
    assert spotlight["score"] == pytest.approx((opp - risk) / len(in_country), abs=1e-3)


def test_brief_without_sample_or_live_data_is_empty(sdb):
    data = check("brief", call(sdb, "brief", {"sample": False}))
    for c in data["cards"]:
        assert c.get("stories", []) == [] and c.get("forecasts", []) == []
    assert card(data, "cascade_to_watch") == {"kind": "cascade_to_watch", "focus": None, "effects": 0}
    spotlight = card(data, "region_spotlight")
    assert spotlight["region"] is None and spotlight["score"] == 0


def _live_brief_world(sdb) -> None:
    add_story(sdb, "story:t-risk-a", impact="risk", importance=90, country="region:de", sources=5)
    add_story(sdb, "story:t-risk-b", impact="risk", importance=80, country="region:de", sources=9)
    add_story(sdb, "story:t-risk-c", impact="risk", importance=70, country="region:de", sources=2)
    add_story(sdb, "story:t-risk-d", impact="risk", importance=65, country="region:br", sources=1)
    add_story(sdb, "story:t-opp-a", impact="opportunity", importance=60, country="region:br", sources=30)


def test_brief_profile_boosts_matching_stories(sdb):
    _live_brief_world(sdb)
    plain = card(call(sdb, "brief", {"sample": False}), "top_risks")
    assert ids(plain["stories"]) == ["story:t-risk-a", "story:t-risk-b", "story:t-risk-c"]

    located = {"sample": False, "profile": {**EMPTY_PROFILE, "locations": ["region:br"]}}
    boosted = check("brief", call(sdb, "brief", located))
    # 65 × 1.5 = 97.5 beats 90.
    assert ids(card(boosted, "top_risks")["stories"]) == [
        "story:t-risk-d",
        "story:t-risk-a",
        "story:t-risk-b",
    ]

    sdb.execute("insert into edge (src, dst, type) values ('story:t-risk-c', 'commodity:rice', 'mentions')")
    mentioned = {"sample": False, "profile": {**EMPTY_PROFILE, "inputs": ["commodity:rice"]}}
    boosted = call(sdb, "brief", mentioned)
    # 70 × 1.5 = 105 tops the list.
    assert ids(card(boosted, "top_risks")["stories"])[0] == "story:t-risk-c"


def test_brief_live_cards(sdb):
    _live_brief_world(sdb)
    add_link(sdb, "story:t-risk-a", "story:t-risk-b")
    add_link(sdb, "story:t-risk-a", "story:t-risk-c")
    add_link(sdb, "story:t-risk-b", "story:t-risk-c", "inferred")
    data = check("brief", call(sdb, "brief", {"sample": False}))
    assert ids(card(data, "top_opportunities")["stories"]) == ["story:t-opp-a"]
    assert ids(card(data, "biggest_movers")["stories"]) == [
        "story:t-opp-a",
        "story:t-risk-b",
        "story:t-risk-a",
    ]
    cascade = card(data, "cascade_to_watch")
    assert cascade["focus"]["id"] == "story:t-risk-a" and cascade["effects"] == 2
    spotlight = card(data, "region_spotlight")
    assert spotlight["region"]["id"] == "region:de"
    assert ids(spotlight["stories"]) == ["story:t-risk-a", "story:t-risk-b", "story:t-risk-c"]
    assert spotlight["score"] == -1


def test_brief_falls_back_to_seven_days_on_a_quiet_day(sdb):
    add_story(sdb, "story:q-today-a", importance=40, hours_ago=2, sources=1)
    add_story(sdb, "story:q-today-b", importance=40, hours_ago=5, sources=1)
    add_story(sdb, "story:q-tuesday", importance=40, hours_ago=72, sources=20)
    add_story(sdb, "story:q-old", importance=40, hours_ago=24 * 9, sources=50)
    quiet = call(sdb, "brief", {"sample": False})
    movers = ids(card(quiet, "biggest_movers")["stories"])
    assert movers[0] == "story:q-tuesday" and "story:q-old" not in movers

    add_story(sdb, "story:q-today-c", importance=40, hours_ago=3, sources=1)
    busy = call(sdb, "brief", {"sample": False})
    assert "story:q-tuesday" not in ids(card(busy, "biggest_movers")["stories"])


def test_brief_cascade_ignores_older_events(sdb):
    add_story(sdb, "story:c-old", hours_ago=24 * 8)
    add_story(sdb, "story:c-new", hours_ago=2)
    for i in range(3):
        add_story(sdb, f"story:c-effect-{i}", hours_ago=1)
        add_link(sdb, "story:c-old", f"story:c-effect-{i}")
    add_link(sdb, "story:c-new", "story:c-effect-0")
    cascade = card(call(sdb, "brief", {"sample": False}), "cascade_to_watch")
    assert cascade["focus"]["id"] == "story:c-new" and cascade["effects"] == 1


# ---------------------------------------------------------------------------
# Real-money forecasts fail closed
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(("country", "shown"), [(None, False), ("IN", False), ("US", True)])
def test_real_money_forecasts_are_gated_by_viewer_country(sdb, country, shown):
    add_polymarket_forecast(sdb)

    meta = check("meta", call(sdb, "meta", viewer(country)))
    assert ("polymarket" in {s["id"] for s in meta["sources"]}) is shown
    assert meta["data"]["forecasts"] == len(visible_sample_forecasts(sdb)) + (1 if shown else 0)

    globe = check("globe", call(sdb, "globe", viewer(country, window="24h")))
    assert (PM in ids(globe["forecasts"])) is shown

    top = check("top", call(sdb, "top", viewer(country, window="24h")))
    assert (PM in ids(top["movers"])) is shown

    region = check("region", call(sdb, "region", viewer(country, id="region:in", window="7d")))
    assert (PM in ids(region["decisions"])) is shown
    assert (PM in ids(region["graph"]["nodes"])) is shown

    state = check("region", call(sdb, "region", viewer(country, id="region:in-gj", window="7d")))
    assert (PM in ids(state["decisions"])) is shown

    brief = check("brief", call(sdb, "brief", viewer(country)))
    assert (PM in ids(card(brief, "odds_moved")["forecasts"])) is shown
    if shown:
        assert ids(top["movers"])[0] == PM  # a 30-point move is the biggest
        assert ids(region["decisions"])[0] == PM  # it ends first


def test_disabled_real_money_provider_is_hidden_even_where_allowed(sdb):
    add_polymarket_forecast(sdb)
    sdb.execute("update forecast_provider set enabled = false where id = 'polymarket'")
    us = {"_viewer": {"country": "US"}}
    assert PM not in ids(call(sdb, "globe", {**us, "window": "24h"})["forecasts"])
    assert PM not in ids(call(sdb, "region", {**us, "id": "region:in", "window": "7d"})["decisions"])
    assert "polymarket" not in {s["id"] for s in call(sdb, "meta", us)["sources"]}


# ---------------------------------------------------------------------------
# Timing
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("name", "args"),
    [
        ("meta", {}),
        ("globe", {"window": "30d"}),
        ("globe", {"window": "24h", "sectors": ["energy"]}),
        ("top", {"window": "30d"}),
        ("region", {"id": "region:in", "window": "30d"}),
        ("region", {"id": "region:us", "window": "30d"}),
        ("region", {"id": "region:eu", "window": "30d"}),
        ("region", {"id": "region:in-gj.surat", "window": "7d"}),
        ("compare", {"ids": ["region:in", "region:us", "region:eu"], "window": "30d"}),
        ("brief", {}),
        ("brief", {"profile": {**EMPTY_PROFILE, "sectors": ["energy"], "locations": ["region:in"]}}),
    ],
)
def test_timing(sdb, name, args):
    started = time.perf_counter()
    call(sdb, name, args)
    elapsed = time.perf_counter() - started
    assert elapsed < 0.5, f"api.{name} took {elapsed * 1000:.0f} ms"

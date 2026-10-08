"""api.forecasts, api.forecast, api.affects, api.opportunities, api.ask_context,
api.pending_analysis and api.save_analysis (migration 0006), plus the faster
api.forecast_card view.

Tests run against the seeded test database (sample data, clock moved to now)
inside a transaction that is rolled back afterwards, so they may add rows.
Adding a live story switches the default sample rule off (live data exists),
so tests that add live rows pass `sample` explicitly where it matters.
"""

from __future__ import annotations

import json
import math
import time
from datetime import datetime, timedelta
from typing import Any

import psycopg
import pytest

from tests.contract import call, check

REAL_MONEY = "forecast:test-real-money-c"
US: dict[str, Any] = {"_viewer": {"country": "US"}}
IN: dict[str, Any] = {"_viewer": {"country": "IN"}}
HIDDEN_VIEWERS: list[dict[str, Any]] = [{}, IN, {"_viewer": {"country": ""}}]
SECTORS = {
    "energy",
    "agri-food",
    "manufacturing",
    "logistics-trade",
    "finance",
    "tech",
    "health",
    "real-estate",
    "consumer",
}
CATEGORY_SECTORS = {
    "economy": {"finance"},
    "finance": {"finance"},
    "trade": {"logistics-trade"},
    "energy": {"energy"},
    "commodities": {"agri-food", "manufacturing", "energy"},
    "tech": {"tech"},
}

PROFILE: dict[str, Any] = {
    "name": "Test textiles",
    "sectors": ["manufacturing", "logistics-trade"],
    "locations": ["region:in-gj"],
    "inputs": ["commodity:crude-oil"],
    "suppliers": ["region:cn"],
    "markets": ["region:eu"],
    "competitors": [],
    "keywords": ["freight"],
}
EMPTY_PROFILE: dict[str, Any] = {
    "name": None,
    "sectors": [],
    "locations": [],
    "inputs": [],
    "suppliers": [],
    "markets": [],
    "competitors": [],
    "keywords": [],
}


def profile(**changes: Any) -> dict[str, Any]:
    return {**EMPTY_PROFILE, **changes}


# The api.forecast_card view as 0002 defined it (DISTINCT ON over every
# snapshot, sparkline via api._sparkline): 0006 must return exactly this.
ORIGINAL_FORECAST_CARD = """
with latest as (
    select distinct on (forecast_id) forecast_id, ts, probability, volume, liquidity
    from forecast_snapshot
    order by forecast_id, ts desc
)
select
    f.node_id as id,
    f.provider,
    f.category,
    f.end_date,
    f.status,
    n.is_sample,
    n.geom::text as geom,
    l.probability,
    (l.probability - api._prob_at(f.node_id, l.ts - interval '24 hours')) as change_24h,
    (coalesce(l.volume, 0) < fp.thin_volume or coalesce(l.liquidity, 0) < fp.thin_liquidity) as thin,
    coalesce(l.volume, 0) < fp.hide_volume as hidden,
    region_edge.dst as region_id,
    jsonb_build_object(
        'id', f.node_id,
        'short_title', f.short_title,
        'question', f.question,
        'category', f.category,
        'probability', round(l.probability::numeric, 3),
        'change_24h', round((l.probability
                             - api._prob_at(f.node_id, l.ts - interval '24 hours'))::numeric, 3),
        'volume', l.volume,
        'volume_unit', f.volume_unit,
        'liquidity', l.liquidity,
        'thin', (coalesce(l.volume, 0) < fp.thin_volume or coalesce(l.liquidity, 0) < fp.thin_liquidity),
        'end_date', f.end_date,
        'updated_at', l.ts,
        'provider', f.provider,
        'provider_name', fp.name,
        'url', case when fp.link_allowed then f.url end,
        'region', case when region_edge.dst is not null then api._region_ref(region_edge.dst) end,
        'lon', round(st_x(n.geom::geometry)::numeric, 4),
        'lat', round(st_y(n.geom::geometry)::numeric, 4),
        'sparkline', api._sparkline(f.node_id),
        'is_sample', n.is_sample
    ) as card
from forecast f
join node n on n.id = f.node_id
join forecast_provider fp on fp.id = f.provider
join latest l on l.forecast_id = f.node_id
left join lateral (
    select e.dst from edge e
    join node rn on rn.id = e.dst and rn.type = 'region'
    where e.src = f.node_id and e.type = 'about'
    order by e.id limit 1
) region_edge on true
order by id
"""

NEW_FORECAST_CARD = """
select id, provider, category, end_date, status, is_sample, geom::text as geom, probability, change_24h,
       thin, hidden, region_id, card
from api.forecast_card
order by id
"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def query(conn: psycopg.Connection, sql: str, *params: Any) -> list[dict[str, Any]]:
    return conn.execute(sql, params).fetchall()


def scalar(conn: psycopg.Connection, sql: str, *params: Any) -> Any:
    row = conn.execute(sql, params).fetchone()
    assert row is not None
    return next(iter(row.values()))


def ids(items: list[dict[str, Any]]) -> list[str]:
    return [item["id"] for item in items]


def ts(value: str) -> datetime:
    return datetime.fromisoformat(value)


def timed(conn: psycopg.Connection, name: str, args: dict[str, Any]) -> tuple[Any, float]:
    start = time.perf_counter()
    data = call(conn, name, args)
    return data, (time.perf_counter() - start) * 1000


def assert_raises(conn: psycopg.Connection, name: str, args: dict[str, Any], prefix: str) -> None:
    with pytest.raises(psycopg.errors.RaiseException) as info, conn.transaction():
        call(conn, name, args)
    assert info.value.diag.message_primary.startswith(prefix), info.value.diag.message_primary


def assert_not_found(conn: psycopg.Connection, name: str, args: dict[str, Any]) -> None:
    assert_raises(conn, name, args, "Not found")


def add_story(
    conn: psycopg.Connection,
    sid: str,
    *,
    kind: str = "event",
    headline: str = "Test story about a port in Gujarat",
    so_what: str | None = "A short test so-what.",
    impact: str = "risk",
    importance: float = 50.0,
    confidence: float | None = 0.8,
    sectors: tuple[str, ...] = ("logistics-trade",),
    country: str | None = "region:in",
    admin1: str | None = "region:in-gj",
    region: str | None = "region:in-gj",
    mentions: tuple[str, ...] = (),
    hours_ago: float = 2.0,
    sources: int = 4,
    status: str = "done",
    actions: tuple[str, ...] = (),
    sample: bool = False,
) -> None:
    """A live (or sample) story, by default in Gujarat, India."""
    conn.execute(
        "insert into node (id, type, subtype, name, is_sample) values (%s, 'story', %s, %s, %s)",
        (sid, kind, headline, sample),
    )
    conn.execute(
        """insert into story (node_id, kind, headline, so_what, event_type, impact, importance, confidence,
                              sectors, primary_region, country_id, admin1_id, location, first_seen, last_seen,
                              source_count, analysis_status, actions)
           values (%(id)s, %(kind)s, %(headline)s, %(so_what)s, 'test', %(impact)s, %(importance)s,
                   %(confidence)s, %(sectors)s, %(region)s, %(country)s, %(admin1)s,
                   st_geogfromtext('SRID=4326;POINT(72.6 23.0)'),
                   case when %(kind)s = 'event' then now() - %(hours)s * interval '1 hour' end,
                   case when %(kind)s = 'event' then now() - %(hours)s * interval '1 hour' end,
                   %(sources)s, %(status)s, %(actions)s)""",
        {
            "id": sid,
            "kind": kind,
            "headline": headline,
            "so_what": so_what,
            "impact": impact,
            "importance": importance,
            "confidence": confidence,
            "sectors": list(sectors),
            "region": region,
            "country": country,
            "admin1": admin1,
            "hours": hours_ago,
            "sources": sources,
            "status": status,
            "actions": list(actions),
        },
    )
    for ref in sorted(set(mentions)):
        conn.execute(
            "insert into edge (src, dst, type, is_sample) values (%s, %s, 'mentions', %s)", (sid, ref, sample)
        )


def add_article(
    conn: psycopg.Connection,
    sid: str,
    url: str | None,
    *,
    title: str = "A source headline",
    source: str = "Test Wire",
    snippet: str | None = None,
    hours_ago: float = 1.0,
    sample: bool = False,
) -> None:
    conn.execute(
        """insert into article (story_id, url, source_name, title, published_at, snippet, is_sample)
           values (%s, %s, %s, %s, now() - %s * interval '1 hour', %s, %s)""",
        (sid, url, source, title, hours_ago, snippet, sample),
    )


def add_link(
    conn: psycopg.Connection,
    src: str,
    dst: str,
    link_type: str = "inferred",
    *,
    forecast: str | None = None,
    outcome: str | None = None,
    confidence: float = 0.6,
) -> int:
    row = conn.execute(
        """insert into causal_link (src_story, dst_story, link_type, mechanism, direction, confidence,
                                    forecast_id, outcome, method)
           values (%s, %s, %s, 'raises test costs', 'up', %s, %s, %s, 'test') returning id""",
        (src, dst, link_type, confidence, forecast, outcome),
    ).fetchone()
    assert row is not None
    return row["id"]


def add_forecast(
    conn: psycopg.Connection,
    fid: str,
    *,
    provider: str = "manifold",
    category: str = "trade",
    title: str = "Will the test question resolve yes?",
    about: tuple[str, ...] = ("region:in",),
    relates_to: tuple[str, ...] = (),
    volume: float = 50000,
    liquidity: float = 8000,
    probabilities: tuple[float, float] = (0.40, 0.55),
    status: str = "open",
    end_days: float = 60,
) -> None:
    """A live forecast with two snapshots (3 days and 1 hour ago)."""
    if provider == "polymarket":
        conn.execute("update forecast_provider set enabled = true where id = 'polymarket'")
    conn.execute(
        """insert into node (id, type, subtype, name, summary, geom)
           values (%s, 'forecast', 'binary', %s, %s, st_geogfromtext('SRID=4326;POINT(78.9 21.1)'))""",
        (fid, title, title),
    )
    conn.execute(
        """insert into forecast (node_id, provider, provider_ref, question, short_title, category, end_date,
                                 url, is_real_money, volume_unit, status)
           values (%s, %s, %s, %s, %s, %s, now() + %s * interval '1 day', %s, %s, 'USD', %s)""",
        (
            fid,
            provider,
            fid,
            title,
            title,
            category,
            end_days,
            f"https://example.org/{fid}",
            provider == "polymarket",
            status,
        ),
    )
    conn.execute(
        """insert into forecast_snapshot (forecast_id, ts, probability, volume, liquidity)
           values (%(id)s, now() - interval '3 days', %(p0)s, %(v)s * 0.8, %(l)s),
                  (%(id)s, now() - interval '1 hour', %(p1)s, %(v)s, %(l)s)""",
        {"id": fid, "p0": probabilities[0], "p1": probabilities[1], "v": volume, "l": liquidity},
    )
    for ref in about:
        conn.execute("insert into edge (src, dst, type) values (%s, %s, 'about')", (fid, ref))
    for sid in relates_to:
        conn.execute("insert into edge (src, dst, type) values (%s, %s, 'relates_to')", (fid, sid))


def add_real_money(conn: psycopg.Connection, **kw: Any) -> None:
    add_forecast(conn, REAL_MONEY, provider="polymarket", volume=500000, liquidity=80000, **kw)


def forecast_ids(data: dict[str, Any]) -> list[str]:
    return ids(data["forecasts"])


def story_ids(items: list[dict[str, Any]]) -> list[str]:
    return [item["story"]["id"] for item in items]


def sample_forecast_with_branches(conn: psycopg.Connection) -> str:
    return scalar(
        conn,
        """select forecast_id from causal_link where link_type = 'conditional'
           group by forecast_id order by count(*) desc, forecast_id limit 1""",
    )


def valid_item(sid: str, **changes: Any) -> dict[str, Any]:
    item: dict[str, Any] = {
        "id": sid,
        "headline": "Gujarat port adds a second container berth",
        "so_what": "More berth space shortens queues for exporters shipping from western India.",
        "event_type": "infrastructure",
        "impact": "opportunity",
        "direction": "up",
        "magnitude": 3,
        "horizon": "months",
        "confidence": 0.8,
        "sectors": ["logistics-trade"],
        "actions": ["Ask forwarders about new berth slots"],
        "entities": ["region:in-gj", "commodity:crude-oil", "org:does-not-exist"],
        "links": [],
    }
    item.update(changes)
    return item


def valid_link(src: str, **changes: Any) -> dict[str, Any]:
    link: dict[str, Any] = {
        "from": src,
        "link_type": "inferred",
        "mechanism": "frees up capacity",
        "direction": "up",
        "confidence": 0.6,
        "evidence": "Port officials linked the new berth to the earlier dredging work.",
    }
    link.update(changes)
    return link


def save(conn: psycopg.Connection, items: list[dict[str, Any]], **extra: Any) -> dict[str, Any]:
    return check(
        "save_analysis",
        call(conn, "save_analysis", {"engine": "artifact", "model": "test-model", "items": items, **extra}),
    )


# ---------------------------------------------------------------------------
# api.forecast_card (the rebuilt view)
# ---------------------------------------------------------------------------


def test_forecast_card_columns_unchanged(sdb: psycopg.Connection) -> None:
    cols = query(
        sdb,
        """select column_name, data_type from information_schema.columns
           where table_schema = 'api' and table_name = 'forecast_card' order by ordinal_position""",
    )
    assert [(c["column_name"], c["data_type"]) for c in cols] == [
        ("id", "text"),
        ("provider", "text"),
        ("category", "text"),
        ("end_date", "timestamp with time zone"),
        ("status", "text"),
        ("is_sample", "boolean"),
        ("geom", "USER-DEFINED"),
        ("probability", "real"),
        ("change_24h", "real"),
        ("thin", "boolean"),
        ("hidden", "boolean"),
        ("region_id", "text"),
        ("card", "jsonb"),
    ]


def test_forecast_card_matches_original_view_on_seed(sdb: psycopg.Connection) -> None:
    old = query(sdb, ORIGINAL_FORECAST_CARD)
    new = query(sdb, NEW_FORECAST_CARD)
    assert len(old) == len(new) >= 30
    assert old == new


def test_forecast_card_matches_original_view_with_live_rows(sdb: psycopg.Connection) -> None:
    # A live forecast with hourly snapshots for 40 days, one without any
    # snapshot (no card either way), a single-snapshot one and a real-money one.
    add_forecast(sdb, "forecast:test-hourly", about=("region:in-gj", "commodity:rice"))
    sdb.execute(
        """insert into forecast_snapshot (forecast_id, ts, probability, volume, liquidity)
           select 'forecast:test-hourly', date_trunc('hour', now()) - g * interval '1 hour',
                  0.3 + 0.2 * sin(g / 17.0), 1000 + g, 500
           from generate_series(2, 960) g"""
    )
    add_forecast(sdb, "forecast:test-single")
    sdb.execute(
        "delete from forecast_snapshot where forecast_id = 'forecast:test-single'"
        " and ts < now() - interval '2 hours'"
    )
    add_forecast(sdb, "forecast:test-empty")
    sdb.execute("delete from forecast_snapshot where forecast_id = 'forecast:test-empty'")
    add_real_money(sdb)
    old = query(sdb, ORIGINAL_FORECAST_CARD)
    new = query(sdb, NEW_FORECAST_CARD)
    assert old == new
    got = {r["id"] for r in new}
    assert {"forecast:test-hourly", "forecast:test-single", REAL_MONEY} <= got
    assert "forecast:test-empty" not in got
    hourly = next(r for r in new if r["id"] == "forecast:test-hourly")
    assert len(hourly["card"]["sparkline"]) == 30


# ---------------------------------------------------------------------------
# api.forecasts
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "args",
    [
        {},
        {"sample": True},
        {"sample": False},
        {"sort": "moved"},
        {"sort": "ending"},
        {"sort": "volume"},
        {"sort": "nonsense"},
        {"include_thin": False},
        {"categories": ["trade", "energy"]},
        {"sectors": ["agri-food"]},
        {"regions": ["region:in-gj"]},
        {"regions": ["region:eu"], "sort": "ending"},
        {"profile": PROFILE},
        {"profile": EMPTY_PROFILE, "sectors": ["finance"], "regions": ["region:us"]},
        {"categories": ["politics"]},
    ],
)
def test_forecasts_contract(sdb: psycopg.Connection, args: dict[str, Any]) -> None:
    data = check("forecasts", call(sdb, "forecasts", args))
    assert len(data["forecasts"]) <= 100
    assert len(set(forecast_ids(data))) == len(data["forecasts"])


def test_forecasts_sample_rule(sdb: psycopg.Connection) -> None:
    every = forecast_ids(call(sdb, "forecasts", {}))
    total = scalar(sdb, "select count(*) from forecast where status = 'open'")
    assert len(every) == total  # no live data: sample shows by default, nothing is hidden
    assert call(sdb, "forecasts", {"sample": False})["forecasts"] == []
    add_forecast(sdb, "forecast:test-live")
    assert forecast_ids(call(sdb, "forecasts", {"sample": False})) == ["forecast:test-live"]
    assert "forecast:test-live" in forecast_ids(call(sdb, "forecasts", {"sample": True}))


def test_forecasts_sorts(sdb: psycopg.Connection) -> None:
    moved = call(sdb, "forecasts", {"sort": "moved"})["forecasts"]
    changes = [abs(f["change_24h"]) for f in moved]
    assert changes == sorted(changes, reverse=True)
    ending = call(sdb, "forecasts", {"sort": "ending"})["forecasts"]
    ends = [ts(f["end_date"]) for f in ending]
    assert ends == sorted(ends)
    by_volume = call(sdb, "forecasts", {"sort": "volume"})["forecasts"]
    volumes = [f["volume"] for f in by_volume]
    assert volumes == sorted(volumes, reverse=True)
    # relevance without a profile: 0.3 × movement + 0.2 × log volume scale
    rel = call(sdb, "forecasts", {})["forecasts"]
    scores = [
        0.3 * min(1, abs(f["change_24h"] or 0) * 5) + 0.2 * min(1, math.log10(1 + (f["volume"] or 0)) / 6)
        for f in rel
    ]
    for a, b in zip(scores, scores[1:], strict=False):
        assert a >= b - 0.003
    assert ids(rel) != ids(by_volume) or ids(rel) != ids(moved)


def test_forecasts_filters(sdb: psycopg.Connection) -> None:
    every = call(sdb, "forecasts", {})["forecasts"]
    thin = [f["id"] for f in every if f["thin"]]
    assert thin  # the sample has thin markets, shown by default
    no_thin = forecast_ids(call(sdb, "forecasts", {"include_thin": False}))
    assert set(no_thin) == {f["id"] for f in every} - set(thin)

    trade = call(sdb, "forecasts", {"categories": ["trade"]})["forecasts"]
    assert trade and {f["category"] for f in trade} == {"trade"}
    assert len(trade) == sum(1 for f in every if f["category"] == "trade")

    # Sectors: about sector:<id>, or the category speaks to the sector.
    about_sector = {
        r["src"] for r in query(sdb, "select src from edge where type = 'about' and dst = 'sector:energy'")
    }
    expected = {f["id"] for f in every if "energy" in CATEGORY_SECTORS.get(f["category"], set())} | (
        about_sector & {f["id"] for f in every}
    )
    assert set(forecast_ids(call(sdb, "forecasts", {"sectors": ["energy"]}))) == expected
    assert call(sdb, "forecasts", {"sectors": ["health"], "categories": ["policy"]})["forecasts"] == []


def test_forecasts_region_filter(sdb: psycopg.Connection) -> None:
    def about(fid: str) -> set[str]:
        return {r["dst"] for r in query(sdb, "select dst from edge where src = %s and type = 'about'", fid)}

    # A state: its own forecasts and its country's.
    gj = forecast_ids(call(sdb, "forecasts", {"regions": ["region:in-gj"]}))
    assert gj and all(about(f) & {"region:in", "region:in-gj"} for f in gj)
    # A country: also forecasts about its states (Telangana is in India).
    india = forecast_ids(call(sdb, "forecasts", {"regions": ["region:in"]}))
    assert "forecast:vannamar-import-alert-lifted" in india
    assert set(gj) <= set(india)
    # A bloc: also its member countries (Ireland is in the EU).
    eu = forecast_ids(call(sdb, "forecasts", {"regions": ["region:eu"]}))
    assert "forecast:dublin-datacentre-connections" in eu
    assert "forecast:eu-cbam-next-phase-eased" in eu
    assert call(sdb, "forecasts", {"regions": ["region:does-not-exist"]})["forecasts"] == []


def test_forecasts_profile_relevance(sdb: psycopg.Connection) -> None:
    plain = forecast_ids(call(sdb, "forecasts", {}))
    rice = forecast_ids(call(sdb, "forecasts", {"profile": profile(inputs=["commodity:rice"])}))
    assert sorted(plain) == sorted(rice)  # a profile ranks, it doesn't filter
    target = "forecast:india-rice-export-curbs"
    assert rice.index(target) < plain.index(target)
    assert rice[0] == target


def test_forecasts_limit_and_timing(sdb: psycopg.Connection) -> None:
    sdb.execute(
        """
        with f as (
            select 'forecast:test-bulk-' || g as id, g from generate_series(1, 110) g
        ),
        n as (
            insert into node (id, type, subtype, name)
            select id, 'forecast', 'binary', 'Bulk question ' || g from f
        ),
        fc as (
            insert into forecast (node_id, provider, provider_ref, question, short_title, category, end_date)
            select id, 'manifold', id, 'Bulk question ' || g || '?', 'Bulk question ' || g, 'trade',
                   now() + g * interval '1 day' from f
        )
        insert into forecast_snapshot (forecast_id, ts, probability, volume, liquidity)
        select f.id, date_trunc('hour', now()) - h * interval '1 hour', 0.5 + 0.001 * f.g - 0.001 * h,
               10000 + f.g, 2000
        from f cross join generate_series(0, 200) h
        """
    )
    for args in ({"sample": True}, {"sample": True, "sort": "ending"}, {"sample": True, "profile": PROFILE}):
        data, ms = timed(sdb, "forecasts", args)
        check("forecasts", data)
        assert len(data["forecasts"]) == 100
        assert ms < 500, f"api.forecasts took {ms:.0f} ms"


def test_forecasts_hide_closed_and_low_volume(sdb: psycopg.Connection) -> None:
    add_forecast(sdb, "forecast:test-closed", status="closed")
    add_forecast(sdb, "forecast:test-tiny", volume=10)  # below Manifold's hide_volume
    add_forecast(sdb, "forecast:test-thin", volume=3000)  # thin, still shown
    got = call(sdb, "forecasts", {"sample": False})["forecasts"]
    assert ids(got) == ["forecast:test-thin"]
    assert got[0]["thin"] is True
    assert forecast_ids(call(sdb, "forecasts", {"sample": False, "include_thin": False})) == []


@pytest.mark.parametrize("viewer", HIDDEN_VIEWERS)
def test_forecasts_real_money_hidden(sdb: psycopg.Connection, viewer: dict[str, Any]) -> None:
    add_real_money(sdb)
    assert REAL_MONEY not in forecast_ids(call(sdb, "forecasts", {**viewer}))
    assert REAL_MONEY not in forecast_ids(call(sdb, "forecasts", {**viewer, "sample": False}))


def test_forecasts_real_money_shown_to_allowed_viewer(sdb: psycopg.Connection) -> None:
    add_real_money(sdb)
    shown = call(sdb, "forecasts", {**US, "sample": False})["forecasts"]
    assert ids(shown) == [REAL_MONEY]
    assert shown[0]["url"] == f"https://example.org/{REAL_MONEY}"
    # Switched off again (the default): hidden from everyone.
    sdb.execute("update forecast_provider set enabled = false where id = 'polymarket'")
    assert call(sdb, "forecasts", {**US, "sample": False})["forecasts"] == []


# ---------------------------------------------------------------------------
# api.forecast
# ---------------------------------------------------------------------------


def test_forecast_contract_for_every_sample_forecast(sdb: psycopg.Connection) -> None:
    for row in query(sdb, "select node_id from forecast order by node_id"):
        data = check("forecast", call(sdb, "forecast", {"id": row["node_id"]}))
        f = data["forecast"]
        assert f["id"] == row["node_id"]
        assert len(f["stories"]) <= 8
        assert len(f["history"]) <= 240


def test_forecast_not_found(sdb: psycopg.Connection) -> None:
    assert_not_found(sdb, "forecast", {"id": "forecast:does-not-exist"})
    assert_not_found(sdb, "forecast", {"id": "story:red-sea-attacks-reroute"})
    assert_not_found(sdb, "forecast", {})
    add_forecast(sdb, "forecast:test-tiny", volume=10)
    assert_not_found(sdb, "forecast", {"id": "forecast:test-tiny"})


@pytest.mark.parametrize("viewer", HIDDEN_VIEWERS)
def test_forecast_real_money_not_found(sdb: psycopg.Connection, viewer: dict[str, Any]) -> None:
    add_real_money(sdb)
    assert_not_found(sdb, "forecast", {"id": REAL_MONEY, **viewer})


def test_forecast_real_money_for_allowed_viewer(sdb: psycopg.Connection) -> None:
    add_real_money(sdb, about=("region:us", "region:in"))
    data = check("forecast", call(sdb, "forecast", {"id": REAL_MONEY, **US}))
    assert {e["id"] for e in data["forecast"]["entities"]} == {"region:us", "region:in"}
    assert [p["p"] for p in data["forecast"]["history"]] == [0.4, 0.55]


def test_forecast_details(sdb: psycopg.Connection) -> None:
    fid = sample_forecast_with_branches(sdb)
    data = call(sdb, "forecast", {"id": fid})
    f = data["forecast"]
    row = query(sdb, "select outcomes, resolution_rule from forecast where node_id = %s", fid)[0]
    assert f["outcomes"] == row["outcomes"]
    assert f["resolution_rule"] == row["resolution_rule"]
    about = {r["dst"] for r in query(sdb, "select dst from edge where src = %s and type = 'about'", fid)}
    assert {e["id"] for e in f["entities"]} == about
    # Related stories: relates_to first.
    related = [
        r["dst"] for r in query(sdb, "select dst from edge where src = %s and type = 'relates_to'", fid)
    ]
    got = ids(f["stories"])
    assert related and got[: len(related)] == sorted(
        related, key=lambda s: (-scalar(sdb, "select importance from story where node_id = %s", s), s)
    )
    assert len(got) == len(set(got)) == 8


def test_forecast_history_downsampled(sdb: psycopg.Connection) -> None:
    fid = "forecast:test-long-history"
    add_forecast(sdb, fid)
    sdb.execute(
        """insert into forecast_snapshot (forecast_id, ts, probability, volume, liquidity)
           select %s, date_trunc('hour', now()) - g * interval '1 hour', 0.5, g, 100
           from generate_series(2, 997) g""",
        (fid,),
    )
    snaps = query(sdb, "select ts from forecast_snapshot where forecast_id = %s order by ts", fid)
    n = len(snaps)
    assert n == 998
    history = check("forecast", call(sdb, "forecast", {"id": fid}))["forecast"]["history"]
    assert len(history) == 240
    got = [ts(p["ts"]) for p in history]
    assert got[0] == snaps[0]["ts"] and got[-1] == snaps[-1]["ts"]
    assert got == sorted(got)
    expected = [snaps[round(i * (n - 1) / 239)]["ts"] for i in range(240)]
    assert got == expected
    # Short histories come back whole.
    sample_id = scalar(sdb, "select node_id from forecast where provider = 'sample' order by node_id limit 1")
    count = scalar(sdb, "select count(*) from forecast_snapshot where forecast_id = %s", sample_id)
    assert len(call(sdb, "forecast", {"id": sample_id})["forecast"]["history"]) == min(count, 240)


def test_forecast_branches(sdb: psycopg.Connection) -> None:
    fid = sample_forecast_with_branches(sdb)
    data = call(sdb, "forecast", {"id": fid})
    p = data["forecast"]["probability"]
    links = query(
        sdb,
        """select upper(outcome) as outcome, src_story, dst_story, mechanism, confidence
           from causal_link where forecast_id = %s and link_type = 'conditional'""",
        fid,
    )
    branches = data["branches"]
    assert [b["outcome"] for b in branches] == ["YES", "NO"]
    assert branches[0]["probability"] == pytest.approx(p)
    assert branches[1]["probability"] == pytest.approx(round(1 - p, 3))
    for b in branches:
        want = {
            (lk["dst_story"], lk["src_story"], lk["mechanism"])
            for lk in links
            if lk["outcome"] == b["outcome"]
        }
        got = {(e["id"], e["from_story"], e["mechanism"]) for e in b["effects"]}
        assert got == want
        confs = [e["confidence"] for e in b["effects"]]
        assert confs == sorted(confs, reverse=True)
    # A forecast without conditional links has no branches.
    lone = scalar(
        sdb,
        """select node_id from forecast f where not exists
           (select 1 from causal_link cl where cl.forecast_id = f.node_id) order by node_id limit 1""",
    )
    assert call(sdb, "forecast", {"id": lone})["branches"] == []


def test_forecast_hides_skipped_and_sample_neighbours_for_live(sdb: psycopg.Connection) -> None:
    add_story(sdb, "story:test-live-a", mentions=("region:in",))
    add_story(sdb, "story:test-live-skipped", mentions=("region:in",), status="skipped", so_what=None)
    add_story(sdb, "story:test-live-proj", kind="projected", impact="opportunity")
    add_story(sdb, "story:test-live-proj-no", kind="projected")
    add_forecast(
        sdb, "forecast:test-live", about=("region:in", "org:does-not-matter") if False else ("region:in",)
    )
    add_link(
        sdb,
        "story:test-live-a",
        "story:test-live-proj",
        "conditional",
        forecast="forecast:test-live",
        outcome="YES",
    )
    add_link(
        sdb,
        "story:test-live-a",
        "story:test-live-proj-no",
        "conditional",
        forecast="forecast:test-live",
        outcome="NO",
    )
    data = check("forecast", call(sdb, "forecast", {"id": "forecast:test-live"}))
    stories = ids(data["forecast"]["stories"])
    assert "story:test-live-a" in stories
    assert "story:test-live-skipped" not in stories
    assert not any(s["is_sample"] for s in data["forecast"]["stories"])  # live forecast, live data exists
    assert [(b["outcome"], ids(b["effects"])) for b in data["branches"]] == [
        ("YES", ["story:test-live-proj"]),
        ("NO", ["story:test-live-proj-no"]),
    ]
    assert data["branches"][0]["probability"] == 0.55
    assert data["branches"][1]["probability"] == 0.45


# ---------------------------------------------------------------------------
# api.affects
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "args",
    [
        {"profile": PROFILE},
        {"profile": PROFILE, "window": "24h"},
        {"profile": PROFILE, "window": "30d"},
        {"profile": PROFILE, "sample": False},
        {"profile": profile(keywords=["rice", "monsoon"])},
        {"profile": profile(sectors=["energy"])},
        {"profile": profile(markets=["region:eu"], competitors=["org:kestrel-lines"])},
        {"profile": EMPTY_PROFILE},
        {"profile": profile(inputs=["commodity:unknown-thing"])},
        {},
    ],
)
def test_affects_contract(sdb: psycopg.Connection, args: dict[str, Any]) -> None:
    data = check("affects", call(sdb, "affects", args))
    assert len(data["items"]) <= 30
    assert len(data["suggested_forecasts"]) <= 6


def test_affects_empty_profile(sdb: psycopg.Connection) -> None:
    empty = {"items": [], "suggested_forecasts": []}
    assert call(sdb, "affects", {"profile": EMPTY_PROFILE}) == empty
    assert call(sdb, "affects", {}) == empty
    assert call(sdb, "affects", {"profile": profile(inputs=["commodity:unknown-thing"])}) == empty
    assert call(sdb, "affects", {"profile": PROFILE, "sample": False})["items"] == []


def test_affects_ordering_paths_and_windows(sdb: psycopg.Connection) -> None:
    data = call(sdb, "affects", {"profile": PROFILE})
    items = data["items"]
    assert len(items) == 30
    rel = [i["relevance"] for i in items]
    assert rel == sorted(rel, reverse=True)
    assert len(set(story_ids(items))) == len(items)
    profile_nodes = {
        "sector:manufacturing",
        "sector:logistics-trade",
        "region:in-gj",
        "commodity:crude-oil",
        "region:cn",
        "region:eu",
    }
    since = datetime.now(tz=ts(items[0]["story"]["first_seen"] or "2000-01-01T00:00:00+00:00").tzinfo)
    for item in items:
        assert item["path"][-1] == item["story"]["id"]
        assert {m["id"] for m in item["matched"]} <= profile_nodes
        assert 0 <= item["relevance"] <= 1
        origin = query(sdb, "select kind, first_seen from story where node_id = %s", item["path"][0])[0]
        assert origin["kind"] == "event"
        assert origin["first_seen"] >= since - timedelta(days=7, minutes=5)
        for src, dst in zip(item["path"], item["path"][1:], strict=False):
            assert scalar(
                sdb, "select count(*) from causal_link where src_story = %s and dst_story = %s", src, dst
            )
        actions = scalar(sdb, "select actions from story where node_id = %s", item["story"]["id"])
        assert item["actions"] == actions
    day = call(sdb, "affects", {"profile": PROFILE, "window": "24h"})["items"]
    for item in day:
        first = scalar(sdb, "select first_seen from story where node_id = %s", item["path"][0])
        assert first >= since - timedelta(hours=24, minutes=5)


def test_affects_relevance_and_downstream(sdb: psycopg.Connection) -> None:
    rice = profile(inputs=["commodity:rice"], locations=["region:in-gj"], keywords=["berth"])
    add_story(
        sdb,
        "story:test-rice",
        mentions=("commodity:rice",),
        importance=60,
        confidence=0.8,
        country="region:th",
        admin1=None,
        region="region:th",
        actions=("Check rice contracts",),
    )
    add_story(
        sdb,
        "story:test-effect",
        importance=40,
        confidence=0.7,
        country="region:ph",
        admin1=None,
        region="region:ph",
        hours_ago=1,
    )
    add_story(
        sdb,
        "story:test-proj",
        kind="projected",
        importance=30,
        country="region:ph",
        admin1=None,
        region="region:ph",
    )
    add_link(sdb, "story:test-rice", "story:test-effect", confidence=0.6)
    add_link(sdb, "story:test-effect", "story:test-proj", "projected", confidence=0.5)
    add_story(sdb, "story:test-gujarat", importance=50, confidence=None)  # located in the profile state
    add_story(
        sdb, "story:test-kerala", importance=50, confidence=None, admin1="region:in-kl", region="region:in-kl"
    )  # same country, another state
    add_story(sdb, "story:test-national", importance=50, confidence=None, admin1=None, region="region:in")
    add_story(
        sdb,
        "story:test-keyword",
        headline="A new berth opens",
        importance=50,
        confidence=0.6,
        country="region:br",
        admin1=None,
        region="region:br",
    )
    add_story(
        sdb,
        "story:test-skipped",
        mentions=("commodity:rice",),
        status="skipped",
        so_what=None,
        country="region:th",
        admin1=None,
        region="region:th",
    )
    add_story(
        sdb,
        "story:test-pending",
        mentions=("commodity:rice",),
        status="pending",
        so_what=None,
        confidence=None,
        importance=20,
        country="region:th",
        admin1=None,
        region="region:th",
    )
    add_story(
        sdb,
        "story:test-old",
        mentions=("commodity:rice",),
        hours_ago=24 * 9,
        country="region:th",
        admin1=None,
        region="region:th",
    )
    data = check("affects", call(sdb, "affects", {"profile": rice, "sample": False}))
    by_id = {i["story"]["id"]: i for i in data["items"]}

    assert by_id["story:test-rice"]["relevance"] == pytest.approx(round(1.0 * 0.9 * 0.8, 3))
    assert by_id["story:test-rice"]["path"] == ["story:test-rice"]
    assert by_id["story:test-rice"]["actions"] == ["Check rice contracts"]
    assert [m["id"] for m in by_id["story:test-rice"]["matched"]] == ["commodity:rice"]
    effect = by_id["story:test-effect"]
    assert effect["path"] == ["story:test-rice", "story:test-effect"]
    assert effect["relevance"] == pytest.approx(
        round(1.0 * (0.5 + 0.5 * 0.8 * 0.6) * 0.85 * 0.7, 3), abs=0.001
    )
    proj = by_id["story:test-proj"]
    assert proj["path"] == ["story:test-rice", "story:test-effect", "story:test-proj"]
    assert proj["relevance"] == pytest.approx(
        round(1.0 * (0.5 + 0.5 * 0.8 * 0.6 * 0.5) * 0.85**2 * 0.65, 3), abs=0.001
    )
    assert by_id["story:test-gujarat"]["relevance"] == pytest.approx(round(0.9 * 0.75 * 0.75, 3))
    assert by_id["story:test-national"]["relevance"] == pytest.approx(round(0.9 * 0.75 * 0.75, 3))
    assert by_id["story:test-kerala"]["relevance"] == pytest.approx(round(0.9 * 0.75 * 0.75 * 0.75, 3))
    assert [m["id"] for m in by_id["story:test-kerala"]["matched"]] == ["region:in-gj"]
    assert by_id["story:test-keyword"]["relevance"] == pytest.approx(round(0.5 * 0.8 * 0.75, 3))
    assert by_id["story:test-keyword"]["matched"] == []
    assert by_id["story:test-pending"]["story"]["analysed"] is False
    assert "story:test-skipped" not in by_id
    assert "story:test-old" not in by_id
    assert "story:test-old" in story_ids(
        call(sdb, "affects", {"profile": rice, "sample": False, "window": "30d"})["items"]
    )


def test_affects_suggested_forecasts(sdb: psycopg.Connection) -> None:
    data = call(sdb, "affects", {"profile": PROFILE})
    fcs = data["suggested_forecasts"]
    assert len(fcs) == 6
    moves = [abs(f["change_24h"]) for f in fcs]
    assert moves == sorted(moves, reverse=True)
    targets = {
        "sector:manufacturing",
        "sector:logistics-trade",
        "region:in-gj",
        "region:in",
        "commodity:crude-oil",
        "region:cn",
        "region:eu",
    }
    for f in fcs:
        about = {
            r["dst"] for r in query(sdb, "select dst from edge where src = %s and type = 'about'", f["id"])
        }
        assert about & targets, f["id"]


@pytest.mark.parametrize("viewer", HIDDEN_VIEWERS)
def test_affects_real_money_hidden(sdb: psycopg.Connection, viewer: dict[str, Any]) -> None:
    add_real_money(sdb, about=("region:in",), probabilities=(0.1, 0.9))
    data = call(sdb, "affects", {"profile": PROFILE, "sample": True, **viewer})
    assert REAL_MONEY not in forecast_ids({"forecasts": data["suggested_forecasts"]})
    shown = call(sdb, "affects", {"profile": PROFILE, "sample": True, **US})
    assert forecast_ids({"forecasts": shown["suggested_forecasts"]})[0] == REAL_MONEY


def test_affects_conditional_links_follow_visible_forecasts_only(sdb: psycopg.Connection) -> None:
    rice = profile(inputs=["commodity:rice"])
    add_story(sdb, "story:test-rice", mentions=("commodity:rice",))
    add_story(sdb, "story:test-if-yes", kind="projected")
    add_real_money(sdb)
    add_link(sdb, "story:test-rice", "story:test-if-yes", "conditional", forecast=REAL_MONEY, outcome="YES")
    for viewer in HIDDEN_VIEWERS:
        items = call(sdb, "affects", {"profile": rice, "sample": False, **viewer})["items"]
        assert story_ids(items) == ["story:test-rice"]
    items = call(sdb, "affects", {"profile": rice, "sample": False, **US})["items"]
    assert story_ids(items) == ["story:test-rice", "story:test-if-yes"]


# ---------------------------------------------------------------------------
# api.opportunities
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "args",
    [
        {},
        {"window": "24h"},
        {"window": "7d"},
        {"sample": False},
        {"sectors": ["energy"]},
        {"regions": ["region:in"]},
        {"regions": ["region:eu"], "sectors": ["manufacturing", "energy"]},
        {"profile": PROFILE},
        {"profile": EMPTY_PROFILE},
    ],
)
def test_opportunities_contract(sdb: psycopg.Connection, args: dict[str, Any]) -> None:
    data = check("opportunities", call(sdb, "opportunities", args))
    assert len(data["items"]) <= 40
    assert len(set(story_ids(data["items"]))) == len(data["items"])


def test_opportunities_semantics(sdb: psycopg.Connection) -> None:
    items = call(sdb, "opportunities", {})["items"]
    assert len(items) == 40
    ranks = [0.6 * i["relevance"] + 0.4 * i["momentum"] for i in items]
    for a, b in zip(ranks, ranks[1:], strict=False):
        assert a >= b - 1e-9
    now = scalar(sdb, "select now()")
    sector_names = {
        r["id"].removeprefix("sector:"): r["name"]
        for r in query(sdb, "select id, name from node where type = 'sector'")
    }
    kinds = set()
    for item in items:
        story = item["story"]
        kinds.add(story["kind"])
        assert story["impact"] == "opportunity"
        row = query(
            sdb,
            "select so_what, importance, source_count, first_seen from story where node_id = %s",
            story["id"],
        )[0]
        assert item["why_now"] == row["so_what"]
        assert item["relevance"] == pytest.approx(round(row["importance"] / 100, 3), abs=0.001)
        assert 1 <= len(item["suits"]) <= 3
        names = [sector_names[s] for s in story["sectors"]]
        assert item["suits"][: min(3, len(names))] == names[:3]
        if story["kind"] == "event":
            assert row["first_seen"] >= now - timedelta(days=30)
            age = (now - row["first_seen"]).total_seconds() / 3600
            want = 0.6 * math.exp(-age / 72) + 0.4 * min(1, row["source_count"] / 20)
            assert item["momentum"] == pytest.approx(want, abs=0.002)
        else:
            sources = query(
                sdb,
                """select s.first_seen, s.source_count
                   from causal_link cl join story s on s.node_id = cl.src_story
                   where cl.dst_story = %s and s.kind = 'event'
                     and s.first_seen >= now() - interval '30 days'""",
                story["id"],
            )
            assert sources
            want = max(
                0.6 * math.exp(-(now - s["first_seen"]).total_seconds() / 3600 / 72)
                + 0.4 * min(1, s["source_count"] * 0.5 / 20)
                for s in sources
            )
            assert item["momentum"] == pytest.approx(want, abs=0.002)
        if item["forecast"] is not None:
            assert item["forecast"]["is_sample"] is True
    assert kinds == {"event", "projected"}


def test_opportunities_filters_and_window(sdb: psycopg.Connection) -> None:
    energy = call(sdb, "opportunities", {"sectors": ["energy"]})["items"]
    assert energy and all("energy" in i["story"]["sectors"] for i in energy)
    india = call(sdb, "opportunities", {"regions": ["region:in"]})["items"]
    assert india
    for item in india:
        row = query(sdb, "select country_id from story where node_id = %s", item["story"]["id"])[0]
        mentions = scalar(
            sdb,
            "select count(*) from edge where src = %s and type = 'mentions' and dst = 'region:in'",
            item["story"]["id"],
        )
        assert row["country_id"] == "region:in" or mentions
    day = call(sdb, "opportunities", {"window": "24h"})["items"]
    events = [i for i in day if i["story"]["kind"] == "event"]
    assert events and all(
        ts(i["story"]["first_seen"]) >= scalar(sdb, "select now() - interval '24 hours 5 minutes'")
        for i in events
    )
    assert len(day) < len(call(sdb, "opportunities", {"window": "30d"})["items"]) or len(day) < 40


def test_opportunities_profile_relevance(sdb: psycopg.Connection) -> None:
    rice = profile(inputs=["commodity:rice"])
    add_story(
        sdb,
        "story:test-rice-opp",
        impact="opportunity",
        mentions=("commodity:rice",),
        importance=40,
        confidence=0.9,
        sectors=("agri-food",),
    )
    add_story(sdb, "story:test-other-opp", impact="opportunity", importance=90, confidence=0.9)
    add_story(sdb, "story:test-risk", impact="risk", mentions=("commodity:rice",))
    add_story(sdb, "story:test-skipped-opp", impact="opportunity", status="skipped", so_what=None)
    add_story(sdb, "story:test-pending-opp", impact="opportunity", status="pending", so_what=None)
    add_article(
        sdb, "story:test-pending-opp", "https://example.org/p1", snippet="Exporters see a new opening."
    )
    data = check("opportunities", call(sdb, "opportunities", {"profile": rice, "sample": False}))
    by_id = {i["story"]["id"]: i for i in data["items"]}
    assert set(by_id) == {"story:test-rice-opp", "story:test-other-opp", "story:test-pending-opp"}
    assert story_ids(data["items"])[0] == "story:test-rice-opp"
    assert by_id["story:test-rice-opp"]["relevance"] == pytest.approx(round(1.0 * 0.95 * 0.7, 3))
    assert by_id["story:test-other-opp"]["relevance"] == 0
    assert by_id["story:test-pending-opp"]["why_now"] == "Exporters see a new opening."
    assert by_id["story:test-rice-opp"]["suits"] == ["Agri and Food", "Rice"]
    plain = call(sdb, "opportunities", {"sample": False})["items"]
    assert story_ids(plain)[0] == "story:test-other-opp"
    assert {i["story"]["id"]: i["relevance"] for i in plain}["story:test-other-opp"] == 0.9


def test_opportunities_forecast_visibility(sdb: psycopg.Connection) -> None:
    add_story(sdb, "story:test-opp", impact="opportunity")
    add_real_money(sdb, relates_to=("story:test-opp",))
    for viewer in HIDDEN_VIEWERS:
        items = call(sdb, "opportunities", {"sample": False, **viewer})["items"]
        assert items[0]["forecast"] is None
    items = call(sdb, "opportunities", {"sample": False, **US})["items"]
    assert items[0]["forecast"]["id"] == REAL_MONEY
    # A relates_to forecast beats one that is only about the story's country.
    add_forecast(sdb, "forecast:test-country", about=("region:in",), volume=900000)
    assert call(sdb, "opportunities", {"sample": False, **US})["items"][0]["forecast"]["id"] == REAL_MONEY
    assert (
        call(sdb, "opportunities", {"sample": False, **IN})["items"][0]["forecast"]["id"]
        == "forecast:test-country"
    )


# ---------------------------------------------------------------------------
# api.ask_context
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "args",
    [
        {"q": "How will the Red Sea attacks affect Indian exporters and freight rates?"},
        {"q": "crude oil prices india", "limit": 5},
        {"q": "rice exports Thailand Vietnam", "limit": 100},
        {"q": "rice", "sample": False},
        {"q": ""},
        {"q": "what is the and"},
        {},
        {"q": "'; drop table node; -- %_ \\ ' or 1=1"},
        {"q": "ünïcödé café São Paulo"},
    ],
)
def test_ask_context_contract(sdb: psycopg.Connection, args: dict[str, Any]) -> None:
    data = check("ask_context", call(sdb, "ask_context", args))
    assert len(data["entities"]) <= 8
    assert len(data["stories"]) <= 25
    assert len(data["links"]) <= 20
    assert len(data["forecasts"]) <= 6
    assert scalar(sdb, "select count(*) from node") > 0


def test_ask_context_empty_question(sdb: psycopg.Connection) -> None:
    empty = {"entities": [], "stories": [], "links": [], "forecasts": []}
    assert call(sdb, "ask_context", {"q": ""}) == empty
    assert call(sdb, "ask_context", {"q": "What is it and how"}) == empty
    assert call(sdb, "ask_context", {"q": "a an of to"}) == empty


def test_ask_context_retrieval(sdb: psycopg.Connection) -> None:
    data = call(sdb, "ask_context", {"q": "What is happening with rice exports from Thailand and Vietnam?"})
    ents = ids(data["entities"])
    assert {"commodity:rice", "region:th", "region:vn"} <= set(ents)
    stories = data["stories"]
    assert len(stories) == 12
    top = stories[0]["id"]
    assert top in {"story:thai-exporters-raise-rice-offers", "story:mekong-exporters-win-manila-orders"}
    returned = set(ids(stories))
    for s in stories:
        assert len(s["sources"]) <= 3
        assert s["actions"] == scalar(sdb, "select actions from story where node_id = %s", s["id"])
    for link in data["links"]:
        assert link["src"] in returned or link["dst"] in returned
    inner = [lk["src"] in returned and lk["dst"] in returned for lk in data["links"]]
    assert inner == sorted(inner, reverse=True)
    titles = " ".join((f["short_title"] + " " + f["question"]).lower() for f in data["forecasts"])
    assert "rice" in titles or "vietnam" in titles


def test_ask_context_entities_prefer_close_matches(sdb: psycopg.Connection) -> None:
    ents = ids(
        call(sdb, "ask_context", {"q": "How will the Red Sea attacks affect Indian exporters?"})["entities"]
    )
    assert "region:in" in ents
    assert "region:us-in" not in ents  # Indiana: "indian" matches India better
    assert not any(e.startswith("region:gb-r") for e in ents)  # no Redbridge for "red"
    crude = ids(call(sdb, "ask_context", {"q": "crude oil prices"})["entities"])
    assert crude[0] == "commodity:crude-oil"


def test_ask_context_limit_and_live_rules(sdb: psycopg.Connection) -> None:
    assert len(call(sdb, "ask_context", {"q": "india exports prices", "limit": 3})["stories"]) == 3
    assert (
        len(call(sdb, "ask_context", {"q": "india exports prices rates oil", "limit": 500})["stories"]) == 25
    )
    assert len(call(sdb, "ask_context", {"q": "india exports prices", "limit": "x"})["stories"]) == 12
    add_story(sdb, "story:test-zeppelin", headline="Zeppelin freight trial starts", sources=2)
    add_article(sdb, "story:test-zeppelin", "https://example.org/z1", title="Zeppelin freight trial")
    add_story(
        sdb,
        "story:test-zeppelin-skip",
        headline="Zeppelin festival draws crowds",
        status="skipped",
        so_what=None,
    )
    data = check("ask_context", call(sdb, "ask_context", {"q": "zeppelin"}))
    assert ids(data["stories"]) == ["story:test-zeppelin"]
    assert data["stories"][0]["sources"][0]["url"] == "https://example.org/z1"
    assert call(sdb, "ask_context", {"q": "red sea attacks", "sample": False})["stories"] == []


@pytest.mark.parametrize("viewer", HIDDEN_VIEWERS)
def test_ask_context_real_money_hidden(sdb: psycopg.Connection, viewer: dict[str, Any]) -> None:
    add_real_money(sdb, about=("commodity:rice",))
    data = call(sdb, "ask_context", {"q": "rice prices", **viewer})
    assert REAL_MONEY not in forecast_ids(data)
    assert REAL_MONEY in forecast_ids(call(sdb, "ask_context", {"q": "rice prices", **US}))


# ---------------------------------------------------------------------------
# api.pending_analysis
# ---------------------------------------------------------------------------


def test_pending_analysis_empty_on_seed(sdb: psycopg.Connection) -> None:
    data = check("pending_analysis", call(sdb, "pending_analysis", {}))
    assert data == {"items": [], "total_pending": 0}


def add_pending(conn: psycopg.Connection, sid: str, importance: float, **kw: Any) -> None:
    kw.setdefault("headline", "A long source title about a new container berth at a port in Gujarat, India")
    add_story(conn, sid, status="pending", so_what=None, confidence=None, importance=importance, **kw)


def test_pending_analysis_items(sdb: psycopg.Connection) -> None:
    sid = "story:test-pending"
    add_pending(
        sdb,
        sid,
        70,
        mentions=("region:in-gj", "region:in", "infra:mundra-port", "sector:logistics-trade"),
        sectors=("logistics-trade", "not-a-sector"),
    )
    for i in range(10):
        add_article(
            sdb,
            sid,
            f"https://example.org/a{i}",
            title=f"Title {i % 9}",
            source=f"Outlet {i % 3}",
            snippet=None if i % 2 else f"Snippet {i}.",
            hours_ago=i,
        )
    # Candidates: earlier done live events.
    add_story(
        sdb,
        "story:test-c-entity",
        mentions=("infra:mundra-port",),
        hours_ago=30,
        importance=10,
        country="region:br",
        admin1=None,
        region="region:br",
        sectors=("energy",),
    )
    add_story(
        sdb,
        "story:test-c-country",
        hours_ago=40,
        importance=90,
        sectors=("energy",),
        admin1=None,
        region="region:in",
    )
    add_story(
        sdb,
        "story:test-c-sector",
        hours_ago=50,
        importance=95,
        country="region:br",
        admin1=None,
        region="region:br",
    )
    add_story(sdb, "story:test-c-later", mentions=("infra:mundra-port",), hours_ago=1)  # after the story
    add_story(sdb, "story:test-c-old", mentions=("infra:mundra-port",), hours_ago=24 * 40)  # too early
    add_story(
        sdb,
        "story:test-c-pending",
        mentions=("infra:mundra-port",),
        hours_ago=30,
        status="pending",
        so_what=None,
    )
    add_story(sdb, "story:test-c-sample", mentions=("infra:mundra-port",), hours_ago=30, sample=True)
    sdb.execute("update story set first_seen = now() - interval '3 hours' where node_id = %s", (sid,))

    data = check("pending_analysis", call(sdb, "pending_analysis", {}))
    assert data["total_pending"] == 2
    item = data["items"][0]
    assert item["id"] == sid
    assert len(item["titles"]) == 8 and len(set(item["titles"])) == 8
    assert item["snippets"] == ["Snippet 0.", "Snippet 2.", "Snippet 4.", "Snippet 6.", "Snippet 8."]
    assert sorted(item["sources"]) == ["Outlet 0", "Outlet 1", "Outlet 2"]
    assert item["region"]["id"] == "region:in-gj"
    assert item["sectors"] == ["logistics-trade"]
    assert {e["id"] for e in item["entities"]} == {"region:in-gj", "region:in", "infra:mundra-port"}
    assert ids(item["candidates"]) == ["story:test-c-entity", "story:test-c-country", "story:test-c-sector"]
    # The pending candidate itself is listed second (lower importance).
    assert ids(data["items"]) == [sid, "story:test-c-pending"]


def test_pending_analysis_limits(sdb: psycopg.Connection) -> None:
    for i in range(35):
        add_pending(sdb, f"story:test-p{i:02d}", importance=i)
    default = call(sdb, "pending_analysis", {})
    assert default["total_pending"] == 35
    assert ids(default["items"]) == [f"story:test-p{i:02d}" for i in range(34, 22, -1)]
    assert len(call(sdb, "pending_analysis", {"limit": 500})["items"]) == 30
    assert len(call(sdb, "pending_analysis", {"limit": 0})["items"]) == 1
    assert len(call(sdb, "pending_analysis", {"limit": "abc"})["items"]) == 12
    data, ms = timed(sdb, "pending_analysis", {"limit": 30})
    check("pending_analysis", data)
    assert ms < 500


# ---------------------------------------------------------------------------
# api.save_analysis
# ---------------------------------------------------------------------------


def test_save_analysis_saves_everything(sdb: psycopg.Connection) -> None:
    sid = "story:test-pending"
    add_pending(sdb, sid, 70, hours_ago=3)
    add_article(sdb, sid, "https://example.org/old", hours_ago=2.5)
    add_article(sdb, sid, "https://example.org/new", hours_ago=0.5)
    add_story(sdb, "story:test-cause", hours_ago=50)
    item = valid_item(sid, links=[valid_link("story:test-cause")])
    result = save(sdb, [item])
    assert result == {"saved": 1, "skipped": 0, "rejected": [], "links_saved": 1}

    row = query(sdb, "select * from story where node_id = %s", sid)[0]
    assert row["headline"] == item["headline"]
    assert row["so_what"] == item["so_what"]
    assert row["impact"] == "opportunity" and row["direction"] == "up" and row["magnitude"] == 3
    assert row["horizon"] == "months" and row["confidence"] == pytest.approx(0.8)
    assert row["sectors"] == ["logistics-trade"] and row["actions"] == item["actions"]
    assert row["analysis_status"] == "done"
    assert row["analysis_engine"] == "artifact" and row["analysis_model"] == "test-model"
    assert row["analysed_at"] is not None
    assert scalar(sdb, "select name from node where id = %s", sid) == item["headline"]
    mentions = {
        r["dst"] for r in query(sdb, "select dst from edge where src = %s and type = 'mentions'", sid)
    }
    assert {"region:in-gj", "commodity:crude-oil", "sector:logistics-trade"} <= mentions
    assert "org:does-not-exist" not in mentions

    link = query(sdb, "select * from causal_link where dst_story = %s", sid)[0]
    assert link["src_story"] == "story:test-cause"
    assert link["method"] == "llm" and link["model_version"] == "test-model"
    assert link["mechanism"] == "frees up capacity" and link["link_type"] == "inferred"
    assert link["lag_days"] == 1 and link["is_sample"] is False
    ev = query(sdb, "select * from evidence where causal_link_id = %s", link["id"])
    assert len(ev) == 1
    assert ev[0]["source_name"] == "AI analysis (artifact)"
    assert ev[0]["url"] == "https://example.org/new"
    assert ev[0]["snippet"] == valid_link("x")["evidence"]
    assert ev[0]["is_sample"] is False

    # Saved stories leave the queue; the card now says analysed.
    assert call(sdb, "pending_analysis", {})["total_pending"] == 0
    assert call(sdb, "story", {"id": sid})["story"]["analysed"] is True
    # Saving the same link again adds nothing.
    again = save(sdb, [item])
    assert again["saved"] == 1 and again["links_saved"] == 0


@pytest.mark.parametrize(
    ("changes", "reason"),
    [
        ({"headline": "one two three four five six seven eight nine ten eleven twelve thirteen"}, "headline"),
        ({"headline": "   "}, "headline"),
        ({"headline": 12}, "headline"),
        ({"so_what": " ".join(["word"] * 21)}, "so_what"),
        ({"so_what": None}, "so_what"),
        ({"event_type": "x"}, "event_type"),
        ({"impact": "bad"}, "impact"),
        ({"direction": "sideways"}, "direction"),
        ({"magnitude": 6}, "magnitude"),
        ({"magnitude": 2.5}, "magnitude"),
        ({"magnitude": "3"}, "magnitude"),
        ({"horizon": "years"}, "horizon"),
        ({"confidence": 1.5}, "confidence"),
        ({"sectors": []}, "sectors"),
        ({"sectors": ["energy", "tech", "health", "consumer"]}, "sectors"),
        ({"sectors": ["space"]}, "sectors"),
        ({"sectors": ["energy", "energy"]}, "sectors"),
        ({"actions": ["a", "b", "c", "d"]}, "actions"),
        ({"actions": ["one two three four five six seven eight nine"]}, "action"),
        ({"actions": [""]}, "action"),
        ({"entities": "region:in"}, "entities"),
        ({"links": [valid_link("story:test-cause")] * 5}, "links"),
        ({"links": [valid_link("story:test-cause", mechanism="raises")]}, "link"),
        ({"links": [valid_link("story:test-cause", link_type="projected")]}, "link"),
        ({"links": [valid_link("story:test-cause", evidence="x" * 301)]}, "link"),
        ({"links": [valid_link("story:test-cause", confidence=2)]}, "link"),
        ({"links": [{"from": "story:test-cause"}]}, "link"),
        ({"id": "story:test-unknown"}, "unknown story"),
        ({"id": "story:x'; drop table node; --"}, "id"),
    ],
)
def test_save_analysis_rejects_invalid_items(
    sdb: psycopg.Connection, changes: dict[str, Any], reason: str
) -> None:
    add_pending(sdb, "story:test-bad", 50)
    add_pending(sdb, "story:test-good", 40)
    add_story(sdb, "story:test-cause", hours_ago=50)
    bad = valid_item("story:test-bad", **changes)
    result = save(sdb, [bad, valid_item("story:test-good")])
    assert result["saved"] == 1
    assert len(result["rejected"]) == 1
    assert result["rejected"][0]["id"] == bad["id"]
    assert reason in result["rejected"][0]["reason"]
    assert scalar(sdb, "select analysis_status from story where node_id = 'story:test-bad'") == "pending"
    assert scalar(sdb, "select analysis_status from story where node_id = 'story:test-good'") == "done"
    assert scalar(sdb, "select count(*) from node") > 1000


def test_save_analysis_link_rules(sdb: psycopg.Connection) -> None:
    sid = "story:test-dst"
    add_pending(sdb, sid, 50)  # no articles: no URL for evidence
    add_story(sdb, "story:test-cause-a", hours_ago=20)
    add_story(sdb, "story:test-cause-b", hours_ago=30)
    add_story(sdb, "story:test-proj", kind="projected")
    add_story(sdb, "story:test-sample-cause", hours_ago=30, sample=True)
    add_story(sdb, "story:test-reverse", hours_ago=30)
    add_link(sdb, sid, "story:test-reverse")
    links = [
        valid_link("story:test-cause-a"),
        valid_link("story:test-cause-b", evidence=""),
        valid_link("story:test-proj"),  # not an event
        valid_link(sid),  # itself
    ]
    result = save(sdb, [valid_item(sid, links=links)])
    assert result["saved"] == 1 and result["links_saved"] == 2
    more = [
        valid_link("story:does-not-exist"),
        valid_link("story:test-sample-cause"),
        valid_link("story:test-reverse"),
    ]
    assert save(sdb, [valid_item(sid, links=more)])["links_saved"] == 0
    rows = query(sdb, "select src_story, id from causal_link where dst_story = %s order by src_story", sid)
    assert [r["src_story"] for r in rows] == ["story:test-cause-a", "story:test-cause-b"]
    # Live story without an article URL: no evidence row (it would need a URL).
    assert (
        scalar(sdb, "select count(*) from evidence where causal_link_id = any(%s)", [r["id"] for r in rows])
        == 0
    )


def test_save_analysis_sample_story_evidence(sdb: psycopg.Connection) -> None:
    sid = "story:red-sea-attacks-reroute"
    # A later sample event that has no link with it either way: still a valid cause by id.
    cause = scalar(
        sdb,
        """select s.node_id from story s join story r on r.node_id = %s
           where s.kind = 'event' and s.first_seen > r.first_seen
             and not exists (select 1 from causal_link cl
                             where (cl.src_story, cl.dst_story)
                                   in ((s.node_id, r.node_id), (r.node_id, s.node_id)))
           order by s.node_id limit 1""",
        sid,
    )
    result = save(sdb, [valid_item(sid, links=[valid_link(cause)], entities=["org:kestrel-lines"])])
    assert result == {"saved": 1, "skipped": 0, "rejected": [], "links_saved": 1}
    link = query(sdb, "select * from causal_link where src_story = %s and dst_story = %s", cause, sid)[0]
    assert link["is_sample"] is True and link["lag_days"] is None  # the cause came later
    # The opposite direction of an existing link is refused (no loops).
    effect = scalar(
        sdb, "select dst_story from causal_link where src_story = %s order by dst_story limit 1", sid
    )
    assert save(sdb, [valid_item(sid, links=[valid_link(effect)])])["links_saved"] == 0
    ev = query(sdb, "select * from evidence where causal_link_id = %s", link["id"])[0]
    assert ev["url"] is None and ev["is_sample"] is True
    assert (
        scalar(
            sdb,
            "select count(*) from edge where src = %s and dst = 'org:kestrel-lines' and type = 'mentions'",
            sid,
        )
        == 1
    )


def test_save_analysis_live_story_ignores_sample_entities(sdb: psycopg.Connection) -> None:
    add_pending(sdb, "story:test-live", 50)
    save(sdb, [valid_item("story:test-live", entities=["org:kestrel-lines", "region:in"])])
    mentions = {
        r["dst"]
        for r in query(sdb, "select dst from edge where src = 'story:test-live' and type = 'mentions'")
    }
    assert "org:kestrel-lines" not in mentions and "region:in" in mentions


def test_save_analysis_skipped(sdb: psycopg.Connection) -> None:
    add_pending(sdb, "story:test-noise", 50, mentions=("commodity:rice",))
    add_article(sdb, "story:test-noise", "https://example.org/noise-1")
    add_article(sdb, "story:test-noise", "https://example.org/noise-2")
    add_pending(sdb, "story:test-keep", 40)
    add_story(sdb, "story:test-done")
    result = save(
        sdb,
        [],
        skipped=[
            {"id": "story:test-noise", "reason": "sports result"},
            {"id": "story:test-done", "reason": "already analysed"},
            {"id": "story:test-nope", "reason": "unknown"},
            "not-an-object",
        ],
    )
    assert result["saved"] == 0 and result["skipped"] == 1 and result["links_saved"] == 0
    assert [r["id"] for r in result["rejected"]] == ["story:test-done", "story:test-nope", ""]
    # The story_skipped trigger (0009) deletes the story and its articles and
    # remembers their URLs so the pipeline never ingests them again.
    assert scalar(sdb, "select count(*) from node where id = 'story:test-noise'") == 0
    assert scalar(sdb, "select count(*) from article where story_id = 'story:test-noise'") == 0
    assert (
        scalar(
            sdb,
            "select count(*) from skipped_url where url in ('https://example.org/noise-1', 'https://example.org/noise-2')",
        )
        == 2
    )
    assert scalar(sdb, "select analysis_status from story where node_id = 'story:test-done'") == "done"
    # Skipping it again is refused: it no longer exists.
    again = save(sdb, [], skipped=[{"id": "story:test-noise", "reason": "sports result"}])
    assert again["skipped"] == 0 and [r["id"] for r in again["rejected"]] == ["story:test-noise"]
    # Skipped stories vanish from the lists; the queue keeps the rest.
    pending = call(sdb, "pending_analysis", {})
    assert pending["total_pending"] == 1 and ids(pending["items"]) == ["story:test-keep"]
    rice = profile(inputs=["commodity:rice"])
    assert "story:test-noise" not in story_ids(
        call(sdb, "affects", {"profile": rice, "sample": False})["items"]
    )
    assert "story:test-noise" not in ids(call(sdb, "ask_context", {"q": "gujarat port berth"})["stories"])


def test_save_analysis_argument_errors(sdb: psycopg.Connection) -> None:
    base = {"engine": "artifact", "model": "m", "items": []}
    assert call(sdb, "save_analysis", base) == {"saved": 0, "skipped": 0, "rejected": [], "links_saved": 0}
    assert call(sdb, "save_analysis", {**base, "engine": "api"})["saved"] == 0
    for bad in (
        {**base, "engine": "sample"},
        {**base, "engine": None},
        {**base, "model": ""},
        {**base, "model": 3},
        {**base, "items": {"id": "x"}},
        {**base, "items": [{}] * 31},
        {**base, "skipped": [{"id": "x"}] * 31},
    ):
        with pytest.raises(psycopg.errors.RaiseException), sdb.transaction():
            call(sdb, "save_analysis", bad)


def test_save_analysis_is_the_only_volatile_function(sdb: psycopg.Connection) -> None:
    rows = query(
        sdb,
        """select p.proname, p.provolatile from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
           where ns.nspname = 'api' and p.proname in ('forecasts', 'forecast', 'affects', 'opportunities',
                                                      'ask_context', 'pending_analysis', 'save_analysis')""",
    )
    assert {r["proname"]: r["provolatile"] for r in rows} == {
        "forecasts": "s",
        "forecast": "s",
        "affects": "s",
        "opportunities": "s",
        "ask_context": "s",
        "pending_analysis": "s",
        "save_analysis": "v",
    }


def test_no_dynamic_sql_in_group_c_functions(sdb: psycopg.Connection) -> None:
    rows = query(
        sdb,
        """select p.proname, p.prosrc from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
           where ns.nspname = 'api' and (p.proname like '\\_c\\_%%' or p.proname in ('forecasts', 'forecast',
                 'affects', 'opportunities', 'ask_context', 'pending_analysis', 'save_analysis'))""",
    )
    assert len(rows) >= 20
    for row in rows:
        assert "execute" not in row["prosrc"].lower().replace("executed", ""), row["proname"]


# ---------------------------------------------------------------------------
# Timing: every function well under the budget on the seeded database
# ---------------------------------------------------------------------------


TIMED_CALLS: list[tuple[str, dict[str, Any]]] = [
    ("forecasts", {}),
    ("forecasts", {"profile": PROFILE, "regions": ["region:in"], "sectors": ["energy", "finance"]}),
    ("forecast", {"id": "forecast:suez-transits-recover"}),
    ("affects", {"profile": PROFILE, "window": "30d"}),
    ("opportunities", {}),
    ("opportunities", {"profile": PROFILE}),
    (
        "ask_context",
        {"q": "How will the Red Sea attacks affect Indian exporters and freight rates?", "limit": 25},
    ),
    ("pending_analysis", {}),
]


@pytest.mark.parametrize(
    ("name", "args"), TIMED_CALLS, ids=[f"{n}-{i}" for i, (n, _) in enumerate(TIMED_CALLS)]
)
def test_timing(sdb: psycopg.Connection, name: str, args: dict[str, Any]) -> None:
    call(sdb, name, args)  # warm the caches
    data, ms = timed(sdb, name, args)
    check(name, data)
    assert ms < 500, f"api.{name} took {ms:.0f} ms"


def test_save_analysis_timing(sdb: psycopg.Connection) -> None:
    for i in range(30):
        add_pending(sdb, f"story:test-t{i:02d}", 50)
        add_article(sdb, f"story:test-t{i:02d}", f"https://example.org/t{i}")
    add_story(sdb, "story:test-cause", hours_ago=50)
    items = [valid_item(f"story:test-t{i:02d}", links=[valid_link("story:test-cause")]) for i in range(30)]
    start = time.perf_counter()
    result = save(sdb, items)
    ms = (time.perf_counter() - start) * 1000
    assert result["saved"] == 30 and result["links_saved"] == 30
    assert ms < 500, f"api.save_analysis took {ms:.0f} ms"


def test_arguments_are_data_not_sql(sdb: psycopg.Connection) -> None:
    nasty = "region:in'); drop table node; --"
    check(
        "forecasts", call(sdb, "forecasts", {"regions": [nasty], "categories": [nasty], "sectors": [nasty]})
    )
    check(
        "affects",
        call(sdb, "affects", {"profile": profile(locations=[nasty], keywords=["%", "_", "\\", nasty])}),
    )
    check(
        "opportunities",
        call(sdb, "opportunities", {"regions": [nasty], "profile": profile(keywords=[nasty])}),
    )
    assert_not_found(sdb, "forecast", {"id": nasty})
    assert scalar(sdb, "select count(*) from node") > 1000
    # A keyword of '%' matches only text with a literal percent sign.
    pct = call(sdb, "affects", {"profile": profile(keywords=["%"]), "window": "30d"})["items"]
    for item in pct:
        text = (item["story"]["headline"] + " " + (item["story"]["so_what"] or "")).lower()
        assert "%" in text or item["path"] != [item["story"]["id"]]
    assert json.dumps(pct)  # serialisable

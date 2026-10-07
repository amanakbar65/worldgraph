"""api.story, api.cascade, api.entity, api.graph, api.local_graph and api.search.

Tests run against the seeded test database (sample data, clock moved to now)
inside a transaction that is rolled back afterwards, so they may add rows.
"""

from __future__ import annotations

import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Any

import psycopg
import pytest

from tests.contract import call, check

FOCUS = "story:red-sea-attacks-reroute"
REAL_MONEY = "forecast:test-real-money"
REAL_MONEY_TITLE = "Will the test real-money question resolve yes?"
US: dict[str, Any] = {"_viewer": {"country": "US"}}
IN: dict[str, Any] = {"_viewer": {"country": "IN"}}
HIDDEN_VIEWERS: list[dict[str, Any]] = [{}, IN, {"_viewer": {"country": ""}}]
TYPE_RANK = {"region": 0, "organization": 1, "commodity": 2, "infrastructure": 3, "policy": 4}


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


def assert_not_found(conn: psycopg.Connection, name: str, args: dict[str, Any]) -> None:
    with pytest.raises(psycopg.errors.RaiseException) as info, conn.transaction():
        call(conn, name, args)
    assert info.value.diag.message_primary.startswith("Not found")


def add_story(
    conn: psycopg.Connection,
    sid: str,
    *,
    kind: str = "event",
    headline: str = "Test story about a port in Gujarat",
    impact: str = "risk",
    importance: float = 50.0,
    at: str = "region:in-gj",
    mentions: tuple[str, ...] = (),
    hours_ago: float = 2.0,
    sample: bool = False,
) -> None:
    """A live (or sample) story in Gujarat, India."""
    conn.execute(
        "insert into node (id, type, subtype, name, is_sample) values (%s, 'story', %s, %s, %s)",
        (sid, kind, headline, sample),
    )
    conn.execute(
        """insert into story (node_id, kind, headline, so_what, event_type, impact, importance, sectors,
                              primary_region, country_id, admin1_id, location, first_seen, last_seen)
           values (%(id)s, %(kind)s, %(headline)s, 'A short test so-what.', 'test', %(impact)s,
                   %(importance)s, '{logistics-trade}', 'region:in-gj', 'region:in', 'region:in-gj',
                   st_geogfromtext('SRID=4326;POINT(72.6 23.0)'),
                   case when %(kind)s = 'event' then now() - %(hours)s * interval '1 hour' end,
                   case when %(kind)s = 'event' then now() - %(hours)s * interval '1 hour' end)""",
        {
            "id": sid,
            "kind": kind,
            "headline": headline,
            "impact": impact,
            "importance": importance,
            "hours": hours_ago,
        },
    )
    for ref in sorted({at, *mentions}):
        conn.execute(
            "insert into edge (src, dst, type, is_sample) values (%s, %s, 'mentions', %s)", (sid, ref, sample)
        )


def add_link(
    conn: psycopg.Connection,
    src: str,
    dst: str,
    link_type: str,
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


def add_real_money_forecast(
    conn: psycopg.Connection,
    *,
    about: tuple[str, ...] = ("region:in",),
    relates_to: tuple[str, ...] = (FOCUS,),
) -> None:
    """A live Polymarket forecast with plenty of volume, provider switched on."""
    conn.execute("update forecast_provider set enabled = true where id = 'polymarket'")
    conn.execute(
        """insert into node (id, type, subtype, name, summary, geom)
           values (%s, 'forecast', 'binary', %s, %s, st_geogfromtext('SRID=4326;POINT(78.9 21.1)'))""",
        (REAL_MONEY, REAL_MONEY_TITLE, REAL_MONEY_TITLE),
    )
    conn.execute(
        """insert into forecast (node_id, provider, provider_ref, question, short_title, category, end_date,
                                 url, is_real_money, volume_unit)
           values (%s, 'polymarket', 'test-real-money', %s, %s, 'trade', now() + interval '60 days',
                   'https://polymarket.com/event/test', true, 'USD')""",
        (REAL_MONEY, REAL_MONEY_TITLE, REAL_MONEY_TITLE),
    )
    conn.execute(
        """insert into forecast_snapshot (forecast_id, ts, probability, volume, liquidity)
           values (%(id)s, now() - interval '3 days', 0.40, 400000, 60000),
                  (%(id)s, now() - interval '1 hour', 0.55, 500000, 80000)""",
        {"id": REAL_MONEY},
    )
    for ref in about:
        conn.execute("insert into edge (src, dst, type) values (%s, %s, 'about')", (REAL_MONEY, ref))
    for sid in relates_to:
        conn.execute("insert into edge (src, dst, type) values (%s, %s, 'relates_to')", (REAL_MONEY, sid))


def assert_graph_consistent(data: dict[str, Any]) -> set[str]:
    """Links join returned nodes, degree counts them, causal links carry confidence."""
    node_ids = {n["id"] for n in data["nodes"]}
    assert len(node_ids) == len(data["nodes"]), "duplicate nodes"
    degree: Counter[str] = Counter()
    for link in data["links"]:
        assert link["source"] in node_ids and link["target"] in node_ids
        assert (link["confidence"] is not None) == link["causal"]
        degree[link["source"]] += 1
        degree[link["target"]] += 1
    for node in data["nodes"]:
        assert node["degree"] == degree[node["id"]], node["id"]
        assert (node["impact"] is not None) == (node["type"] == "story")
    return node_ids


def sample_ids(conn: psycopg.Connection, node_ids: list[str]) -> set[str]:
    rows = query(conn, "select id from node where id = any(%s) and is_sample", node_ids)
    return {r["id"] for r in rows}


def reference_depths(conn: psycopg.Connection, focus: str, depth: int) -> dict[str, int]:
    """Breadth-first depths over all causal links (every sample forecast is visible)."""
    forward: dict[str, set[str]] = defaultdict(set)
    backward: dict[str, set[str]] = defaultdict(set)
    for row in query(conn, "select src_story, dst_story from causal_link"):
        forward[row["src_story"]].add(row["dst_story"])
        backward[row["dst_story"]].add(row["src_story"])
    best = {focus: 0}
    for sign, graph in ((-1, backward), (1, forward)):
        seen, frontier = {focus}, {focus}
        for d in range(1, depth + 1):
            nxt = {m for n in frontier for m in graph[n]} - seen
            seen |= nxt
            for n in nxt:
                if n not in best or d < abs(best[n]):
                    best[n] = sign * d
            frontier = nxt
    return best


def neighbours(conn: psycopg.Connection, node_ids: list[str]) -> dict[str, set[str]]:
    """Every node joined to one of `node_ids` by an edge or a causal link."""
    rows = conn.execute(
        """select src as a, dst as b from edge where src = any(%(ids)s) or dst = any(%(ids)s)
           union all
           select src_story, dst_story from causal_link
           where src_story = any(%(ids)s) or dst_story = any(%(ids)s)""",
        {"ids": node_ids},
    ).fetchall()
    out: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        out[row["a"]].add(row["b"])
        out[row["b"]].add(row["a"])
    return out


# ---------------------------------------------------------------------------
# api.story
# ---------------------------------------------------------------------------


def test_story_matches_contract(sdb):
    projected = scalar(sdb, "select node_id from story where kind = 'projected' order by node_id limit 1")
    for sid in (FOCUS, "story:odisha-aluminium-faces-carbon-bills", projected):
        data = check("story", call(sdb, "story", {"id": sid}))
        assert data["story"]["id"] == sid
    data = check("story", call(sdb, "story", {"id": projected}))
    assert data["story"]["first_seen"] is None
    assert data["story"]["sources"] == []


def test_story_details_come_from_the_story(sdb):
    data = call(sdb, "story", {"id": FOCUS})
    story = data["story"]
    row = query(sdb, "select actions, mention_count, last_seen from story where node_id = %s", FOCUS)[0]
    assert story["actions"] == row["actions"]
    assert story["mention_count"] == row["mention_count"]
    assert ts(story["last_seen"]) == row["last_seen"]
    articles = scalar(sdb, "select count(*) from article where story_id = %s", FOCUS)
    assert articles > 12
    assert len(story["sources"]) == 12
    published = [ts(s["published_at"]) for s in story["sources"]]
    assert published == sorted(published, reverse=True)
    newest = scalar(sdb, "select max(published_at) from article where story_id = %s", FOCUS)
    assert published[0] == newest


def test_story_entities_skip_sectors_and_follow_type_order(sdb):
    sid = "story:odisha-aluminium-faces-carbon-bills"
    entities = call(sdb, "story", {"id": sid})["story"]["entities"]
    mentioned = query(
        sdb,
        """select n.id from edge e join node n on n.id = e.dst
           where e.src = %s and e.type = 'mentions' and n.type <> 'sector'""",
        sid,
    )
    assert set(ids(entities)) == {r["id"] for r in mentioned}
    ranks = [TYPE_RANK.get(e["type"], 5) for e in entities]
    assert ranks == sorted(ranks)
    assert len({e["type"] for e in entities}) == 5


def test_story_entities_are_capped_at_16(sdb):
    add_story(sdb, "story:test-many-mentions")
    cities = query(
        sdb, "select node_id from region where level = 'city' and country_id = 'region:in' limit 20"
    )
    for row in cities:
        sdb.execute(
            "insert into edge (src, dst, type) values ('story:test-many-mentions', %s, 'mentions')",
            (row["node_id"],),
        )
    data = check("story", call(sdb, "story", {"id": "story:test-many-mentions"}))
    assert len(data["story"]["entities"]) == 16


def test_story_forecasts_put_related_ones_first(sdb):
    data = call(sdb, "story", {"id": "story:asia-europe-rates-jump"})
    assert data["forecasts"][0]["id"] == "forecast:suez-transits-recover"
    assert len(data["forecasts"]) <= 3


def test_story_forecasts_are_about_its_entities_or_country(sdb):
    sid = "story:delhi-peak-power-record"
    data = check("story", call(sdb, "story", {"id": sid}))
    assert len(data["forecasts"]) == 3
    targets = {
        r["dst"]
        for r in query(
            sdb,
            """select dst from edge where src = %s and type = 'mentions'
               union select country_id from story where node_id = %s""",
            sid,
            sid,
        )
    }
    for fc in data["forecasts"]:
        linked = query(
            sdb,
            """select 1 from edge where src = %s
               and ((type = 'about' and dst = any(%s)) or (type = 'relates_to' and dst = %s))""",
            fc["id"],
            list(targets),
            sid,
        )
        assert linked, fc["id"]


def test_story_counts_causes_and_effects(sdb):
    for sid in (FOCUS, "story:asia-europe-rates-jump", "story:suez-revenue-falls"):
        data = call(sdb, "story", {"id": sid})
        row = query(
            sdb,
            """select count(*) filter (where dst_story = %s) as causes,
                      count(*) filter (where src_story = %s) as effects
               from causal_link""",
            sid,
            sid,
        )[0]
        assert (data["causes"], data["effects"]) == (row["causes"], row["effects"])
    assert call(sdb, "story", {"id": FOCUS})["effects"] == 5


def test_story_sample_rule(sdb):
    add_story(sdb, "story:test-live", mentions=("region:in", "org:kestrel-lines"))
    add_link(sdb, "story:test-live", FOCUS, "inferred")
    off = check("story", call(sdb, "story", {"id": "story:test-live", "sample": False}))
    assert off["forecasts"] == []
    assert "org:kestrel-lines" not in ids(off["story"]["entities"])
    assert off["effects"] == 0
    # With a live story in the database, sample data is off by default.
    assert call(sdb, "story", {"id": "story:test-live"}) == off

    on = check("story", call(sdb, "story", {"id": "story:test-live", "sample": True}))
    assert len(on["forecasts"]) == 3
    assert "org:kestrel-lines" in ids(on["story"]["entities"])
    assert on["effects"] == 1

    # A sample story keeps its own sample context.
    sample_focus = check("story", call(sdb, "story", {"id": FOCUS, "sample": False}))
    assert sample_focus["forecasts"]
    assert sample_focus["causes"] == 1  # the live story above


def test_story_hides_real_money_forecasts(sdb):
    add_real_money_forecast(sdb)
    for viewer in HIDDEN_VIEWERS:
        data = check("story", call(sdb, "story", {"id": FOCUS, **viewer}))
        assert REAL_MONEY not in ids(data["forecasts"])
    data = check("story", call(sdb, "story", {"id": FOCUS, **US}))
    assert data["forecasts"][0]["id"] == REAL_MONEY
    assert data["forecasts"][0]["url"] == "https://polymarket.com/event/test"


def test_story_not_found(sdb):
    for args in ({"id": "story:does-not-exist"}, {"id": "region:in"}, {}):
        assert_not_found(sdb, "story", args)


# ---------------------------------------------------------------------------
# api.cascade
# ---------------------------------------------------------------------------


def test_cascade_matches_contract(sdb):
    for args in (
        {"id": FOCUS},
        {"id": FOCUS, "depth": 1},
        {"id": FOCUS, "depth": 3},
        {"id": "story:brent-multi-month-high", "depth": 3},
        {"id": "story:surcharges-persist"},
        {"id": FOCUS, "sample": False},
    ):
        data = check("cascade", call(sdb, "cascade", args))
        assert data["focus"] == args["id"]
        assert [n["id"] for n in data["nodes"] if n["depth"] == 0] == [args["id"]]
        depths = [n["depth"] for n in data["nodes"]]
        assert depths == sorted(depths)  # causes, focus, effects


@pytest.mark.parametrize("focus", [FOCUS, "story:brent-multi-month-high", "story:asia-europe-rates-jump"])
@pytest.mark.parametrize("depth", [1, 2, 3])
def test_cascade_depths_are_shortest_paths(sdb, focus, depth):
    data = call(sdb, "cascade", {"id": focus, "depth": depth})
    expected = reference_depths(sdb, focus, depth)
    assert len(expected) <= 60
    assert {n["id"]: n["depth"] for n in data["nodes"]} == expected


def test_cascade_depth_defaults_and_caps(sdb):
    def shape(args: dict[str, Any]) -> list[tuple[str, int]]:
        return [(n["id"], n["depth"]) for n in call(sdb, "cascade", args)["nodes"]]

    focus = "story:brent-multi-month-high"
    assert shape({"id": focus}) == shape({"id": focus, "depth": 2})
    assert shape({"id": focus, "depth": 9}) == shape({"id": focus, "depth": 3})
    assert shape({"id": focus, "depth": 0}) == shape({"id": focus, "depth": 1})
    assert shape({"id": focus, "depth": -4}) == shape({"id": focus, "depth": 1})
    assert shape({"id": focus, "depth": "lots"}) == shape({"id": focus, "depth": 2})
    assert shape({"id": focus, "depth": 3}) != shape({"id": focus, "depth": 1})


def test_cascade_links_are_every_link_between_returned_stories(sdb):
    data = call(sdb, "cascade", {"id": FOCUS, "depth": 3})
    node_ids = [n["id"] for n in data["nodes"]]
    expected = query(
        sdb,
        "select id from causal_link where src_story = any(%s) and dst_story = any(%s)",
        node_ids,
        node_ids,
    )
    assert sorted(link["id"] for link in data["links"]) == sorted(r["id"] for r in expected)
    for link in data["links"]:
        evidence = scalar(sdb, "select count(*) from evidence where causal_link_id = %s", link["id"])
        assert len(link["evidence"]) == evidence >= 1
        assert link["evidence"][0]["is_sample"] is True
        assert (link["forecast_id"] is not None) == (link["link_type"] == "conditional")


def test_cascade_branches_split_conditional_effects(sdb):
    data = check("cascade", call(sdb, "cascade", {"id": FOCUS}))
    conditional = {link["forecast_id"] for link in data["links"] if link["link_type"] == "conditional"}
    assert {b["forecast"]["id"] for b in data["branches"]} == conditional
    branch = next(b for b in data["branches"] if b["forecast"]["id"] == "forecast:suez-transits-recover")
    yes, no = branch["outcomes"]
    assert (yes["outcome"], no["outcome"]) == ("YES", "NO")
    assert yes["probability"] == branch["forecast"]["probability"]
    assert yes["probability"] + no["probability"] == pytest.approx(1)
    links = query(
        sdb,
        "select outcome, dst_story from causal_link where forecast_id = 'forecast:suez-transits-recover'",
    )
    assert yes["story_ids"] == [r["dst_story"] for r in links if r["outcome"] == "YES"]
    assert no["story_ids"] == [r["dst_story"] for r in links if r["outcome"] == "NO"]


def test_cascade_keeps_the_60_most_important_stories(sdb):
    add_story(sdb, "story:test-hub", importance=60)
    for i in range(70):
        sid = f"story:test-effect-{i:02d}"
        add_story(sdb, sid, kind="projected", importance=float(i))
        add_link(sdb, "story:test-hub", sid, "projected")
    data = check("cascade", call(sdb, "cascade", {"id": "story:test-hub", "depth": 1}))
    assert len(data["nodes"]) == 60
    kept = {n["id"] for n in data["nodes"]} - {"story:test-hub"}
    assert kept == {f"story:test-effect-{i:02d}" for i in range(11, 70)}
    assert len(data["links"]) == 59


def test_cascade_sample_rule_applies_to_neighbours_only(sdb):
    add_story(sdb, "story:test-live")
    add_link(sdb, "story:test-live", FOCUS, "inferred")
    off = check("cascade", call(sdb, "cascade", {"id": "story:test-live", "sample": False}))
    assert ids(off["nodes"]) == ["story:test-live"]
    assert off["links"] == [] and off["branches"] == []

    on = check("cascade", call(sdb, "cascade", {"id": "story:test-live", "depth": 3, "sample": True}))
    depths = {n["id"]: n["depth"] for n in on["nodes"]}
    assert depths[FOCUS] == 1
    assert depths["story:surcharges-persist"] == 3
    assert on["branches"]

    # The focus itself is sample data, so its sample neighbours stay.
    sample_focus = check("cascade", call(sdb, "cascade", {"id": FOCUS, "sample": False}))
    depths = {n["id"]: n["depth"] for n in sample_focus["nodes"]}
    assert depths["story:test-live"] == -1
    assert depths["story:asia-europe-rates-jump"] == 1


def test_cascade_drops_conditional_links_on_hidden_forecasts(sdb):
    base_effects = call(sdb, "story", {"id": FOCUS})["effects"]
    add_real_money_forecast(sdb)
    add_story(sdb, "story:test-if-yes", kind="projected", headline="Test effect if yes")
    add_story(sdb, "story:test-if-no", kind="projected", headline="Test effect if no")
    add_link(sdb, FOCUS, "story:test-if-yes", "conditional", forecast=REAL_MONEY, outcome="YES")
    add_link(sdb, FOCUS, "story:test-if-no", "conditional", forecast=REAL_MONEY, outcome="NO")
    for viewer in HIDDEN_VIEWERS:
        data = check("cascade", call(sdb, "cascade", {"id": FOCUS, "depth": 1, **viewer}))
        assert not {"story:test-if-yes", "story:test-if-no"} & set(ids(data["nodes"]))
        assert REAL_MONEY not in {link["forecast_id"] for link in data["links"]}
        assert REAL_MONEY not in {b["forecast"]["id"] for b in data["branches"]}
        assert call(sdb, "story", {"id": FOCUS, **viewer})["effects"] == base_effects

    data = check("cascade", call(sdb, "cascade", {"id": FOCUS, "depth": 1, **US}))
    assert {"story:test-if-yes", "story:test-if-no"} <= set(ids(data["nodes"]))
    branch = next(b for b in data["branches"] if b["forecast"]["id"] == REAL_MONEY)
    assert branch["outcomes"] == [
        {"outcome": "YES", "probability": 0.55, "story_ids": ["story:test-if-yes"]},
        {"outcome": "NO", "probability": 0.45, "story_ids": ["story:test-if-no"]},
    ]
    assert call(sdb, "story", {"id": FOCUS, **US})["effects"] == base_effects + 2


def test_cascade_not_found(sdb):
    for args in ({"id": "story:does-not-exist"}, {"id": "region:in"}, {}):
        assert_not_found(sdb, "cascade", args)


# ---------------------------------------------------------------------------
# api.entity
# ---------------------------------------------------------------------------

ENTITY_IDS = [
    "region:in",
    "region:in-gj",
    "region:in-gj.ahmedabad",
    "region:eu",
    "commodity:crude-oil",
    "org:maersk",
    "org:opec",
    "org:kestrel-lines",
    "infra:mundra-port",
    "policy:eu-cbam",
    "sector:energy",
    "indicator:in-cpi",
    "forecast:suez-transits-recover",
]


@pytest.mark.parametrize("entity_id", ENTITY_IDS)
def test_entity_matches_contract(sdb, entity_id):
    data = check("entity", call(sdb, "entity", {"id": entity_id}))
    assert data["entity"]["id"] == entity_id
    assert len(data["entity"]["facts"]) <= 8
    assert len(data["timeline"]) <= 20
    assert len(data["backlinks"]) <= 60
    assert len(data["graph"]["nodes"]) <= 60
    assert entity_id in assert_graph_consistent(data["graph"])


def facts(conn: psycopg.Connection, entity_id: str) -> dict[str, str]:
    return {f["label"]: f["value"] for f in call(conn, "entity", {"id": entity_id})["entity"]["facts"]}


def test_entity_facts(sdb):
    assert facts(sdb, "region:in") == {"Type": "Country", "Part of": "Southern Asia", "ISO code": "IN"}
    assert facts(sdb, "region:in-gj") == {"Type": "State", "Part of": "India", "ISO code": "IN-GJ"}
    assert facts(sdb, "region:in-gj.ahmedabad") == {
        "Type": "City",
        "Part of": "Gujarat",
        "Country": "India",
        "Population": "5,375,000",
    }
    assert facts(sdb, "region:eu")["Members"] == "27"
    oil = facts(sdb, "commodity:crude-oil")
    assert oil["HS code"] == "2709"
    assert oil["Produced in"] == "United States of America, Saudi Arabia, Russia"
    assert oil["Sectors"] == "Energy"
    port = facts(sdb, "infra:mundra-port")
    assert port["Type"] == "Infrastructure · Port"
    assert port["Located in"] == "Gujarat"
    assert port["Country"] == "India"
    assert port["Owner"] == "Adani Ports and SEZ"
    assert facts(sdb, "org:rbi")["Type"] == "Organization · Central bank"
    assert facts(sdb, "org:opec")["Members"] == "12"
    assert facts(sdb, "policy:eu-cbam")["Applies to"] == "European Union"
    assert facts(sdb, "sector:energy") == {"Type": "Sector"}


def test_entity_basics(sdb):
    entity = call(sdb, "entity", {"id": "infra:mundra-port"})["entity"]
    assert entity["name"] == "Mundra Port"
    assert (entity["lon"], entity["lat"]) == (69.7, 22.74)
    assert entity["is_sample"] is False
    assert call(sdb, "entity", {"id": "commodity:crude-oil"})["entity"]["aliases"] == ["Brent", "WTI", "oil"]


def test_entity_timeline_for_regions(sdb):
    cases = {
        "region:in": "country_id",
        "region:in-dl": "admin1_id",
        "region:in-dl.delhi": "primary_region",
    }
    for region, column in cases.items():
        timeline = call(sdb, "entity", {"id": region})["timeline"]
        expected = query(
            sdb,
            f"select node_id from story where kind = 'event' and {column} = %s "
            "order by first_seen desc, node_id limit 20",
            region,
        )
        assert ids(timeline) == [r["node_id"] for r in expected], region
        assert timeline, region
    assert "story:delhi-peak-power-record" in ids(
        call(sdb, "entity", {"id": "region:in-dl.delhi"})["timeline"]
    )


def test_entity_timeline_for_other_entities_uses_mentions(sdb):
    for entity_id in ("commodity:crude-oil", "sector:energy", "region:eu"):
        timeline = call(sdb, "entity", {"id": entity_id})["timeline"]
        assert timeline
        first_seen = [ts(s["first_seen"]) for s in timeline]
        assert first_seen == sorted(first_seen, reverse=True)
        assert all(s["kind"] == "event" for s in timeline)
    oil = call(sdb, "entity", {"id": "commodity:crude-oil"})["timeline"]
    mentioned = query(
        sdb,
        """select s.node_id from edge e join story s on s.node_id = e.src
           where e.dst = 'commodity:crude-oil' and e.type = 'mentions' and s.kind = 'event'""",
    )
    assert set(ids(oil)) == {r["node_id"] for r in mentioned}


def test_entity_backlinks(sdb):
    backlinks = call(sdb, "entity", {"id": "region:in"})["backlinks"]
    assert len(backlinks) <= 60
    assert all(b["type"] != "story" for b in backlinks)
    assert [(b["type"], b["name"]) for b in backlinks] == sorted((b["type"], b["name"]) for b in backlinks)
    children = [b["id"] for b in backlinks if b["edge_type"] == "part_of"]
    assert scalar(sdb, "select count(*) from edge where dst = 'region:in' and type = 'part_of'") > 30
    assert len(children) == 30
    assert "region:in-gj" in children  # busy states come first
    for b in backlinks:
        assert query(
            sdb,
            "select 1 from edge where src = %s and dst = 'region:in' and type = %s",
            b["id"],
            b["edge_type"],
        )
    assert {"indicator", "organization", "policy", "forecast"} <= {b["type"] for b in backlinks}


def test_entity_forecasts_have_history(sdb):
    data = call(sdb, "entity", {"id": "region:in"})
    expected = query(
        sdb,
        """select e.src from edge e join node n on n.id = e.src
           where e.dst = 'region:in' and e.type = 'about' and n.type = 'forecast'""",
    )
    assert set(ids(data["forecasts"])) == {r["src"] for r in expected}
    for fc in data["forecasts"]:
        history = fc["history"]
        assert 2 <= len(history) <= 120
        times = [ts(p["ts"]) for p in history]
        assert times == sorted(times)
        assert history[-1]["p"] == fc["probability"]
        assert times[-1] == ts(fc["updated_at"])


def test_entity_indicators(sdb):
    data = call(sdb, "entity", {"id": "region:in"})
    expected = query(sdb, "select node_id from indicator_series where subject_id = 'region:in'")
    assert set(ids(data["indicators"])) == {r["node_id"] for r in expected}
    for kpi in data["indicators"]:
        points = query(
            sdb, "select date, value from indicator_point where series_id = %s order by date desc", kpi["id"]
        )
        assert kpi["latest"] == points[0]["value"]
        assert kpi["previous"] == points[1]["value"]
        assert kpi["change"] == pytest.approx(points[0]["value"] - points[1]["value"])
        assert kpi["as_of"] == points[0]["date"].isoformat()
        assert len(kpi["series"]) == min(60, len(points))
        assert kpi["series"][-1] == {"d": kpi["as_of"], "v": kpi["latest"]}
        assert [p["d"] for p in kpi["series"]] == sorted(p["d"] for p in kpi["series"])


def test_entity_sample_rule(sdb):
    off = check("entity", call(sdb, "entity", {"id": "region:in", "sample": False}))
    assert off["timeline"] == [] and off["forecasts"] == [] and off["indicators"] == []
    assert not sample_ids(sdb, ids(off["backlinks"]))
    assert not sample_ids(sdb, [n["id"] for n in off["graph"]["nodes"]])
    on = call(sdb, "entity", {"id": "region:in", "sample": True})
    assert on["timeline"] and on["forecasts"] and on["indicators"]
    # A sample entity keeps its sample stories.
    kestrel = check("entity", call(sdb, "entity", {"id": "org:kestrel-lines", "sample": False}))
    assert kestrel["entity"]["is_sample"] is True
    assert "story:asia-europe-rates-jump" in ids(kestrel["timeline"])


def test_entity_hides_real_money_forecasts(sdb):
    add_real_money_forecast(sdb)
    for viewer in HIDDEN_VIEWERS:
        data = check("entity", call(sdb, "entity", {"id": "region:in", **viewer}))
        assert REAL_MONEY not in ids(data["forecasts"])
        assert REAL_MONEY not in ids(data["backlinks"])
        assert REAL_MONEY not in {n["id"] for n in data["graph"]["nodes"]}
        assert_not_found(sdb, "entity", {"id": REAL_MONEY, **viewer})
    data = check("entity", call(sdb, "entity", {"id": "region:in", **US}))
    assert REAL_MONEY in ids(data["forecasts"])
    assert REAL_MONEY in ids(data["backlinks"])
    check("entity", call(sdb, "entity", {"id": REAL_MONEY, **US}))


def test_entity_not_found(sdb):
    for args in ({"id": "region:atlantis"}, {"id": FOCUS}, {}):
        assert_not_found(sdb, "entity", args)


# ---------------------------------------------------------------------------
# api.graph
# ---------------------------------------------------------------------------

GRAPH_ARGS: list[dict[str, Any]] = [
    {},
    {"limit": 1500},
    {"window": "all", "limit": 1500},
    {"window": "24h"},
    {"window": "7d", "sectors": ["energy", "finance"]},
    {"regions": ["region:eu"]},
    {"regions": ["region:in-gj"]},
    {"types": ["story"]},
    {"types": ["story", "sector"], "limit": 1500},
    {"min_confidence": 0.8},
    {"limit": 1},
    {"limit": 0},
    {"limit": 99999},
    {"sample": False},
    {"sectors": []},
    {"regions": ["region:nowhere"]},
]


@pytest.mark.parametrize("args", GRAPH_ARGS)
def test_graph_matches_contract(sdb, args):
    data = check("graph", call(sdb, "graph", args))
    assert_graph_consistent(data)


def test_graph_limit_and_truncation(sdb):
    default = call(sdb, "graph", {})
    assert len(default["nodes"]) <= 400
    assert default["truncated"] is True
    full = call(sdb, "graph", {"limit": 1500})
    assert full["truncated"] is False
    assert len(full["nodes"]) > 400
    assert len(call(sdb, "graph", {"limit": 99999})["nodes"]) <= 1500
    small = call(sdb, "graph", {"limit": 10})
    assert small["truncated"] is True and 0 < len(small["nodes"]) <= 10
    # The most important stories survive the cut.
    top = scalar(
        sdb,
        """select s.node_id from story s where s.kind = 'event' and s.first_seen > now() - interval '30 days'
           order by s.importance desc limit 1""",
    )
    assert top in {n["id"] for n in default["nodes"]}


def test_graph_window_and_time_lapse(sdb):
    month = {n["id"]: n for n in call(sdb, "graph", {"limit": 1500, "types": ["story"]})["nodes"]}
    expected = query(
        sdb,
        """select node_id, first_seen from story
           where kind = 'event' and first_seen >= now() - interval '30 days'""",
    )
    assert expected
    for row in expected:  # events carry first_seen for the time-lapse
        assert ts(month[row["node_id"]]["created_at"]) == row["first_seen"]
    assert all(n["created_at"] is not None for n in month.values())

    day = call(sdb, "graph", {"window": "24h", "limit": 1500})
    now = scalar(sdb, "select now()")
    event_ids = {r["node_id"] for r in query(sdb, "select node_id from story where kind = 'event'")}
    day_events = [n for n in day["nodes"] if n["id"] in event_ids]
    assert day_events
    assert all(now - ts(n["created_at"]) <= timedelta(hours=24) for n in day_events)
    everything = call(sdb, "graph", {"window": "all", "limit": 1500, "types": ["story"]})
    assert {n["id"] for n in everything["nodes"]} >= event_ids


def test_graph_filters(sdb):
    energy = call(sdb, "graph", {"sectors": ["energy"], "limit": 1500})
    event_rows = query(sdb, "select node_id, sectors, country_id, admin1_id from story where kind = 'event'")
    events = {r["node_id"]: r for r in event_rows}
    picked = [n["id"] for n in energy["nodes"] if n["id"] in events]
    assert picked and all("energy" in events[i]["sectors"] for i in picked)

    members = {
        r["src"] for r in query(sdb, "select src from edge where dst = 'region:eu' and type = 'member_of'")
    }
    about_eu = {
        r["src"] for r in query(sdb, "select src from edge where dst = 'region:eu' and type = 'mentions'")
    }
    eu = call(sdb, "graph", {"regions": ["region:eu"], "limit": 1500})
    picked = {n["id"] for n in eu["nodes"] if n["id"] in events}
    assert all(events[i]["country_id"] in members or i in about_eu for i in picked)
    assert "story:eu-gas-storage-injections-slow" in picked  # placed at the EU itself
    assert any(events[i]["country_id"] == "region:de" for i in picked)

    gujarat = call(sdb, "graph", {"regions": ["region:in-gj"], "limit": 1500})
    picked = [n["id"] for n in gujarat["nodes"] if n["id"] in events]
    assert picked and all(events[i]["admin1_id"] == "region:in-gj" for i in picked)


def test_graph_types_and_sectors(sdb):
    default = call(sdb, "graph", {"limit": 1500})
    assert "sector" not in {n["type"] for n in default["nodes"]}
    types = {n["type"] for n in default["nodes"]}
    assert {"story", "region", "commodity", "organization", "forecast"} <= types

    stories = call(sdb, "graph", {"types": ["story"], "limit": 1500})
    assert {n["type"] for n in stories["nodes"]} == {"story"}
    assert stories["links"] and all(link["causal"] for link in stories["links"])

    with_sectors = call(sdb, "graph", {"types": ["story", "sector"], "limit": 1500})
    assert {n["type"] for n in with_sectors["nodes"]} == {"story", "sector"}
    assert "mentions" in {link["type"] for link in with_sectors["links"]}

    projected = {n["id"] for n in stories["nodes"]} & {
        r["node_id"] for r in query(sdb, "select node_id from story where kind = 'projected'")
    }
    assert projected


def test_graph_min_confidence(sdb):
    data = call(sdb, "graph", {"types": ["story"], "min_confidence": 0.8, "limit": 1500})
    causal = [link for link in data["links"] if link["causal"]]
    assert causal and all(link["confidence"] >= 0.8 for link in causal)
    loose = call(sdb, "graph", {"types": ["story"], "min_confidence": 0, "limit": 1500})
    assert len(loose["links"]) > len(data["links"])
    assert min(link["confidence"] for link in loose["links"]) < 0.8


def test_graph_sample_rule(sdb):
    assert call(sdb, "graph", {"sample": False}) == {"nodes": [], "links": [], "truncated": False}
    add_story(sdb, "story:test-live", mentions=("region:in", "commodity:crude-oil"))
    data = check("graph", call(sdb, "graph", {}))  # a live story exists: sample is off by default
    assert {n["id"] for n in data["nodes"]} == {
        "story:test-live",
        "region:in-gj",
        "region:in",
        "commodity:crude-oil",
    }
    assert not sample_ids(sdb, [n["id"] for n in data["nodes"]])
    with_sample = call(sdb, "graph", {"sample": True, "limit": 1500})
    assert "story:test-live" in {n["id"] for n in with_sample["nodes"]}
    assert sample_ids(sdb, [n["id"] for n in with_sample["nodes"]])


def test_graph_hides_real_money_forecasts(sdb):
    add_real_money_forecast(sdb)
    for viewer in HIDDEN_VIEWERS:
        data = check("graph", call(sdb, "graph", {"limit": 1500, **viewer}))
        assert REAL_MONEY not in {n["id"] for n in data["nodes"]}
    data = check("graph", call(sdb, "graph", {"limit": 1500, **US}))
    assert REAL_MONEY in {n["id"] for n in data["nodes"]}
    assert {"about", "relates_to"} <= {link["type"] for link in data["links"] if link["source"] == REAL_MONEY}


# ---------------------------------------------------------------------------
# api.local_graph
# ---------------------------------------------------------------------------

LOCAL_ARGS: list[dict[str, Any]] = [
    {"id": "region:in", "depth": 1},
    {"id": "region:in", "depth": 2},
    {"id": "region:in", "depth": 3, "limit": 400},
    {"id": FOCUS, "depth": 2},
    {"id": "sector:energy", "depth": 1},
    {"id": "forecast:suez-transits-recover", "depth": 2},
    {"id": "indicator:in-cpi", "depth": 1},
    {"id": "region:in"},
    {"id": "region:in", "depth": 1, "limit": 1},
    {"id": "region:in", "depth": 7, "limit": -3},
    {"id": "region:in", "depth": 1, "sample": False},
]


@pytest.mark.parametrize("args", LOCAL_ARGS)
def test_local_graph_matches_contract(sdb, args):
    data = check("local_graph", call(sdb, "local_graph", args))
    assert data["focus"] == args["id"]
    assert args["id"] in assert_graph_consistent(data)
    assert data["nodes"][0]["id"] == args["id"]


def test_local_graph_limits(sdb):
    assert len(call(sdb, "local_graph", {"id": "region:in", "depth": 2})["nodes"]) <= 150
    big = call(sdb, "local_graph", {"id": "region:in", "depth": 3, "limit": 9999})
    assert len(big["nodes"]) == 400 and big["truncated"] is True
    one = call(sdb, "local_graph", {"id": "region:in", "depth": 1, "limit": 1})
    assert [n["id"] for n in one["nodes"]] == ["region:in"] and one["truncated"] is True
    assert call(sdb, "local_graph", {"id": "region:in"}) == call(
        sdb, "local_graph", {"id": "region:in", "depth": 1}
    )
    small = call(sdb, "local_graph", {"id": "story:surcharges-persist", "depth": 1})
    assert small["truncated"] is False


def test_local_graph_shows_at_most_12_child_regions(sdb):
    data = call(sdb, "local_graph", {"id": "region:in", "depth": 1, "limit": 400})
    children = {
        r["src"] for r in query(sdb, "select src from edge where dst = 'region:in' and type = 'part_of'")
    }
    shown = {n["id"] for n in data["nodes"]} & children
    assert len(children) > 12
    assert len(shown) == 12
    assert "region:in-gj" in shown


def test_local_graph_prioritises_important_stories(sdb):
    data = call(sdb, "local_graph", {"id": "region:in", "depth": 1, "limit": 6})
    assert data["truncated"] is True
    expected = query(
        sdb,
        """select s.node_id from edge e join story s on s.node_id = e.src
           where e.dst = 'region:in' and e.type = 'mentions'
           order by s.importance desc, s.node_id limit 5""",
    )
    assert [n["id"] for n in data["nodes"]] == ["region:in", *[r["node_id"] for r in expected]]


def test_local_graph_does_not_expand_sectors(sdb):
    data = call(sdb, "local_graph", {"id": FOCUS, "depth": 2, "limit": 400})
    assert data["truncated"] is False
    node_ids = [n["id"] for n in data["nodes"]]
    types = {n["id"]: n["type"] for n in data["nodes"]}
    links = neighbours(sdb, node_ids)
    depth1 = links[FOCUS] & set(node_ids)
    assert any(types[n] == "sector" for n in depth1)
    for node in set(node_ids) - depth1 - {FOCUS}:
        parents = {p for p in links[node] & depth1 if types[p] != "sector"}
        assert parents, f"{node} is reachable only through a sector"
    # A sector that is the focus is expanded.
    energy = call(sdb, "local_graph", {"id": "sector:energy", "depth": 1})
    assert "story" in {n["type"] for n in energy["nodes"]}


def test_local_graph_follows_causal_links(sdb):
    data = call(sdb, "local_graph", {"id": FOCUS, "depth": 1, "limit": 400})
    node_ids = {n["id"] for n in data["nodes"]}
    effects = {
        r["dst_story"] for r in query(sdb, "select dst_story from causal_link where src_story = %s", FOCUS)
    }
    assert effects <= node_ids
    causal = {(link["source"], link["target"]) for link in data["links"] if link["causal"]}
    assert {(FOCUS, e) for e in effects} <= causal


def test_local_graph_sample_rule(sdb):
    off = call(sdb, "local_graph", {"id": "region:in", "depth": 2, "sample": False})
    assert not sample_ids(sdb, [n["id"] for n in off["nodes"]])
    on = call(sdb, "local_graph", {"id": "region:in", "depth": 2, "sample": True})
    assert sample_ids(sdb, [n["id"] for n in on["nodes"]])
    sample_focus = call(sdb, "local_graph", {"id": FOCUS, "depth": 1, "sample": False})
    assert len(sample_ids(sdb, [n["id"] for n in sample_focus["nodes"]])) > 1


def test_local_graph_hides_real_money_forecasts(sdb):
    add_real_money_forecast(sdb)
    for viewer in HIDDEN_VIEWERS:
        data = check(
            "local_graph", call(sdb, "local_graph", {"id": "region:in", "depth": 1, "limit": 400, **viewer})
        )
        assert REAL_MONEY not in {n["id"] for n in data["nodes"]}
        assert_not_found(sdb, "local_graph", {"id": REAL_MONEY, "depth": 1, **viewer})
    data = check("local_graph", call(sdb, "local_graph", {"id": "region:in", "depth": 1, "limit": 400, **US}))
    assert REAL_MONEY in {n["id"] for n in data["nodes"]}
    check("local_graph", call(sdb, "local_graph", {"id": REAL_MONEY, "depth": 1, **US}))


def test_local_graph_not_found(sdb):
    for args in ({"id": "region:atlantis", "depth": 1}, {"depth": 1}):
        assert_not_found(sdb, "local_graph", args)


# ---------------------------------------------------------------------------
# api.search
# ---------------------------------------------------------------------------

SEARCH_ARGS: list[dict[str, Any]] = [
    {"q": "india"},
    {"q": "Gujarat", "types": ["region"]},
    {"q": "suez", "limit": 3},
    {"q": "a"},
    {"q": "oil", "types": ["commodity", "story"], "limit": 50},
    {"q": "x" * 200},
    {"q": ""},
    {"q": "   "},
    {"q": "%"},
    {"q": "_"},
    {"q": "rice", "sample": False},
    {"q": "india", "limit": 0},
    {"q": "india", "limit": 500},
    {},
]


@pytest.mark.parametrize("args", SEARCH_ARGS)
def test_search_matches_contract(sdb, args):
    check("search", call(sdb, "search", args))


def results(conn: psycopg.Connection, q: str, **args: Any) -> list[dict[str, Any]]:
    return call(conn, "search", {"q": q, **args})["results"]


def find(rows: list[dict[str, Any]], node_id: str) -> dict[str, Any]:
    return next(r for r in rows if r["id"] == node_id)


def test_search_blank_query_returns_nothing(sdb):
    for q in ("", "   "):
        assert results(sdb, q) == []
    assert call(sdb, "search", {}) == {"results": []}


def test_search_scores_exact_prefix_and_trigram(sdb):
    india = results(sdb, "India")
    assert india[0]["id"] == "region:in"
    assert india[0]["score"] == pytest.approx(1.15)  # exact + country boost
    assert results(sdb, "GUJARAT")[0] == {
        "id": "region:in-gj",
        "type": "region",
        "subtype": "state",
        "name": "Gujarat",
        "context": "State · India",
        "score": pytest.approx(1.05),
    }
    assert find(results(sdb, "Ahmedabad"), "region:in-gj.ahmedabad")["score"] == pytest.approx(1.0)
    assert find(results(sdb, "Ahmeda"), "region:in-gj.ahmedabad")["score"] == pytest.approx(0.8)
    typo = find(results(sdb, "Gujrat"), "region:in-gj")
    similarity = scalar(sdb, "select similarity('Gujarat', 'Gujrat')")
    assert similarity >= 0.25
    assert typo["score"] == pytest.approx(round(similarity * 0.7 + 0.05, 3), abs=0.002)
    assert all(r["score"] >= 0.175 for r in results(sdb, "Gujrat"))


def test_search_matches_aliases_and_codes(sdb):
    assert results(sdb, "wti")[0]["id"] == "commodity:crude-oil"
    assert results(sdb, "wti")[0]["score"] == pytest.approx(1.0)
    # "Brent" is also a London borough (a state-level region, so +0.05).
    brent = results(sdb, "brent")
    assert ids(brent)[:2] == ["region:gb-ben", "commodity:crude-oil"]
    assert find(brent, "commodity:crude-oil")["score"] == pytest.approx(1.0)
    assert results(sdb, "Nhava Sheva")[0]["id"] == "infra:jnpa-port"
    assert results(sdb, "EU")[0]["id"] == "region:eu"
    assert results(sdb, "us")[0]["id"] == "region:us"
    assert results(sdb, "IND")[0]["id"] == "region:in"


def test_search_orders_by_score(sdb):
    for q in ("india", "port", "oil", "rate"):
        scores = [r["score"] for r in results(sdb, q, limit=50)]
        assert scores == sorted(scores, reverse=True)
        assert len(set(r["id"] for r in results(sdb, q, limit=50))) == len(scores)


def test_search_boosts_recent_events_and_forecasts(sdb):
    recent = query(
        sdb,
        """select s.node_id, n.name from story s join node n on n.id = s.node_id
           where s.kind = 'event' order by s.first_seen desc limit 1""",
    )[0]
    assert find(results(sdb, recent["name"]), recent["node_id"])["score"] == pytest.approx(1.1)
    old = query(
        sdb,
        """select s.node_id, n.name from story s join node n on n.id = s.node_id
           where s.kind = 'event' and s.first_seen < now() - interval '2 days'
           order by s.first_seen limit 1""",
    )[0]
    assert find(results(sdb, old["name"]), old["node_id"])["score"] == pytest.approx(1.0)
    title = scalar(sdb, "select short_title from forecast where node_id = 'forecast:suez-transits-recover'")
    assert find(results(sdb, title), "forecast:suez-transits-recover")["score"] == pytest.approx(1.05)


def test_search_context(sdb):
    def context(q: str, node_id: str) -> str | None:
        return find(results(sdb, q, limit=50), node_id)["context"]

    assert context("India", "region:in") == "Country · Southern Asia"
    assert context("Ahmedabad", "region:in-gj.ahmedabad") == "City · Gujarat, India"
    assert context("Crude oil", "commodity:crude-oil") == "Commodity · HS 2709"
    assert context("Maersk", "org:maersk") == "Company · Denmark"
    assert context("Reserve Bank of India", "org:rbi") == "Central bank · India"
    assert context("Mundra Port", "infra:mundra-port") == "Port · India"
    assert context("Bab-el-Mandeb", "infra:bab-el-mandeb") == "Chokepoint · Yemen"
    assert context("Energy", "sector:energy") == "Sector"
    assert context("CBAM", "policy:eu-cbam") == "Policy · Regulation"
    assert context("European Union", "region:eu") == "Bloc · 27 members"
    headline = scalar(sdb, "select headline from story where node_id = %s", FOCUS)
    assert context(headline, FOCUS) == "Story · Yemen · risk"
    title = scalar(sdb, "select short_title from forecast where node_id = 'forecast:suez-transits-recover'")
    assert context(title, "forecast:suez-transits-recover") == "Forecast · 31%"


def test_search_types_and_limit(sdb):
    regions = results(sdb, "india", types=["region"], limit=50)
    assert regions and {r["type"] for r in regions} == {"region"}
    assert len(results(sdb, "a")) == 12
    assert len(results(sdb, "a", limit=100)) == 50
    assert len(results(sdb, "a", limit=0)) == 1
    assert len(results(sdb, "x" * 200)) <= 12


def test_search_treats_wildcards_literally(sdb):
    for q in ("%", "_", "\\"):
        assert all(q in r["name"] for r in results(sdb, q, limit=50))
    assert len(results(sdb, "%", limit=50)) < 50


def test_search_word_matches_find_stories(sdb):
    rows = results(sdb, "monsoon", types=["story"], limit=50)
    assert rows
    assert all("monsoon" in r["name"].lower() for r in rows)


def test_search_sample_rule(sdb):
    assert find(results(sdb, "Kestrel Lines"), "org:kestrel-lines")
    assert not any(r["id"] == "org:kestrel-lines" for r in results(sdb, "Kestrel Lines", sample=False))
    off = results(sdb, "rice", sample=False, limit=50)
    assert not sample_ids(sdb, ids(off))
    assert "commodity:rice" in ids(off)
    on = results(sdb, "rice", sample=True, limit=50)
    assert {"story", "forecast"} <= {r["type"] for r in on}


def test_search_hides_real_money_forecasts(sdb):
    add_real_money_forecast(sdb)
    for viewer in HIDDEN_VIEWERS:
        assert REAL_MONEY not in ids(results(sdb, REAL_MONEY_TITLE, **viewer))
    found = find(results(sdb, REAL_MONEY_TITLE, **US), REAL_MONEY)
    assert found["context"] == "Forecast · 55%"
    assert found["score"] == pytest.approx(1.05)


# ---------------------------------------------------------------------------
# Speed
# ---------------------------------------------------------------------------

TIMED: list[tuple[str, dict[str, Any]]] = [
    ("story", {"id": FOCUS}),
    ("cascade", {"id": "story:brent-multi-month-high", "depth": 3}),
    ("entity", {"id": "region:in"}),
    ("entity", {"id": "sector:manufacturing"}),
    ("graph", {}),
    (
        "graph",
        {
            "window": "all",
            "limit": 1500,
            "types": [
                "story",
                "region",
                "sector",
                "commodity",
                "organization",
                "infrastructure",
                "policy",
                "forecast",
            ],
        },
    ),
    ("local_graph", {"id": "region:in", "depth": 3, "limit": 400}),
    ("local_graph", {"id": "sector:manufacturing", "depth": 3, "limit": 400}),
    ("search", {"q": "india"}),
    ("search", {"q": "a", "limit": 50}),
]


@pytest.mark.parametrize(("name", "args"), TIMED)
def test_functions_are_fast(sdb, name, args):
    call(sdb, name, args)  # warm the cache and the plan
    start = time.perf_counter()
    call(sdb, name, args)
    elapsed = time.perf_counter() - start
    assert elapsed < 0.5, f"api.{name} took {elapsed * 1000:.0f} ms"

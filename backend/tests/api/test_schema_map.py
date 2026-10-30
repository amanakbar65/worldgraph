"""Phase A5: the schema map (api.schema, migration 0025).

by_pair counts match direct counts (also at production scale, and fast),
property coverage and each type's biggest relations are right, and counts
follow the graph (valid dates, the sample rule).
"""

from __future__ import annotations

import time
from collections import Counter
from typing import Any

import psycopg
import pytest

from tests.contract import call, check
from tests.live_style import write_bulk

pytestmark = pytest.mark.db


def direct_pairs(conn: psycopg.Connection, sample: bool) -> Counter[tuple[str, str, str]]:
    rows = conn.execute(
        """select e.type as relation, s.type as src, d.type as dst, count(*) as n
           from edge e join node s on s.id = e.src join node d on d.id = e.dst
           where (%(sample)s or not (e.is_sample or s.is_sample or d.is_sample))
             and (e.valid_from is null or e.valid_from <= current_date)
             and (e.valid_to is null or e.valid_to >= current_date)
           group by 1, 2, 3
           union all
           select 'drives', 'story', 'story', count(*) from causal_link where %(sample)s or not is_sample""",
        {"sample": sample},
    ).fetchall()
    return Counter({(r["relation"], r["src"], r["dst"]): r["n"] for r in rows if r["n"]})


def api_pairs(data: dict[str, Any]) -> Counter[tuple[str, str, str]]:
    return Counter(
        {
            (r["key"], p["src_type"], p["dst_type"]): p["count"]
            for r in data["relations"]
            for p in r["by_pair"]
        }
    )


def test_by_pair_matches_direct_counts(sdb):
    for sample in (True, False):
        data = check("schema", call(sdb, "schema", {"sample": sample}))
        assert api_pairs(data) == direct_pairs(sdb, sample)
        for r in data["relations"]:
            assert r["count"] == sum(p["count"] for p in r["by_pair"])


def test_links_outside_their_valid_dates_are_not_counted(sdb):
    before = {r["key"]: r["count"] for r in call(sdb, "schema", {})["relations"]}
    sdb.execute(
        "update edge set valid_to = current_date - 1 where src = 'org:dp-world' and type = 'operates'"
    )
    after = {r["key"]: r["count"] for r in call(sdb, "schema", {})["relations"]}
    assert after["operates"] == before["operates"] - 1


def test_property_coverage_and_type_links(sdb):
    data = check("schema", call(sdb, "schema", {"sample": False}))
    types = {t["key"]: t for t in data["types"]}
    orgs = types["organization"]
    with_sector = sdb.execute(
        "select count(*) filter (where properties ? 'sector') as n, count(*) as total "
        "from node where type = 'organization' and not is_sample"
    ).fetchone()
    assert with_sector is not None
    coverage = {p["key"]: p["coverage"] for p in orgs["properties"]}
    assert coverage["sector"] == round(with_sector["n"] / with_sector["total"], 3)
    assert all(0 <= c <= 1 for c in coverage.values())
    assert all(p["coverage"] is None for p in types["region"]["properties"])  # derived
    # A type's links, read from its side, agree with by_pair.
    pairs = api_pairs(data)
    links = {(lk["relation"], lk["direction"]): lk for lk in orgs["links"]}
    assert links[("in_sector", "out")]["label"] == "In sector"
    assert links[("in_sector", "out")]["count"] == sum(
        n for (rel, src, _dst), n in pairs.items() if rel == "in_sector" and src == "organization"
    )
    assert len(orgs["links"]) <= 6
    assert [lk["count"] for lk in orgs["links"]] == sorted(
        (lk["count"] for lk in orgs["links"]), reverse=True
    )
    port = {(lk["relation"], lk["direction"]): lk for lk in types["infrastructure"]["links"]}
    assert port[("operates", "in")]["label"] == "Operated by"


def test_schema_map_fields_follow_the_flag(sdb):
    sdb.execute("update app_flag set enabled = false where key = 'kg.schema_map'")
    data = check("schema", call(sdb, "schema", {}))
    assert all(t["links"] == [] for t in data["types"])
    assert all(p["coverage"] is None for t in data["types"] for p in t["properties"])


def test_schema_at_production_scale(sdb):
    write_bulk(sdb, "schema-bulk", stories=5000)
    call(sdb, "schema", {"sample": False})  # warm
    started = time.perf_counter()
    data = check("schema", call(sdb, "schema", {"sample": False}))
    elapsed = time.perf_counter() - started
    assert api_pairs(data) == direct_pairs(sdb, False)
    assert elapsed < 1.0, elapsed

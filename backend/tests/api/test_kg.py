"""Knowledge graph Phase A (A0–A2) in the api: flags in api.meta, properties
and connections in api.entity, property and relation filters in api.graph
and api.local_graph, relation fields on links, and api.schema.

Runs against the seeded test database inside a rolled-back transaction.
"""

from __future__ import annotations

import json
from typing import Any

import psycopg
import pytest

from tests.contract import call, check

pytestmark = pytest.mark.db

PHASE_A_FLAGS = {"kg.properties", "kg.relations", "kg.provenance", "kg.history", "kg.schema_map"}
LINK_FIELDS = {"id", "relation", "polarity", "strength", "delayed"}


def props(data: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {p["key"]: p for p in data["properties"]}


def groups(data: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    return {(g["relation"], g["direction"]): g for g in data["connections"]}


def flag(conn: psycopg.Connection, key: str, on: bool) -> None:
    conn.execute("update app_flag set enabled = %s, updated_at = now() where key = %s", (on, key))


def error(conn: psycopg.Connection, name: str, args: dict[str, Any]) -> str:
    with pytest.raises(psycopg.errors.RaiseException) as caught:
        call(conn, name, args)
    conn.rollback()
    return str(caught.value).splitlines()[0]


# ---------------------------------------------------------------------------
# A0: flags
# ---------------------------------------------------------------------------


def test_meta_sends_the_flags(sdb):
    meta = check("meta", call(sdb, "meta", {}))
    assert set(meta["flags"]) == PHASE_A_FLAGS and all(meta["flags"].values())
    flag(sdb, "kg.history", False)
    assert call(sdb, "meta", {})["flags"]["kg.history"] is False


def test_flag_helper_treats_missing_as_off(sdb):
    assert sdb.execute("select api._flag('kg.properties') as f").fetchone() == {"f": True}
    assert sdb.execute("select api._flag('kg.nothing') as f").fetchone() == {"f": False}


# ---------------------------------------------------------------------------
# A1: properties on api.entity
# ---------------------------------------------------------------------------


def test_entity_properties_for_curated_entities(sdb):
    dp = check("entity", call(sdb, "entity", {"id": "org:dp-world"}))
    p = props(dp)
    assert list(p) == ["sector", "headquarters"]  # in the type's order, only those with a value
    assert p["headquarters"] == {
        "key": "headquarters",
        "label": "Headquarters",
        "kind": "place",
        "value": "region:ae-du.dubai",
        "display": "Dubai",
        "unit": None,
        "derived": False,
        "entity": {"id": "region:ae-du.dubai", "name": "Dubai", "type": "region"},
        "entities": None,
    }
    assert p["sector"]["value"] == ["sector:logistics-trade"]
    assert p["sector"]["entity"] is None
    assert p["sector"]["entities"] == [
        {"id": "sector:logistics-trade", "name": "Logistics and Trade", "type": "sector"}
    ]

    port = props(check("entity", call(sdb, "entity", {"id": "infra:jebel-ali-port"})))
    assert {k: v["display"] for k, v in port.items()} == {
        "kind": "Port",
        "operator": "DP World",
        "place": "United Arab Emirates",
    }
    assert port["kind"]["value"] == "port"

    oil = props(call(sdb, "entity", {"id": "commodity:crude-oil"}))
    assert oil["hs_code"]["display"] == "2709" and oil["benchmark"]["display"] == "Brent, WTI"

    cbam = props(call(sdb, "entity", {"id": "policy:eu-cbam"}))
    assert cbam["issuer"]["entity"] == {"id": "region:eu", "name": "European Union", "type": "region"}
    usmca = props(call(sdb, "entity", {"id": "policy:usmca"}))
    assert [e["id"] for e in usmca["scope"]["entities"]] == ["region:us", "region:mx", "region:ca"]
    assert "issuer" not in usmca  # an agreement between three: no single issuer stated


def test_entity_derived_properties(sdb):
    city = props(check("entity", call(sdb, "entity", {"id": "region:in-gj.ahmedabad"})))
    assert {k: v["display"] for k, v in city.items()} == {
        "level": "City",
        "parent": "Gujarat",
        "country": "India",
        "population": "5,375,000",
    }
    assert all(v["derived"] for v in city.values())
    state = props(call(sdb, "entity", {"id": "region:in-gj"}))
    assert {k: v["display"] for k, v in state.items()} == {
        "level": "State or province",
        "iso_code": "IN-GJ",
        "parent": "India",
    }
    energy = props(call(sdb, "entity", {"id": "sector:energy", "sample": True}))
    assert energy["entity_count"]["kind"] == "number" and energy["entity_count"]["value"] > 10
    forecast_id = sdb.execute(
        "select f.node_id from forecast f join node n on n.id = f.node_id "
        "where n.is_sample order by 1 limit 1"
    ).fetchone()["node_id"]
    fc = props(check("entity", call(sdb, "entity", {"id": forecast_id})))
    assert fc["provider"]["display"] == "Sample forecast"
    assert fc["probability"]["unit"] == "%" and fc["probability"]["display"].endswith("%")
    assert fc["status"]["display"] == "Open"


def test_property_display_formats(sdb):
    sdb.execute(
        """insert into node (id, type, subtype, name, properties) values
           ('org:kg-format', 'organization', 'company', 'Format Co',
            '{"founded": "2024-03", "website": "https://www.format.example/about?x=1", "size": "medium",
              "ticker": "NYSE: FMT"}'),
           ('infra:kg-format-port', 'infrastructure', 'port', 'Format Port',
            '{"capacity": 1234567.5, "capacity_unit": "TEU a year", "operator": "org:kg-format"}'),
           ('policy:kg-format-rule', 'policy', 'regulation', 'Format Rule',
            '{"effective_date": "2026-01-05", "status": "in_force"}')"""
    )
    org = props(check("entity", call(sdb, "entity", {"id": "org:kg-format"})))
    assert {k: v["display"] for k, v in org.items()} == {
        "size": "Medium",
        "founded": "Mar 2024",
        "website": "format.example",
        "ticker": "NYSE: FMT",
    }
    assert org["website"]["value"] == "https://www.format.example/about?x=1"
    port = props(call(sdb, "entity", {"id": "infra:kg-format-port"}))
    assert (
        port["capacity"]["display"] == "1,234,567.5 TEU a year" and port["capacity"]["unit"] == "TEU a year"
    )
    rule = props(call(sdb, "entity", {"id": "policy:kg-format-rule"}))
    assert rule["effective_date"]["display"] == "5 Jan 2026" and rule["status"]["display"] == "In force"


def test_entity_properties_and_connections_follow_their_flags(sdb):
    flag(sdb, "kg.properties", False)
    flag(sdb, "kg.relations", False)
    data = check("entity", call(sdb, "entity", {"id": "org:dp-world"}))
    assert data["properties"] == [] and data["connections"] == []
    assert data["backlinks"] == [] and data["entity"]["facts"]  # the rest is unchanged


# ---------------------------------------------------------------------------
# A2: connections on api.entity
# ---------------------------------------------------------------------------


def test_connections_read_from_each_side(sdb):
    dp = groups(check("entity", call(sdb, "entity", {"id": "org:dp-world"})))
    assert dp[("operates", "out")]["label"] == "Operates"
    assert [i["id"] for i in dp[("operates", "out")]["items"]] == ["infra:jebel-ali-port"]
    port = groups(call(sdb, "entity", {"id": "infra:jebel-ali-port"}))
    assert port[("operates", "in")]["label"] == "Operated by"
    item = port[("operates", "in")]["items"][0]
    assert item == {
        "id": "org:dp-world",
        "name": "DP World",
        "type": "organization",
        "subtype": "company",
        "is_sample": False,
        "confidence": None,
        "edge_id": item["edge_id"],
        "weak": False,
    }
    assert sdb.execute("select src, dst, type from edge where id = %s", (item["edge_id"],)).fetchone() == {
        "src": "org:dp-world",
        "dst": "infra:jebel-ali-port",
        "type": "operates",
    }
    oil = groups(call(sdb, "entity", {"id": "commodity:crude-oil"}))
    assert oil[("produces", "in")]["label"] == "Produced by"
    assert oil[("in_sector", "out")]["label"] == "In sector"
    # A symmetric relation is one group, whichever way the links were stored.
    maersk = groups(call(sdb, "entity", {"id": "org:maersk"}))
    msc = groups(call(sdb, "entity", {"id": "org:msc"}))
    assert maersk[("competes_with", "both")]["count"] == 3
    assert [i["id"] for i in msc[("competes_with", "both")]["items"]] == ["org:maersk"]
    assert ("competes_with", "in") not in msc


def test_connections_are_ordered_by_count_and_capped(sdb):
    india = check("entity", call(sdb, "entity", {"id": "region:in", "sample": True}))["connections"]
    counts = [g["count"] for g in india]
    assert counts == sorted(counts, reverse=True)
    includes = next(g for g in india if g["relation"] == "part_of")
    assert includes["label"] == "Includes" and includes["direction"] == "in"
    assert includes["count"] > 12 and len(includes["items"]) == 12
    news = next(g for g in india if g["relation"] == "mentions")
    assert news["label"] == "In the news" and news["items"][0]["type"] == "story"


def test_connections_follow_the_sample_rule(sdb):
    live = groups(call(sdb, "entity", {"id": "sector:energy", "sample": False}))
    sample = groups(call(sdb, "entity", {"id": "sector:energy", "sample": True}))
    assert sample[("in_sector", "in")]["count"] > live[("in_sector", "in")]["count"]
    assert not any(i["is_sample"] for g in live.values() for i in g["items"])


# ---------------------------------------------------------------------------
# A1: property filters on api.graph and api.local_graph
# ---------------------------------------------------------------------------


def graph(conn: psycopg.Connection, **args: Any) -> dict[str, Any]:
    return check("graph", call(conn, "graph", {"sample": True, "window": "30d", **args}))


def test_graph_where_filters_one_type(sdb):
    orgs = {n["id"] for n in graph(sdb, types=["organization"])["nodes"]}
    energy = graph(
        sdb, types=["organization"], where=[{"prop": "sector", "op": "eq", "value": "sector:energy"}]
    )
    ids = {n["id"] for n in energy["nodes"]}
    assert ids and ids < orgs
    for node_id in ids:
        assert "sector:energy" in props(call(sdb, "entity", {"id": node_id}))["sector"]["value"]
    in_ = graph(
        sdb,
        types=["organization"],
        where=[{"prop": "sector", "op": "in", "value": ["sector:energy", "sector:tech"]}],
    )
    assert ids <= {n["id"] for n in in_["nodes"]}
    # Text: case-insensitive equality and substring.
    ports = graph(sdb, types=["infrastructure"], where=[{"prop": "kind", "op": "eq", "value": "port"}])
    assert ports["nodes"] and all(n["subtype"] == "port" for n in ports["nodes"])
    stories = graph(
        sdb,
        types=["story"],
        where=[
            {"prop": "impact", "op": "eq", "value": "opportunity"},
            {"prop": "magnitude", "op": "gte", "value": 4},
        ],
    )
    for n in stories["nodes"]:
        assert n["impact"] == "opportunity"
    dated = graph(sdb, types=["story"], where=[{"prop": "first_seen", "op": "lte", "value": "1999"}])
    assert dated["nodes"] == []


def test_graph_where_errors(sdb):
    where = [{"prop": "sector", "op": "eq", "value": "sector:energy"}]
    assert error(sdb, "graph", {"where": where}) == "where needs one type"
    assert (
        error(sdb, "graph", {"types": ["organization", "commodity"], "where": where})
        == "where needs one type"
    )
    assert error(
        sdb, "graph", {"types": ["organization"], "where": [{"prop": "colour", "op": "eq", "value": "x"}]}
    ) == ("Unknown property for organization: colour")
    assert "op must be" in error(
        sdb, "graph", {"types": ["organization"], "where": [{"prop": "size", "op": "like", "value": "x"}]}
    )
    assert "works on numbers and dates only" in error(
        sdb, "graph", {"types": ["organization"], "where": [{"prop": "size", "op": "gte", "value": "large"}]}
    )
    assert "needs a number" in error(
        sdb, "graph", {"types": ["infrastructure"], "where": [{"prop": "capacity", "op": "eq", "value": "5"}]}
    )
    assert "contains works on text and lists only" in error(
        sdb,
        "graph",
        {"types": ["organization"], "where": [{"prop": "founded", "op": "contains", "value": "19"}]},
    )
    assert error(sdb, "graph", {"relations": ["befriends"]}) == "Unknown relation: befriends"
    assert error(sdb, "graph", {"direction": "sideways"}) == "direction must be in, out or both"
    flag(sdb, "kg.properties", False)
    assert (
        error(sdb, "graph", {"types": ["organization"], "where": where})
        == "Property filters are switched off"
    )
    flag(sdb, "kg.relations", False)
    assert error(sdb, "local_graph", {"id": "region:in", "relations": ["part_of"]}) == (
        "Relation filters are switched off"
    )


def test_local_graph_types_and_where(sdb):
    base = check("local_graph", call(sdb, "local_graph", {"id": "region:ae", "depth": 2, "sample": True}))
    orgs = check(
        "local_graph",
        call(sdb, "local_graph", {"id": "region:ae", "depth": 2, "sample": True, "types": ["organization"]}),
    )
    assert orgs["focus"] == "region:ae" and orgs["nodes"][0]["id"] == "region:ae"
    assert {n["type"] for n in orgs["nodes"][1:]} == {"organization"}
    assert {n["id"] for n in orgs["nodes"]} <= {n["id"] for n in base["nodes"]}
    dubai = call(
        sdb,
        "local_graph",
        {
            "id": "region:ae",
            "depth": 2,
            "sample": True,
            "types": ["organization"],
            "where": [{"prop": "headquarters", "op": "eq", "value": "region:ae-du.dubai"}],
        },
    )
    assert [n["id"] for n in dubai["nodes"]] == ["region:ae", "org:dp-world"]


# ---------------------------------------------------------------------------
# A2: relation filters, direction and link fields
# ---------------------------------------------------------------------------


def test_links_carry_relation_fields(sdb):
    data = graph(sdb)
    assert data["links"]
    for link in data["links"]:
        assert set(link) >= LINK_FIELDS
        if link["causal"]:
            assert link["relation"] == "drives" and link["polarity"] in (1, -1)
            assert 0 <= link["strength"] <= 1 and link["delayed"] in (True, False, None)
        else:
            assert link["relation"] == link["type"]
            assert link["polarity"] is None and link["strength"] is None and link["delayed"] is None
    entity_links = call(sdb, "entity", {"id": "org:dp-world"})["graph"]["links"]
    assert entity_links and all(set(link) >= LINK_FIELDS for link in entity_links)


def test_graph_relations_keep_only_those_links(sdb):
    data = graph(sdb, relations=["mentions"])
    assert data["links"] and {link["relation"] for link in data["links"]} == {"mentions"}
    causal = graph(sdb, relations=["drives"])
    assert causal["links"] and all(link["causal"] for link in causal["links"])
    # direction needs a focus: accepted, no effect here.
    assert graph(sdb, direction="out")["links"] == graph(sdb)["links"]


def test_local_graph_relations_and_direction(sdb):
    def local(**args: Any) -> dict[str, Any]:
        return check("local_graph", call(sdb, "local_graph", {"id": "org:dp-world", "depth": 1, **args}))

    out = local(relations=["operates", "located_in"], direction="out")
    assert {n["id"] for n in out["nodes"]} == {"org:dp-world", "infra:jebel-ali-port", "region:ae"}
    assert {(lk["source"], lk["relation"]) for lk in out["links"]} >= {
        ("org:dp-world", "operates"),
        ("org:dp-world", "located_in"),
    }
    # Towards the focus: who points at DP World (nothing but news).
    into = local(direction="in", relations=["operates"])
    assert [n["id"] for n in into["nodes"]] == ["org:dp-world"]
    port_in = check(
        "local_graph",
        call(
            sdb,
            "local_graph",
            {"id": "infra:jebel-ali-port", "depth": 1, "direction": "in", "relations": ["operates"]},
        ),
    )
    assert {n["id"] for n in port_in["nodes"]} == {"infra:jebel-ali-port", "org:dp-world"}
    # Out of the port: no operates links leave it; the incoming one isn't shown.
    port_out = call(sdb, "local_graph", {"id": "infra:jebel-ali-port", "depth": 1, "direction": "out"})
    assert "org:dp-world" not in {n["id"] for n in port_out["nodes"]}
    assert not any(lk["target"] == "infra:jebel-ali-port" for lk in port_out["links"])
    # Symmetric relations count both ways.
    rivals = call(
        sdb, "local_graph", {"id": "org:msc", "depth": 1, "direction": "out", "relations": ["competes_with"]}
    )
    assert {n["id"] for n in rivals["nodes"]} == {"org:msc", "org:maersk"}


def test_cascade_links_carry_polarity(sdb):
    focus = sdb.execute(
        "select src_story from causal_link where is_sample and link_type = 'reported' order by id limit 1"
    ).fetchone()["src_story"]
    data = check("cascade", call(sdb, "cascade", {"id": focus}))
    assert data["links"]
    for link in data["links"]:
        assert link["relation"] == "drives" and link["polarity"] in (1, -1)
        assert link["strength"] == link["confidence"] and link["delayed"] == (
            (link["lag_days"] or 0) > 0 if link["lag_days"] is not None else None
        )


# ---------------------------------------------------------------------------
# api.schema
# ---------------------------------------------------------------------------


def test_schema_lists_both_registries_with_counts(sdb):
    data = check("schema", call(sdb, "schema", {"sample": True}))
    types = {t["key"]: t for t in data["types"]}
    assert list(types)[:3] == ["region", "organization", "person"]
    assert (
        types["region"]["count"]
        == sdb.execute("select count(*) as n from node where type = 'region'").fetchone()["n"]
    )
    assert (
        types["organization"]["icon"] == "building" and types["organization"]["tone"] == "type-organization"
    )
    assert [p["key"] for p in types["commodity"]["properties"]] == ["unit", "benchmark", "hs_code"]
    relations = {r["key"]: r for r in data["relations"]}
    assert relations["owns"]["inverse_label"] == "Owned by"
    assert (
        relations["drives"]["causal"]
        and relations["drives"]["count"]
        == sdb.execute("select count(*) as n from causal_link").fetchone()["n"]
    )
    assert relations["drives"]["by_pair"] == [
        {"src_type": "story", "dst_type": "story", "count": relations["drives"]["count"]}
    ]
    mentions = relations["mentions"]
    assert sum(p["count"] for p in mentions["by_pair"]) == mentions["count"]
    assert {p["src_type"] for p in mentions["by_pair"]} == {"story"}
    live = check("schema", call(sdb, "schema", {"sample": False}))
    assert {t["key"]: t["count"] for t in live["types"]}["story"] < types["story"]["count"]


def test_schema_follows_its_flags(sdb):
    flag(sdb, "kg.properties", False)
    flag(sdb, "kg.schema_map", False)
    data = check("schema", call(sdb, "schema", {}))
    assert all(t["properties"] == [] for t in data["types"])
    assert all(r["by_pair"] == [] for r in data["relations"])
    assert any(r["count"] > 0 for r in data["relations"])


def test_web_reader_can_read_the_new_tables(sdb):
    sdb.execute("set local role wg_web_reader")
    for table in ("app_flag", "node_type", "relation_type"):
        assert sdb.execute(f"select count(*) as n from {table}").fetchone()["n"] > 0
    assert call(sdb, "schema", {})["types"]
    assert call(sdb, "entity", {"id": "org:dp-world"})["properties"]
    assert json.dumps(call(sdb, "meta", {})["flags"])


def test_where_filter_operators(sdb):
    sdb.execute(
        """insert into node (id, type, subtype, name, properties) values
           ('org:kg-a', 'organization', 'company', 'A', '{"ticker": "NYSE: ALPHA", "founded": "1904",
             "sector": ["sector:energy", "sector:tech"], "size": "large"}'),
           ('org:kg-b', 'organization', 'company', 'B', '{"ticker": "LSE: BETA", "founded": "2010-06",
             "sector": ["sector:finance"]}'),
           ('org:kg-c', 'organization', 'company', 'C', '{}'),
           ('infra:kg-p', 'infrastructure', 'port', 'P', '{"capacity": 5, "kind": "port"}'),
           ('infra:kg-q', 'infrastructure', 'port', 'Q', '{"capacity": 50.5, "kind": "port"}')"""
    )
    orgs = ["org:kg-a", "org:kg-b", "org:kg-c"]

    def where(node_type: str, ids: list[str], *conds: dict[str, Any]) -> list[str]:
        row = sdb.execute(
            "select api._where_filter(%s, %s, api._where_conditions(%s, %s::jsonb)) as ids",
            (ids, node_type, node_type, json.dumps(list(conds))),
        ).fetchone()
        assert row is not None
        return list(row["ids"])

    assert where("organization", orgs, {"prop": "ticker", "op": "contains", "value": "nyse"}) == ["org:kg-a"]
    assert where("organization", orgs, {"prop": "ticker", "op": "eq", "value": "lse: beta"}) == ["org:kg-b"]
    assert where("organization", orgs, {"prop": "sector", "op": "contains", "value": "sector:tech"}) == [
        "org:kg-a"
    ]
    assert where(
        "organization", orgs, {"prop": "sector", "op": "in", "value": ["sector:finance", "sector:x"]}
    ) == ["org:kg-b"]
    assert where("organization", orgs, {"prop": "founded", "op": "gte", "value": "2000"}) == ["org:kg-b"]
    assert where("organization", orgs, {"prop": "founded", "op": "lte", "value": "1999-12-31"}) == [
        "org:kg-a"
    ]
    assert where(
        "organization",
        orgs,
        {"prop": "founded", "op": "lte", "value": "2020"},
        {"prop": "size", "op": "eq", "value": "large"},
    ) == ["org:kg-a"]
    assert where("organization", orgs) == orgs  # no conditions: every node of the type
    ports = ["infra:kg-q", "infra:kg-p", "org:kg-a"]  # order kept; other types dropped
    assert where("infrastructure", ports, {"prop": "capacity", "op": "gte", "value": 5}) == [
        "infra:kg-q",
        "infra:kg-p",
    ]
    assert where("infrastructure", ports, {"prop": "capacity", "op": "in", "value": [50.5, 7]}) == [
        "infra:kg-q"
    ]
    assert where("infrastructure", ports, {"prop": "capacity", "op": "lte", "value": 10}) == ["infra:kg-p"]
    # Derived values filter too.
    assert where(
        "region",
        ["region:in", "region:in-gj", "region:in-gj.ahmedabad"],
        {"prop": "level", "op": "eq", "value": "city"},
    ) == ["region:in-gj.ahmedabad"]

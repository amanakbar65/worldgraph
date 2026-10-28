"""The graph schema (schema/types.yaml): registry tables, property validation,
relation endpoint rules and causal polarity (migrations 0021 and 0022)."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import psycopg
import pytest
from typer.testing import CliRunner

from worldgraph.cli import app
from worldgraph.schema import load_schema, property_problems, registry_sql
from worldgraph.schema.registry import Schema

ROOT = Path(__file__).resolve().parents[2]
LUCIDE = ROOT / "frontend" / "node_modules" / "lucide-react" / "dist" / "esm" / "icons"
TOKENS = ROOT / "frontend" / "src" / "styles" / "tokens.css"


# ---------------------------------------------------------------------------
# The YAML itself
# ---------------------------------------------------------------------------


def test_schema_has_the_existing_types_and_relations():
    schema = load_schema()
    assert [t.key for t in schema.node_types] == [
        "region",
        "organization",
        "person",
        "commodity",
        "sector",
        "infrastructure",
        "policy",
        "indicator",
        "story",
        "forecast",
        "user_entity",
    ]
    keys = [r.key for r in schema.relation_types]
    assert keys[:14] == [
        "located_in",
        "part_of",
        "owns",
        "subsidiary_of",
        "produces",
        "exports_to",
        "imports_from",
        "depends_on",
        "member_of",
        "competes_with",
        "in_sector",
        "mentions",
        "about",
        "relates_to",
    ]
    assert keys[14:] == ["supplies", "operates", "regulates", "drives"]
    assert [r.key for r in schema.relation_types if r.causal] == ["drives"]
    owns = schema.relation("owns")
    assert owns is not None and (owns.label, owns.inverse_label) == ("Owns", "Owned by")


def test_region_sector_story_and_forecast_properties_are_derived_and_others_stored():
    schema = load_schema()
    for t in schema.node_types:
        derived = {p.derived for p in t.properties}
        if t.key in ("region", "sector", "story", "forecast"):
            assert derived == {True}, t.key
        elif t.properties:
            assert derived == {False}, t.key
    starting = {t.key: [p.key for p in t.properties] for t in schema.node_types}
    assert starting["organization"] == ["sector", "headquarters", "size", "founded", "website", "ticker"]
    assert starting["commodity"] == ["unit", "benchmark", "hs_code"]
    assert starting["policy"] == ["issuer", "effective_date", "status", "scope"]
    assert starting["infrastructure"] == ["kind", "capacity", "capacity_unit", "operator", "place"]
    assert starting["indicator"] == ["unit", "frequency", "source"]
    assert starting["person"] == ["role", "organization"]
    assert not any(p.required for t in schema.node_types for p in t.properties)  # all optional for now


@pytest.mark.skipif(not LUCIDE.exists(), reason="frontend/node_modules is not installed")
def test_icons_are_lucide_icons():
    schema = load_schema()
    icons = {t.icon for t in schema.node_types} | {r.icon for r in schema.relation_types}
    missing = sorted(i for i in icons if not (LUCIDE / f"{i}.mjs").exists())
    assert missing == []


def test_tones_are_css_tokens():
    css = TOKENS.read_text(encoding="utf-8")
    for t in load_schema().node_types:
        assert re.search(rf"--{re.escape(t.tone)}:", css), t.tone


def test_schema_refuses_unknown_types_and_bad_definitions():
    raw: dict[str, Any] = {
        "node_types": [
            {"key": "a", "label": "A", "plural": "As", "icon": "x", "tone": "t", "description": "d"}
        ],
        "relation_types": [
            {
                "key": "r",
                "label": "R",
                "inverse_label": "R by",
                "icon": "x",
                "description": "d",
                "src_types": ["b"],
            }
        ],
    }
    with pytest.raises(ValueError, match="unknown type b"):
        Schema.model_validate(raw)
    raw["relation_types"][0]["src_types"] = ["a"]
    raw["node_types"][0]["properties"] = [{"key": "k", "label": "K", "kind": "choice"}]
    with pytest.raises(ValueError, match="choices go with kind choice"):
        Schema.model_validate(raw)
    raw["node_types"][0]["properties"] = [{"key": "k", "label": "K", "kind": "text", "min": 1}]
    with pytest.raises(ValueError, match="min, max"):
        Schema.model_validate(raw)


def test_wg_schema_sql_prints_the_registry_upserts():
    result = CliRunner().invoke(app, ["schema", "sql"])
    assert result.exit_code == 0, result.output
    assert result.output == registry_sql()
    assert "insert into node_type" in result.output and "insert into relation_type" in result.output
    only = CliRunner().invoke(app, ["schema", "sql", "--only", "relation_types"])
    assert "node_type " not in only.output and '"symmetric"' in only.output


# ---------------------------------------------------------------------------
# The database holds exactly the YAML
# ---------------------------------------------------------------------------

pytestmark_db = pytest.mark.db


@pytestmark_db
def test_node_type_table_matches_the_yaml(db):
    rows = db.execute("select * from node_type order by ord").fetchall()
    assert [dict(r) for r in rows] == load_schema().node_type_rows()


@pytestmark_db
def test_relation_type_table_matches_the_yaml(db):
    rows = db.execute("select * from relation_type order by ord").fetchall()
    assert [dict(r) for r in rows] == load_schema().relation_type_rows()


@pytestmark_db
def test_node_and_edge_types_reference_the_registries(db):
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        db.execute("insert into node (id, type, name) values ('planet:mars', 'planet', 'Mars')")
    db.rollback()
    db.execute(
        "insert into node (id, type, name) values ('region:xa', 'region', 'A'), ('region:xb', 'region', 'B')"
    )
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        db.execute("insert into edge (src, dst, type) values ('region:xa', 'region:xb', 'neighbours')")


# ---------------------------------------------------------------------------
# Property validation: the same rules and messages in Python and SQL
# ---------------------------------------------------------------------------

DATE = "must be a date (YYYY, YYYY-MM or YYYY-MM-DD)"
SIZES = "must be one of: micro, small, medium, large"

# (type, properties, the problems both validators report)
CASES: list[tuple[str, Any, list[str]]] = [
    ("organization", {}, []),
    (
        "organization",
        {
            "sector": ["sector:energy", "sector:tech"],
            "headquarters": "region:in-mh.mumbai",
            "size": "large",
            "founded": "1904",
            "website": "https://www.example.com/about",
            "ticker": "NSE: EXMPL",
        },
        [],
    ),
    ("organization", {"sector": "sector:energy"}, ["sector: must be a list"]),
    ("organization", {"sector": []}, ["sector: must be a list"]),
    ("organization", {"sector": ["commodity:crude-oil"]}, ["sector: must be one of these types: sector"]),
    ("organization", {"sector": ["sector:nope"]}, ["sector: unknown entity sector:nope"]),
    ("organization", {"headquarters": "org:dp-world"}, ["headquarters: unknown place org:dp-world"]),
    ("organization", {"headquarters": 5}, ["headquarters: must be a place id"]),
    ("organization", {"headquarters": "Not an id"}, ["headquarters: must be a place id"]),
    ("organization", {"size": "huge"}, [f"size: {SIZES}"]),
    ("organization", {"size": "Large"}, [f"size: {SIZES}"]),
    ("organization", {"founded": "1904-13"}, [f"founded: {DATE}"]),
    ("organization", {"founded": "2023-02-29"}, [f"founded: {DATE}"]),
    ("organization", {"founded": "2024-02-29"}, []),
    ("organization", {"founded": "2024-03"}, []),
    ("organization", {"founded": 1904}, [f"founded: {DATE}"]),
    ("organization", {"website": "example.com"}, ["website: must be an http(s) link"]),
    ("organization", {"website": "https://"}, ["website: must be an http(s) link"]),
    ("organization", {"ticker": "   "}, ["ticker: must be text"]),
    ("organization", {"ticker": "x" * 301}, ["ticker: must be at most 300 characters"]),
    ("organization", {"ticker": 5}, ["ticker: must be text"]),
    ("organization", {"mystery": 1}, []),  # unknown keys are allowed (listed for review)
    ("organization", {"founded": None}, []),
    ("organization", {"size": "huge", "founded": "x"}, [f"size: {SIZES}", f"founded: {DATE}"]),
    ("commodity", {"hs_code": "2709", "unit": "barrel", "benchmark": "Brent"}, []),
    ("commodity", {"hs_code": "27x"}, ["hs_code: is not in the expected format"]),
    ("infrastructure", {"capacity": -1}, ["capacity: must be at least 0"]),
    ("infrastructure", {"capacity": "12"}, ["capacity: must be a number"]),
    ("infrastructure", {"capacity": True}, ["capacity: must be a number"]),
    ("infrastructure", {"capacity": 1500000.5, "capacity_unit": "TEU a year", "kind": "port"}, []),
    (
        "infrastructure",
        {"kind": "spaceport"},
        [
            "kind: must be one of: port, terminal, canal, strait, chokepoint, sea-route, pipeline, plant, "
            "mine, industrial-zone, data-centre"
        ],
    ),
    ("infrastructure", {"operator": "region:in"}, ["operator: must be one of these types: organization"]),
    ("infrastructure", {"operator": "org:dp-world", "place": "region:ae"}, []),
    (
        "policy",
        {"issuer": "commodity:crude-oil"},
        ["issuer: must be one of these types: organization, region"],
    ),
    ("policy", {"issuer": "region:eu", "status": "in_force", "effective_date": "2026-01-01"}, []),
    ("policy", {"scope": ["region:in", "org:dp-world"]}, ["scope: unknown place org:dp-world"]),
    ("policy", {"scope": ["region:in", 7]}, ["scope: must be a place id"]),
    (
        "indicator",
        {"frequency": "hourly"},
        ["frequency: must be one of: daily, weekly, monthly, quarterly, annual"],
    ),
    ("person", {"organization": "org:rbi", "role": "Governor"}, []),
    ("story", {"impact": "risk"}, ["impact: is read-only (worked out automatically)"]),
    ("region", {"level": "country"}, ["level: is read-only (worked out automatically)"]),
    ("forecast", {}, []),
    ("galaxy", {}, ["unknown type galaxy"]),
    ("organization", [], ["properties must be an object"]),
]


def _sql_problems(conn: psycopg.Connection, node_type: str, props: Any) -> list[str]:
    row = conn.execute(
        "select api._property_problems(%s, %s::jsonb) as p", (node_type, json.dumps(props))
    ).fetchone()
    assert row is not None
    return list(row["p"])


def _resolver(conn: psycopg.Connection):
    def resolve(node_id: str) -> str | None:
        row = conn.execute("select type from node where id = %s", (node_id,)).fetchone()
        return row["type"] if row else None

    return resolve


@pytestmark_db
@pytest.mark.parametrize(("node_type", "props", "expected"), CASES)
def test_python_and_sql_validators_agree(sdb, node_type, props, expected):
    in_sql = _sql_problems(sdb, node_type, props)
    in_python = property_problems(load_schema(), node_type, props, _resolver(sdb))
    assert in_sql == expected
    assert in_python == expected


@pytestmark_db
def test_the_trigger_refuses_bad_values_and_allows_unknown_keys(sdb):
    for props, problem in [
        ({"headquarters": "region:nowhere"}, "unknown place region:nowhere"),
        ({"size": "huge"}, "size: must be one of"),
        ({"website": "ftp://x"}, "website: must be an http(s) link"),
        ({"founded": "soon"}, "founded: must be a date"),
        ({"sector": ["org:rbi"]}, "must be one of these types: sector"),
    ]:
        with pytest.raises(psycopg.errors.CheckViolation, match=re.escape(problem)):
            sdb.execute(
                "update node set properties = %s::jsonb where id = 'org:dp-world'", (json.dumps(props),)
            )
        sdb.rollback()
    sdb.execute("""update node set properties = properties || '{"note": "kept"}' where id = 'org:dp-world'""")
    assert sdb.execute(
        "select properties ->> 'note' as n from node where id = 'org:dp-world'"
    ).fetchone() == {"n": "kept"}
    # Writers that never set properties (the pipeline's stories) are untouched.
    sdb.execute(
        "insert into node (id, type, subtype, name) values ('story:kg-plain', 'story', 'event', 'Plain')"
    )


@pytestmark_db
def test_required_properties_are_enforced(sdb):
    sdb.execute(
        """update node_type set properties = (
               select jsonb_agg(case when d ->> 'key' = 'ticker' then d || '{"required": true}' else d end
                                order by o)
               from jsonb_array_elements(properties) with ordinality as x(d, o))
           where key = 'organization'"""
    )
    with pytest.raises(psycopg.errors.CheckViolation, match="ticker: is required"):
        sdb.execute(
            "insert into node (id, type, name) values ('org:kg-no-ticker', 'organization', 'No ticker')"
        )
    sdb.rollback()
    sdb.execute(
        """update node_type set properties = (
               select jsonb_agg(case when d ->> 'key' = 'ticker' then d || '{"required": true}' else d end
                                order by o)
               from jsonb_array_elements(properties) with ordinality as x(d, o))
           where key = 'organization'"""
    )
    sdb.execute(
        """insert into node (id, type, name, properties)
           values ('org:kg-ticker', 'organization', 'Ticker', '{"ticker": "NYSE: KG"}')"""
    )
    # Python says the same once the YAML says it.
    schema = load_schema()
    org = schema.node_type("organization")
    assert org is not None
    strict_org = org.model_copy(
        update={
            "properties": [
                p.model_copy(update={"required": True}) if p.key == "ticker" else p for p in org.properties
            ]
        }
    )
    strict = schema.model_copy(
        update={"node_types": [strict_org if t.key == "organization" else t for t in schema.node_types]}
    )
    assert property_problems(strict, "organization", {}, lambda _: None) == ["ticker: is required"]


# ---------------------------------------------------------------------------
# Relations: endpoint rules
# ---------------------------------------------------------------------------


@pytestmark_db
def test_new_edges_must_fit_their_relation(sdb):
    ok = [
        ("org:dp-world", "infra:jebel-ali-port", "operates"),
        ("org:msc", "org:maersk", "competes_with"),  # symmetric: either way round
        ("org:dp-world", "org:adani-ports", "supplies"),
        ("policy:eu-cbam", "sector:manufacturing", "regulates"),
        ("forecast:rbi-repo-cut-next-review", "org:rbi", "relates_to"),  # any types
        ("commodity:crude-oil", "commodity:refined-fuels", "drives"),
    ]
    for src, dst, rel in ok:
        sdb.execute(
            "insert into edge (src, dst, type) values (%s, %s, %s) on conflict do nothing", (src, dst, rel)
        )
    bad = [
        ("infra:jebel-ali-port", "org:dp-world", "operates"),
        ("region:in", "story:red-sea-attacks-reroute", "mentions"),
        ("org:dp-world", "region:ae", "part_of"),
        ("sector:energy", "org:dp-world", "in_sector"),
    ]
    for src, dst, rel in bad:
        with pytest.raises(psycopg.errors.CheckViolation, match=f"Relation {rel} does not connect"):
            sdb.execute("insert into edge (src, dst, type) values (%s, %s, %s)", (src, dst, rel))
        sdb.rollback()
    # Changing an edge is checked too.
    with pytest.raises(psycopg.errors.CheckViolation):
        sdb.execute("update edge set type = 'operates' where src = 'org:maersk' and type = 'located_in'")


@pytestmark_db
def test_the_seed_has_no_rule_breaks_and_uses_operates(sdb):
    broken = sdb.execute(
        """select count(*) as n from edge e join node s on s.id = e.src join node d on d.id = e.dst
           where not api._relation_allows(e.type, s.type, d.type)"""
    ).fetchone()
    assert broken == {"n": 0}
    rows = sdb.execute(
        "select src, dst, type from edge where dst = 'infra:jebel-ali-port' and src like 'org:%'"
    )
    assert {(r["src"], r["type"]) for r in rows.fetchall()} == {("org:dp-world", "operates")}


# ---------------------------------------------------------------------------
# Causal links: relation, polarity, strength, delayed
# ---------------------------------------------------------------------------


def _story(conn: psycopg.Connection, sid: str, direction: str | None, sample: bool = False) -> None:
    conn.execute(
        "insert into node (id, type, subtype, name, is_sample) values (%s, 'story', 'event', %s, %s)",
        (sid, sid, sample),
    )
    conn.execute(
        """insert into story (node_id, headline, so_what, event_type, impact, direction, first_seen,
                              analysis_status)
           values (%s, 'A test headline', null, 'test', 'risk', %s, now(), 'pending')""",
        (sid, direction),
    )


def _link(conn: psycopg.Connection, src: str, dst: str, direction: str, **extra: Any) -> dict[str, Any]:
    cols = ["src_story", "dst_story", "link_type", "mechanism", "direction", "confidence", "method", *extra]
    values = [src, dst, "inferred", "raises fuel costs", direction, 0.6, "test", *extra.values()]
    row = conn.execute(
        f"insert into causal_link ({', '.join(cols)}) values ({', '.join(['%s'] * len(cols))}) "
        "returning relation, polarity, strength, delayed, lag_days",
        values,
    ).fetchone()
    assert row is not None
    return dict(row)


@pytestmark_db
def test_polarity_follows_the_cause_story(sdb):
    _story(sdb, "story:kg-up", "up")
    _story(sdb, "story:kg-down", "down")
    _story(sdb, "story:kg-draft", None)
    _story(sdb, "story:kg-effect", "up")
    assert _link(sdb, "story:kg-up", "story:kg-effect", "up")["polarity"] == 1
    assert _link(sdb, "story:kg-down", "story:kg-effect", "up")["polarity"] == -1
    draft = _link(sdb, "story:kg-draft", "story:kg-effect", "down")
    assert draft["polarity"] is None and draft["relation"] == "drives"
    # AI analysis gives the draft a direction: its links' polarity follows.
    sdb.execute("update story set direction = 'down' where node_id = 'story:kg-draft'")
    polarity = sdb.execute("select polarity from causal_link where src_story = 'story:kg-draft'").fetchone()
    assert polarity == {"polarity": 1}
    sdb.execute("update story set direction = 'up' where node_id = 'story:kg-draft'")
    assert sdb.execute("select polarity from causal_link where src_story = 'story:kg-draft'").fetchone() == {
        "polarity": -1
    }
    # A polarity the writer chose stays.
    _story(sdb, "story:kg-other", "up")
    chosen = _link(sdb, "story:kg-other", "story:kg-effect", "up", polarity=-1)
    assert chosen["polarity"] == -1
    sdb.execute("update story set direction = 'down' where node_id = 'story:kg-other'")
    assert sdb.execute("select polarity from causal_link where src_story = 'story:kg-other'").fetchone() == {
        "polarity": -1
    }


@pytestmark_db
def test_causal_link_relation_strength_and_delay(sdb):
    _story(sdb, "story:kg-a", "up")
    _story(sdb, "story:kg-b", "up")
    _story(sdb, "story:kg-c", "up")
    link = _link(sdb, "story:kg-a", "story:kg-b", "up", lag_days=3, strength=0.4)
    assert link["delayed"] is True and link["strength"] == pytest.approx(0.4)
    assert _link(sdb, "story:kg-a", "story:kg-c", "up", lag_days=0)["delayed"] is False
    assert _link(sdb, "story:kg-b", "story:kg-c", "up")["delayed"] is None
    with pytest.raises(psycopg.errors.CheckViolation):
        _link(sdb, "story:kg-c", "story:kg-a", "up", strength=1.5)
    sdb.rollback()
    _story(sdb, "story:kg-a", "up")
    _story(sdb, "story:kg-b", "up")
    with pytest.raises(psycopg.errors.CheckViolation, match="needs a causal relation"):
        _link(sdb, "story:kg-a", "story:kg-b", "up", relation="owns")


@pytestmark_db
def test_seed_links_all_have_a_polarity(sdb):
    rows = sdb.execute(
        """select count(*) filter (where cl.polarity is null) as unknown,
                  count(*) filter (where cl.polarity is distinct from
                                   case when s.direction = cl.direction then 1 else -1 end) as wrong
           from causal_link cl join story s on s.node_id = cl.src_story where cl.is_sample"""
    ).fetchone()
    assert rows == {"unknown": 0, "wrong": 0}

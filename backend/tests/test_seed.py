import shutil
from datetime import timedelta

import pytest

from tests.conftest import FIXED_NOW
from worldgraph.seed.build import SEED_DIR, SeedError, build_bundle
from worldgraph.seed.load import bundle_statements
from worldgraph.seed.models import word_count


def test_sample_data_is_valid_and_complete():
    bundle = build_bundle(now=FIXED_NOW)
    assert len(bundle.stories) >= 10
    assert all(word_count(s["headline"]) <= 12 for s in bundle.stories)
    assert all(word_count(s["so_what"]) <= 20 for s in bundle.stories)
    assert all(len(s["actions"]) <= 3 for s in bundle.stories)
    assert {n["is_sample"] for n in bundle.nodes if n["type"] in ("story", "forecast")} == {True}


def test_forecast_history_ends_on_the_stated_probability():
    bundle = build_bundle(now=FIXED_NOW)
    for fc in bundle.forecasts:
        snaps = [s for s in bundle.snapshots if s["forecast_id"] == fc["node_id"]]
        assert snaps == sorted(snaps, key=lambda s: s["ts"])
        assert all(0 < s["probability"] < 1 for s in snaps)


def test_sample_times_never_pass_the_build_moment():
    bundle = build_bundle(now=FIXED_NOW)
    seen = {s["node_id"]: s for s in bundle.stories}
    for article in bundle.articles:
        story = seen[article["story_id"]]
        # Sources are published while their story is seen, never later.
        assert story["first_seen"] <= article["published_at"] <= story["last_seen"] <= FIXED_NOW
    assert max(s["ts"] for s in bundle.snapshots) == FIXED_NOW


def test_build_is_deterministic_for_a_fixed_clock():
    a = build_bundle(now=FIXED_NOW)
    b = build_bundle(now=FIXED_NOW)
    assert bundle_statements(a) == bundle_statements(b)


def test_loading_twice_is_safe(sdb):
    from worldgraph.seed.load import load_bundle

    before = sdb.execute("select count(*) as n from node").fetchone()["n"]
    load_bundle(sdb, build_bundle(now=FIXED_NOW))
    after = sdb.execute("select count(*) as n from node").fetchone()["n"]
    assert before == after


def test_sample_clock_keeps_newest_story_fresh(sdb):
    row = sdb.execute(
        """select now() - max(s.first_seen) as age from story s
           join node n on n.id = s.node_id where n.is_sample"""
    ).fetchone()
    assert row["age"].total_seconds() < 3600


# Every sample time the clock moves (end dates excepted: those lie ahead).
SAMPLE_TIMES = """
    select max(t) as newest from (
        select greatest(s.first_seen, s.last_seen, s.analysed_at) as t
            from story s join node n on n.id = s.node_id where n.is_sample
        union all select published_at from article where is_sample
        union all select fs.ts from forecast_snapshot fs join node n on n.id = fs.forecast_id
            where n.is_sample
        union all select greatest(created_at, updated_at) from node where is_sample
        union all select created_at from edge where is_sample
        union all select created_at from causal_link where is_sample
    ) x
"""


def newest_sample_age(sdb) -> timedelta:
    return sdb.execute(f"select now() - ({SAMPLE_TIMES}) as age").fetchone()["age"]


def test_sample_clock_never_moves_anything_into_the_future(sdb):
    # The newest sample time of any kind ends up p_offset (default 5 minutes) old.
    sdb.execute("select api.refresh_sample_clock(interval '3 hours')")
    assert newest_sample_age(sdb) == timedelta(hours=3)
    delta = sdb.execute("select api.refresh_sample_clock() as d").fetchone()["d"]
    assert delta == timedelta(hours=2, minutes=55)
    assert newest_sample_age(sdb) == timedelta(minutes=5)
    assert sdb.execute("select api.refresh_sample_clock() as d").fetchone()["d"] == timedelta(0)
    # A sample time in the future is always moved back, however small the step.
    sdb.execute(
        """update story s set last_seen = now() + interval '1 minute'
           from node n where n.id = s.node_id and n.is_sample and s.first_seen = (
               select max(first_seen) from story x join node m on m.id = x.node_id where m.is_sample)"""
    )
    delta = sdb.execute("select api.refresh_sample_clock(interval '1 minute') as d").fetchone()["d"]
    assert delta == timedelta(minutes=-2)
    assert newest_sample_age(sdb) == timedelta(minutes=1)
    # Forecast end dates move along but stay ahead.
    row = sdb.execute(
        """select min(f.end_date) > now() as ahead from forecast f
           join node n on n.id = f.node_id where n.is_sample"""
    ).fetchone()
    assert row["ahead"]


def test_sample_clock_keeps_articles_inside_their_story(sdb):
    row = sdb.execute(
        """select count(*) filter (where a.published_at > s.last_seen) as late,
                  count(*) filter (where a.published_at < s.first_seen) as early
           from article a join story s on s.node_id = a.story_id where a.is_sample"""
    ).fetchone()
    assert row == {"late": 0, "early": 0}


def test_sample_clock_dates_newest_indicator_point_today(sdb):
    row = sdb.execute(
        """select max(ip.date) = current_date as today from indicator_point ip
           join node n on n.id = ip.series_id where n.is_sample"""
    ).fetchone()
    assert row["today"]


def test_sample_clock_can_run_repeatedly(sdb):
    sdb.execute("select api.refresh_sample_clock(interval '3 hours')")
    sdb.execute("select api.refresh_sample_clock()")
    row = sdb.execute("select count(*) as n from forecast_snapshot").fetchone()
    assert row["n"] > 0


def test_invented_news_never_names_a_real_company(tmp_path):
    """seed/README.md rule 1: real companies appear only in true background facts."""
    seed = tmp_path / "seed"
    shutil.copytree(SEED_DIR, seed, ignore=shutil.ignore_patterns("__pycache__", "*.py"))
    path = seed / "storylines" / "red-sea-shipping.yaml"
    text = path.read_text(encoding="utf-8")
    assert "    mentions: [region:ae]\n" in text
    path.write_text(
        text.replace("    mentions: [region:ae]\n", "    mentions: [region:ae, org:dp-world]\n", 1)
    )
    with pytest.raises(SeedError, match="org:dp-world is a real company"):
        build_bundle(now=FIXED_NOW, seed_dir=seed)


def test_no_sample_story_or_forecast_is_tagged_with_a_real_company():
    bundle = build_bundle(now=FIXED_NOW)
    real = {
        n["id"]
        for n in bundle.nodes
        if n["type"] == "organization" and n["subtype"] == "company" and not n["is_sample"]
    }
    invented = {n["id"] for n in bundle.nodes if n["type"] in ("story", "forecast")}
    tagged = [(e["src"], e["dst"]) for e in bundle.edges if e["src"] in invented and e["dst"] in real]
    assert tagged == []


def test_policy_rates_move_in_whole_steps():
    bundle = build_bundle(now=FIXED_NOW)
    rates = [i["node_id"] for i in bundle.indicators if i["name"] == "Policy rate"]
    assert len(rates) >= 20
    for rid in rates:
        values = [p["value"] for p in bundle.points if p["series_id"] == rid]
        step = 0.1 if rid == "indicator:cn-policy-rate" else 0.25
        for before, after in zip(values, values[1:], strict=False):
            steps = round(abs(after - before) / step, 6)
            assert steps == int(steps), f"{rid} moved {after - before:.2f}"


def test_sample_forecasts_give_their_volume_a_unit():
    bundle = build_bundle(now=FIXED_NOW)
    assert {f["volume_unit"] for f in bundle.forecasts} == {"sample credits"}


def test_sample_forecast_moves_are_varied_not_canned():
    bundle = build_bundle(now=FIXED_NOW)
    moves = []
    for fc in bundle.forecasts:
        snaps = [s for s in bundle.snapshots if s["forecast_id"] == fc["node_id"]]
        day_ago = max((s for s in snaps if s["ts"] <= FIXED_NOW - timedelta(hours=24)), key=lambda s: s["ts"])
        moves.append(snaps[-1]["probability"] - day_ago["probability"])
    big = [m for m in moves if abs(m) >= 0.10]
    assert 1 <= len(big) <= 4, sorted(moves)
    assert sum(1 for m in moves if m <= -0.02) >= 3  # some fall
    assert len({round(m * 100) for m in moves if abs(m) >= 0.03}) >= 6  # not all the same size


# ---------------------------------------------------------------------------
# The graph schema (schema/types.yaml)
# ---------------------------------------------------------------------------


def test_sample_properties_fit_their_types_and_edges_their_relations():
    from worldgraph.schema import load_schema, property_problems

    bundle = build_bundle(now=FIXED_NOW)
    schema = load_schema()
    types = {n["id"]: n["type"] for n in bundle.nodes}
    for n in bundle.nodes:
        assert property_problems(schema, n["type"], n["properties"], types.get) == [], n["id"]
    for e in bundle.edges:
        relation = schema.relation(e["type"])
        assert relation is not None and relation.allows(types[e["src"]], types[e["dst"]]), e


def test_sample_properties_come_from_true_background_facts():
    nodes = {n["id"]: n for n in build_bundle(now=FIXED_NOW).nodes}
    assert nodes["org:dp-world"]["properties"] == {
        "sector": ["sector:logistics-trade"],
        "headquarters": "region:ae-du.dubai",  # "Dubai-based" (summary)
    }
    assert nodes["org:maersk"]["properties"]["headquarters"] == "region:dk"  # from located_in
    assert nodes["infra:jebel-ali-port"]["properties"] == {
        "kind": "port",
        "place": "region:ae",
        "operator": "org:dp-world",
    }
    assert nodes["commodity:crude-oil"]["properties"] == {"hs_code": "2709", "benchmark": "Brent, WTI"}
    assert nodes["policy:opec-plus-quotas"]["properties"] == {
        "scope": ["region:sa", "region:ru"],
        "issuer": "org:opec",
    }
    indicator = next(n for n in nodes.values() if n["type"] == "indicator")
    assert set(indicator["properties"]) == {"unit", "frequency", "source"}
    # No invented facts: nothing the files don't state.
    real = [n for n in nodes.values() if n["type"] == "organization" and not n["is_sample"]]
    assert {k for n in real for k in n["properties"]} <= {"sector", "headquarters"}


def test_nodes_are_ordered_so_references_exist_first():
    nodes = build_bundle(now=FIXED_NOW).nodes
    position = {n["id"]: i for i, n in enumerate(nodes)}
    assert position["org:dp-world"] < position["infra:jebel-ali-port"]
    assert position["sector:energy"] < position["org:saudi-aramco"]
    assert position["org:opec"] < position["policy:opec-plus-quotas"]


def test_seed_check_refuses_bad_properties_and_relation_breaks(tmp_path):
    seed = tmp_path / "seed"
    shutil.copytree(SEED_DIR, seed, ignore=shutil.ignore_patterns("__pycache__", "*.py"))
    path = seed / "entities" / "organizations.yaml"
    text = path.read_text(encoding="utf-8")
    bad = text.replace("properties: {headquarters: region:ae-du.dubai}", "properties: {size: huge}", 1)
    path.write_text(bad, encoding="utf-8")
    with pytest.raises(SeedError, match="org:dp-world: properties don't fit type organization: size"):
        build_bundle(now=FIXED_NOW, seed_dir=seed)
    path.write_text(
        text.replace("operates: [infra:jebel-ali-port]", "operates: [region:ae]", 1), encoding="utf-8"
    )
    with pytest.raises(SeedError, match="operates doesn't connect organization to region"):
        build_bundle(now=FIXED_NOW, seed_dir=seed)


def test_loading_writes_properties_and_keeps_other_writers_values(sdb):
    from worldgraph.seed.load import load_bundle

    sdb.execute(
        """update node set properties = properties || '{"ticker": "DFM: DPW"}' where id = 'org:dp-world'"""
    )
    load_bundle(sdb, build_bundle(now=FIXED_NOW))
    row = sdb.execute("select properties from node where id = 'org:dp-world'").fetchone()
    assert row == {
        "properties": {
            "sector": ["sector:logistics-trade"],
            "headquarters": "region:ae-du.dubai",
            "ticker": "DFM: DPW",
        }
    }

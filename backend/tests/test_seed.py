from tests.conftest import FIXED_NOW
from worldgraph.seed.build import build_bundle
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

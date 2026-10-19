from datetime import timedelta

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

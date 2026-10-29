"""Phase A4: history and "as of" dates (migration 0024).

The change log records the live world graph's changes (append-only),
api.graph_as_of / api.local_graph_as_of rebuild the graph at a time, the
retention keeps "as of" exact inside its window, and history.revert undoes
one change. The log's `at` is the time each change was made, so these tests
can replay a sequence inside one (rolled-back) transaction.
"""

from __future__ import annotations

import json
import time
from datetime import UTC, datetime, timedelta
from typing import Any

import psycopg
import pytest
from typer.testing import CliRunner

from tests.contract import call, check
from tests.live_style import save_analysis, write_bulk, write_news
from worldgraph.db import connect

pytestmark = pytest.mark.db


def one(conn: psycopg.Connection, sql: str, *params: Any) -> Any:
    row = conn.execute(sql, params).fetchone()
    assert row is not None
    return next(iter(row.values()))


def log(conn: psycopg.Connection, entity_id: str, after_id: int = 0) -> list[dict[str, Any]]:
    return conn.execute(
        """select id, entity, op, before, after, actor from history.change_log
           where entity_id = %s and id > %s order by id""",
        (entity_id, after_id),
    ).fetchall()


def last_id(conn: psycopg.Connection) -> int:
    return one(conn, "select coalesce(max(id), 0) from history.change_log")


def clock(conn: psycopg.Connection) -> str:
    return one(
        conn, "select to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')"
    )


def error(conn: psycopg.Connection, name: str, args: dict[str, Any]) -> str:
    with pytest.raises(psycopg.errors.RaiseException) as caught:
        call(conn, name, args)
    conn.rollback()
    return str(caught.value).splitlines()[0]


def norm(data: dict[str, Any]) -> dict[str, Any]:
    """A graph response, order-free (as_of fields dropped)."""
    return {
        "nodes": sorted(data["nodes"], key=lambda n: n["id"]),
        "links": sorted(data["links"], key=lambda lk: (lk["causal"], lk["id"])),
        "truncated": data["truncated"],
        **({"focus": data["focus"]} if "focus" in data else {}),
    }


def by_time(conn: psycopg.Connection, stories: list[str]) -> list[str]:
    """Oldest first (the cause, then the effect)."""
    seen = {
        r["node_id"]: r["first_seen"]
        for r in conn.execute(
            "select node_id, first_seen from story where node_id = any(%s)", (stories,)
        ).fetchall()
    }
    return sorted(stories, key=lambda s: seen[s])


def diff(got: dict[str, Any], want: dict[str, Any]) -> str:
    """What differs between two normalised graphs (for assertion messages)."""
    out = []
    for key in ("nodes", "links"):
        a = {json.dumps(x, sort_keys=True) for x in got[key]}
        b = {json.dumps(x, sort_keys=True) for x in want[key]}
        out += [f"only as-of {key}: {x}" for x in sorted(a - b)[:5]]
        out += [f"only live {key}: {x}" for x in sorted(b - a)[:5]]
    return "\n".join(out)


def add_org(conn: psycopg.Connection, oid: str, name: str) -> None:
    conn.execute(
        """insert into node (id, type, subtype, name, source_id, created_by)
           values (%s, 'organization', 'company', %s, 'curated', 'curated')""",
        (oid, name),
    )


# ---------------------------------------------------------------------------
# What is logged
# ---------------------------------------------------------------------------


def test_changes_are_logged_with_their_actor(sdb):
    sdb.execute("select set_config('wg.actor', 'curator:test', true)")
    add_org(sdb, "org:hist-a", "Hist A")
    [ins] = log(sdb, "org:hist-a")
    assert ins["op"] == "insert" and ins["actor"] == "curator:test" and ins["entity"] == "node"
    assert ins["after"]["name"] == "Hist A" and "updated_at" not in ins["after"]
    # Housekeeping only: nothing logged.
    sdb.execute("update node set updated_at = now() + interval '1 hour' where id = 'org:hist-a'")
    assert len(log(sdb, "org:hist-a")) == 1
    sdb.execute("update node set name = 'Hist A2' where id = 'org:hist-a'")
    upd = log(sdb, "org:hist-a")[-1]
    assert upd["op"] == "update" and (upd["before"]["name"], upd["after"]["name"]) == ("Hist A", "Hist A2")
    # Edges, one row each.
    sdb.execute("select set_config('wg.actor', '', true)")  # no actor: 'pipeline'
    edge_id = one(
        sdb,
        """insert into edge (src, dst, type, source_id, created_by)
           values ('org:hist-a', 'region:in', 'located_in', 'curated', 'curated') returning id""",
    )
    sdb.execute("update edge set confidence = 0.4 where id = %s", (edge_id,))
    sdb.execute("update edge set updated_at = now() where id = %s", (edge_id,))  # housekeeping
    sdb.execute("delete from edge where id = %s", (edge_id,))
    rows = log(sdb, str(edge_id))
    assert [(r["entity"], r["op"], r["actor"]) for r in rows] == [
        ("edge", "insert", "pipeline"),
        ("edge", "update", "pipeline"),
        ("edge", "delete", "pipeline"),
    ]
    assert rows[1]["after"]["confidence"] == 0.4 and "confidence" not in rows[1]["before"]
    sdb.execute("delete from node where id = 'org:hist-a'")
    assert log(sdb, "org:hist-a")[-1]["op"] == "delete"


def test_sample_data_is_not_logged(sdb):
    before = last_id(sdb)
    sdb.execute("select api.refresh_sample_clock(interval '1 minute')")
    sdb.execute(
        """update story set headline = 'Sample headline changed'
           where node_id = 'story:red-sea-attacks-reroute'"""
    )
    sdb.execute(
        """insert into node (id, type, name, is_sample, source_id, created_by)
           values ('org:hist-sample', 'organization', 'Sample Co', true, 'sample', 'sample')"""
    )
    sdb.execute(
        "delete from edge where is_sample and type = 'mentions' and src = 'story:red-sea-attacks-reroute'"
    )
    assert last_id(sdb) == before


def test_stories_and_mentions_are_logged_per_story(sdb):
    start = last_id(sdb)
    sdb.execute("select set_config('wg.actor', 'pipeline:news', true)")  # as the pipeline's news job does
    stories = write_news(sdb, "hist-news", 1)
    assert len(stories) == 2
    for sid in stories:
        rows = log(sdb, sid, start)
        nodes = [r for r in rows if r["entity"] == "node"]
        mentions = [r for r in rows if r["entity"] == "mentions"]
        assert [r["op"] for r in nodes] == ["insert"]
        story = nodes[0]["after"]["story"]
        assert story["kind"] == "event" and story["analysis_status"] == "pending" and story["first_seen"]
        assert [r["op"] for r in mentions] == ["insert"] and mentions[0]["actor"] == "pipeline:news"
        edges = sdb.execute(
            "select id, dst from edge where src = %s and type = 'mentions' order by id", (sid,)
        ).fetchall()
        assert [(item[0], item[1]) for item in mentions[0]["after"]["add"]] == [
            (e["id"], e["dst"]) for e in edges
        ]
    cause, effect = by_time(sdb, stories)
    # AI analysis: the story's fields change (one row) and its name (one row);
    # mentions: the dropped sector guess and the new entities, one row each.
    mark = last_id(sdb)
    save_analysis(sdb, cause, effect)
    rows = log(sdb, effect, mark)
    assert {r["actor"] for r in rows} == {"ai:test-model"}
    node_rows = [r for r in rows if r["entity"] == "node"]
    assert node_rows and node_rows[0]["after"]["story"]["headline"] == "Freight rates climb at Indian ports"
    assert node_rows[0]["before"]["story"]["analysis_status"] == "pending"
    added = [i[1] for r in rows if r["entity"] == "mentions" and r["after"] for i in r["after"]["add"]]
    assert "commodity:crude-oil" in added
    link = one(sdb, "select id from causal_link where dst_story = %s", effect)
    assert [r["op"] for r in log(sdb, str(link), mark)] == ["insert"]
    # Housekeeping (importance, counts) is not logged.
    mark = last_id(sdb)
    sdb.execute("update story set importance = 77, mention_count = 9 where node_id = %s", (effect,))
    assert last_id(sdb) == mark
    # Deleting a story: its node, its causal links, and one row for all its mentions.
    sdb.execute("delete from node where id = %s", (effect,))
    rows = log(sdb, effect, mark)
    assert {(r["entity"], r["op"]) for r in rows} == {("node", "delete"), ("mentions", "delete")}
    assert len(next(r for r in rows if r["entity"] == "mentions")["before"]["remove"]) >= 3
    assert log(sdb, str(link), mark)[0]["op"] == "delete"


def test_the_log_is_append_only(sdb):
    add_org(sdb, "org:hist-ao", "Append Only")
    cid = log(sdb, "org:hist-ao")[0]["id"]
    for sql in (
        "update history.change_log set actor = 'x' where id = %s",
        "delete from history.change_log where id = %s",
    ):
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            sdb.execute(sql, (cid,))
        sdb.rollback()
        add_org(sdb, "org:hist-ao", "Append Only")
        cid = log(sdb, "org:hist-ao")[-1]["id"]
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        sdb.execute("truncate history.change_log")
    sdb.rollback()
    # Even the retention can only delete rows past the window.
    add_org(sdb, "org:hist-ao", "Append Only")
    cid = log(sdb, "org:hist-ao")[-1]["id"]
    sdb.execute("select set_config('wg.history_prune', 'on', true)")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        sdb.execute("delete from history.change_log where id = %s", (cid,))
    sdb.rollback()
    rights = sdb.execute(
        """select has_table_privilege('wg_web_reader', 'history.change_log', 'select') as sel,
                  has_table_privilege('wg_web_reader', 'history.change_log', 'update') as upd,
                  has_table_privilege('wg_web_reader', 'history.change_log', 'delete') as del,
                  has_function_privilege('wg_web_reader', 'history.revert(bigint, boolean)', 'execute')
                      as rev,
                  has_function_privilege('wg_web_reader', 'history.prune(integer)', 'execute') as pru"""
    ).fetchone()
    assert rights == {"sel": True, "upd": False, "del": False, "rev": False, "pru": False}


# ---------------------------------------------------------------------------
# As of
# ---------------------------------------------------------------------------


# Depth 1: deeper, a country expands to its 12 most active states, and
# activity there counts sample stories too, which have no history.
FOCUS = {"org:hist-s1": 1, "commodity:crude-oil": 1}


def snapshot(conn: psycopg.Connection, focus: list[str]) -> dict[str, Any]:
    out = {"at": None, "graph": norm(call(conn, "graph", {"sample": False, "window": "30d"}))}
    for f in focus:
        out[f] = norm(call(conn, "local_graph", {"id": f, "depth": FOCUS[f], "sample": False}))
    out["at"] = clock(conn)
    return out


def test_as_of_replays_a_scripted_sequence(sdb):
    """Changes in steps; at each step the live graph is kept, then as_of(t)
    of every step must equal it (including links that end by their valid dates)."""
    focus = list(FOCUS)
    steps = []
    # 1. News arrives, a curated company appears, linked to crude oil.
    stories = by_time(sdb, write_news(sdb, "hist-seq", 2))
    add_org(sdb, "org:hist-s1", "Seq One")
    sdb.execute(
        """insert into edge (src, dst, type, source_id, created_by) values
           ('org:hist-s1', 'commodity:crude-oil', 'depends_on', 'curated', 'curated'),
           ('org:hist-s1', 'region:in', 'located_in', 'curated', 'curated')"""
    )
    steps.append(snapshot(sdb, focus))
    # 2. AI analysis rewrites the stories and links them; a second company.
    save_analysis(sdb, stories[0], stories[1])
    add_org(sdb, "org:hist-s2", "Seq Two")
    sdb.execute(
        """insert into edge (src, dst, type, source_id, created_by)
           values ('org:hist-s2', 'org:hist-s1', 'owns', 'curated', 'curated')"""
    )
    steps.append(snapshot(sdb, focus))
    # 3. The ownership ended yesterday (valid_to), a link is removed, a
    #    company is renamed, a mention goes.
    sdb.execute("update edge set valid_to = current_date - 1 where src = 'org:hist-s2' and type = 'owns'")
    sdb.execute("delete from edge where src = 'org:hist-s1' and type = 'located_in'")
    sdb.execute("update node set name = 'Seq One Renamed' where id = 'org:hist-s1'")
    sdb.execute(
        "delete from edge where src = %s and type = 'mentions' and dst = 'commodity:crude-oil'", (stories[1],)
    )
    steps.append(snapshot(sdb, focus))
    # 4. A story is deleted (retention), a company too.
    sdb.execute("delete from node where id = %s", (stories[0],))
    sdb.execute("delete from node where id = 'org:hist-s2'")
    steps.append(snapshot(sdb, focus))

    owns = [[lk for lk in s["org:hist-s1"]["links"] if lk["type"] == "owns"] for s in steps]
    assert [len(x) for x in owns] == [0, 1, 0, 0], "the ended ownership leaves the graph"
    assert any(n["name"] == "Seq One Renamed" for n in steps[2]["org:hist-s1"]["nodes"])
    for i, step in enumerate(steps):
        got = check(
            "graph_as_of", call(sdb, "graph_as_of", {"at": step["at"], "sample": False, "window": "30d"})
        )
        assert got["as_of"] and got["history_starts"]
        assert norm(got) == step["graph"], f"graph as of step {i + 1}\n" + diff(norm(got), step["graph"])
        for f in focus:
            local = check(
                "local_graph_as_of",
                call(
                    sdb, "local_graph_as_of", {"at": step["at"], "id": f, "depth": FOCUS[f], "sample": False}
                ),
            )
            assert not local["truncated"]
            assert norm(local) == step[f], f"{f} as of step {i + 1}\n" + diff(norm(local), step[f])
    # The live graph and "as of now" agree.
    assert norm(call(sdb, "graph_as_of", {"at": clock(sdb), "sample": False})) == steps[-1]["graph"]
    # A node that did not exist yet is not found.
    assert error(
        sdb, "local_graph_as_of", {"at": steps[0]["at"], "id": "org:hist-nope", "depth": 1}
    ).startswith("Not found")


def test_as_of_follows_valid_dates_over_days(sdb):
    """History from days ago (rows written as the triggers would have):
    a link valid until 5 days ago shows a week ago, and not 3 days ago."""
    sdb.execute("update history.info set started_at = now() - interval '10 days'")
    for oid, name in (("org:hist-v1", "Valid One"), ("org:hist-v2", "Valid Two")):
        sdb.execute(
            """insert into history.change_log (at, entity, entity_id, op, after, actor)
               values (now() - interval '9 days', 'node', %s, 'insert',
                       jsonb_build_object('id', %s::text, 'type', 'organization', 'subtype', 'company',
                                          'name', %s::text, 'is_sample', false,
                                          'created_at', now() - interval '9 days'), 'curated')""",
            (oid, oid, name),
        )
    sdb.execute(
        """insert into history.change_log (at, entity, entity_id, op, after, actor)
           values (now() - interval '9 days', 'edge', '987654321', 'insert',
                   jsonb_build_object('id', 987654321, 'src', 'org:hist-v1', 'dst', 'org:hist-v2',
                                      'type', 'owns',
                                      'is_sample', false, 'created_at', now() - interval '9 days',
                                      'valid_to', (current_date - 5)::text), 'curated')"""
    )

    def owned(days_ago: int) -> bool:
        at = (datetime.now(UTC) - timedelta(days=days_ago)).isoformat()
        data = call(sdb, "local_graph_as_of", {"at": at, "id": "org:hist-v1", "depth": 1, "sample": False})
        return any(lk["type"] == "owns" and lk["id"] == 987654321 for lk in data["links"])

    assert owned(7) and not owned(3)
    day = (datetime.now(UTC) - timedelta(days=6)).date().isoformat()
    data = call(sdb, "local_graph_as_of", {"at": day, "id": "org:hist-v1", "depth": 1})
    assert data["as_of"].startswith(day) and any(lk["type"] == "owns" for lk in data["links"])
    assert error(sdb, "local_graph_as_of", {"at": "2020-01-01", "id": "org:hist-v1", "depth": 1}) == (
        "History starts on "
        + one(sdb, "select to_char((now() - interval '10 days') at time zone 'UTC', 'FMDD Mon YYYY')")
    )


def test_as_of_errors_and_flag(sdb):
    assert error(sdb, "graph_as_of", {"sample": False}) == "at is required: a date (YYYY-MM-DD) or a time"
    assert error(sdb, "graph_as_of", {"at": "last tuesday"}) == "at must be a date (YYYY-MM-DD) or a time"
    assert error(sdb, "graph_as_of", {"at": "1999-12-31"}).startswith("History starts on ")
    future = check("graph_as_of", call(sdb, "graph_as_of", {"at": "2999-01-01", "sample": False}))
    assert datetime.fromisoformat(future["as_of"]) <= datetime.now(UTC)
    sdb.execute("update app_flag set enabled = false where key = 'kg.history'")
    assert error(sdb, "graph_as_of", {"at": "2999-01-01"}) == "History is switched off"
    # A failed as-of call leaves the live graph live.
    assert one(sdb, "select coalesce(current_setting('wg.as_of', true), '')") == ""


def test_web_reader_can_ask_as_of(sdb):
    at = clock(sdb)
    sdb.execute("set local role wg_web_reader")
    assert call(sdb, "local_graph_as_of", {"at": at, "id": "region:in", "depth": 1})["focus"] == "region:in"


# ---------------------------------------------------------------------------
# Retention
# ---------------------------------------------------------------------------


def test_retention_keeps_as_of_exact_inside_the_window(sdb):
    sdb.execute("update history.info set started_at = now() - interval '200 days', pruned_at = null")

    def row(
        days: int, entity: str, eid: str, op: str, after: dict[str, Any] | None, before: Any = None
    ) -> None:
        sdb.execute(
            """insert into history.change_log (at, entity, entity_id, op, before, after, actor)
               values (now() - make_interval(days => %s), %s, %s, %s, %s, %s, 'test')""",
            (
                days,
                entity,
                eid,
                op,
                json.dumps(before) if before else None,
                json.dumps(after) if after else None,
            ),
        )

    def org(oid: str, name: str) -> dict[str, Any]:
        return {"id": oid, "type": "organization", "name": name, "is_sample": False}

    row(150, "node", "org:ret-x", "insert", org("org:ret-x", "X1"))
    row(120, "node", "org:ret-x", "update", org("org:ret-x", "X2"))
    row(10, "node", "org:ret-x", "update", org("org:ret-x", "X3"))
    row(150, "node", "org:ret-y", "insert", org("org:ret-y", "Y"))
    row(95, "node", "org:ret-y", "delete", None, org("org:ret-y", "Y"))
    edge = {"id": 5550001, "src": "org:ret-x", "dst": "region:in", "type": "located_in", "is_sample": False}
    row(150, "edge", "5550001", "insert", edge)
    row(100, "edge", "5550001", "delete", None, edge)
    row(150, "mentions", "story:ret-s", "insert", {"add": [[5550002, "region:in", "2026-01-01T00:00:00Z"]]})
    row(
        100,
        "mentions",
        "story:ret-s",
        "delete",
        None,
        {"remove": [[5550002, "region:in", "2026-01-01T00:00:00Z"]]},
    )
    row(150, "mentions", "story:ret-t", "insert", {"add": [[5550003, "region:cn", "2026-01-01T00:00:00Z"]]})

    def state(days: int) -> dict[str, Any]:
        sdb.execute("select set_config('wg.as_of', (now() - make_interval(days => %s))::text, true)", (days,))
        names = {
            r["id"]: r["name"]
            for r in sdb.execute("select id, name from api._g_nodes where id like 'org:ret-%'").fetchall()
        }
        edges = sorted(
            r["id"]
            for r in sdb.execute(
                "select id from api._g_edges where id between 5550001 and 5550003"
            ).fetchall()
        )
        sdb.execute("select set_config('wg.as_of', '', true)")
        return {"names": names, "edges": edges}

    window = {d: state(d) for d in (89, 50, 5)}
    assert window[89] == {"names": {"org:ret-x": "X2"}, "edges": [5550003]}
    assert window[5]["names"] == {"org:ret-x": "X3"}
    result = one(sdb, "select history.prune(90)")
    assert result["deleted"] == 7  # X1; Y, the edge and story:ret-s's mentions (gone by the cut): two each
    left = {
        (r["entity_id"], r["op"])
        for r in sdb.execute(
            """select entity_id, op from history.change_log
               where entity_id in ('org:ret-x', 'org:ret-y', '5550001', 'story:ret-s', 'story:ret-t')"""
        ).fetchall()
    }
    assert left == {("org:ret-x", "update"), ("story:ret-t", "insert")}  # X2 (latest at the cut) and X3
    assert {d: state(d) for d in (89, 50, 5)} == window, "as of stays the same inside the window"
    starts = one(sdb, "select started_at from history.info")
    assert abs((starts - (datetime.now(UTC) - timedelta(days=90))).total_seconds()) < 60
    at = (datetime.now(UTC) - timedelta(days=95)).isoformat()
    assert error(sdb, "graph_as_of", {"at": at}).startswith("History starts on ")
    # The pipeline's daily check: just pruned, so nothing to do.
    assert one(sdb, "select history.maybe_prune()") == {"pruned": False}
    with pytest.raises(psycopg.errors.RaiseException):
        sdb.execute("select history.prune(7)")


def test_the_prune_job_runs_the_retention(sdb):
    from worldgraph.pipeline.prune import prune

    sdb.execute("update history.info set pruned_at = null")
    counts = prune(sdb)
    assert "history" in counts and one(sdb, "select pruned_at is not null from history.info")


# ---------------------------------------------------------------------------
# Revert (owner corrections)
# ---------------------------------------------------------------------------


def test_revert_undoes_one_change(sdb):
    add_org(sdb, "org:hist-r", "Revert Me")
    sdb.execute("update node set name = 'Wrong Name', summary = 'Oops' where id = 'org:hist-r'")
    update = log(sdb, "org:hist-r")[-1]["id"]
    out = one(sdb, "select history.revert(%s)", update)
    assert out["actor"] == f"owner:revert:{update}" and out["rows"] == 1
    assert sdb.execute("select name, summary from node where id = 'org:hist-r'").fetchone() == {
        "name": "Revert Me",
        "summary": None,
    }
    assert log(sdb, "org:hist-r")[-1]["actor"] == f"owner:revert:{update}"
    # A link added by mistake, then one deleted by mistake.
    edge_id = one(
        sdb,
        """insert into edge (src, dst, type, source_id, created_by)
           values ('org:hist-r', 'region:fr', 'located_in', 'curated', 'curated') returning id""",
    )
    one(sdb, "select history.revert(%s)", log(sdb, str(edge_id))[-1]["id"])
    assert one(sdb, "select count(*) from edge where id = %s", edge_id) == 0
    operates = one(sdb, "select id from edge where src = 'org:dp-world' and type = 'operates'")
    sdb.execute("delete from edge where id = %s", (operates,))
    one(sdb, "select history.revert(%s)", log(sdb, str(operates))[-1]["id"])
    back = sdb.execute("select src, dst, source_id from edge where id = %s", (operates,)).fetchone()
    assert back == {"src": "org:dp-world", "dst": "infra:jebel-ali-port", "source_id": "curated"}
    # A later change blocks an older one, unless forced.
    first = log(sdb, "org:hist-r")[0]["id"]
    with pytest.raises(psycopg.errors.RaiseException, match="A later change touched"):
        sdb.execute("select history.revert(%s)", (first,))
    sdb.rollback()


def test_revert_takes_back_mentions_and_refuses_what_it_cannot(sdb):
    stories = by_time(sdb, write_news(sdb, "hist-rev", 0))
    mark = last_id(sdb)
    save_analysis(sdb, stories[0], stories[1])
    added = next(
        r
        for r in log(sdb, stories[1], mark)
        if r["entity"] == "mentions" and r["after"] and r["op"] == "insert"
    )
    ids = [item[0] for item in added["after"]["add"]]
    one(sdb, "select history.revert(%s)", added["id"])
    assert one(sdb, "select count(*) from edge where id = any(%s)", ids) == 0
    removed = log(sdb, stories[1])[-1]
    assert removed["entity"] == "mentions" and removed["op"] == "delete"
    one(sdb, "select history.revert(%s)", removed["id"])  # undo the undo
    assert one(sdb, "select count(*) from edge where id = any(%s)", ids) == len(ids)
    sdb.execute("delete from node where id = %s", (stories[0],))
    gone = next(r for r in log(sdb, stories[0]) if r["entity"] == "node" and r["op"] == "delete")
    with pytest.raises(psycopg.errors.RaiseException, match="Stories cannot be restored"):
        sdb.execute("select history.revert(%s)", (gone["id"],))
    sdb.rollback()
    snap = one(
        sdb,
        """insert into history.change_log (entity, entity_id, op, after)
           values ('node', 'org:hist-snap', 'snapshot', '{}') returning id""",
    )
    with pytest.raises(psycopg.errors.RaiseException, match="where history starts"):
        sdb.execute("select history.revert(%s)", (snap,))
    sdb.rollback()


def test_wg_history_cli(seeded_db_url, monkeypatch):
    from worldgraph.cli import app
    from worldgraph.config import get_settings

    with connect(seeded_db_url) as conn:
        add_org(conn, "org:hist-cli", "CLI Co")
        conn.commit()
        change = log(conn, "org:hist-cli")[-1]["id"]
    monkeypatch.setenv("DATABASE_URL", seeded_db_url)
    get_settings.cache_clear()
    shown = CliRunner().invoke(app, ["history", "show", "org:hist-cli"])
    assert shown.exit_code == 0 and "insert" in shown.output and str(change) in shown.output
    reverted = CliRunner().invoke(app, ["history", "revert", str(change)])
    assert reverted.exit_code == 0, reverted.output
    with connect(seeded_db_url) as conn:
        assert one(conn, "select count(*) from node where id = 'org:hist-cli'") == 0


# ---------------------------------------------------------------------------
# Production scale
# ---------------------------------------------------------------------------


def test_history_at_production_scale(sdb):
    """~5,000 live stories, ~32,000 articles, ~38,000 edges: the log stays
    small (one row per story and statement for mentions), and as-of answers
    in seconds and equals the live graph."""
    mark = last_id(sdb)
    started = time.perf_counter()
    counts = write_bulk(sdb, "hist-bulk", stories=5000)
    written = time.perf_counter() - started
    sdb.execute("analyze history.change_log")  # autovacuum does this in production
    rows = {
        r["entity"]: r["n"]
        for r in sdb.execute(
            "select entity, count(*) as n from history.change_log where id > %s group by entity", (mark,)
        ).fetchall()
    }
    # One node row and one mentions row per story (~6 mentions each), one per
    # causal link, forecast and about link.
    assert rows == {"node": 5300, "mentions": 5000, "causal_link": 1500, "edge": rows["edge"]}, rows
    assert rows["edge"] <= 900
    assert counts["edges"] > 30000 and written < 60
    live = norm(call(sdb, "graph", {"sample": False, "window": "30d"}))
    local = norm(call(sdb, "local_graph", {"id": "region:in", "depth": 2, "sample": False}))
    at = clock(sdb)
    started = time.perf_counter()
    as_of = call(sdb, "graph_as_of", {"at": at, "sample": False, "window": "30d"})
    graph_s = time.perf_counter() - started
    started = time.perf_counter()
    local_as_of = call(sdb, "local_graph_as_of", {"at": at, "id": "region:in", "depth": 2, "sample": False})
    local_s = time.perf_counter() - started
    assert norm(as_of) == live
    assert {n["id"] for n in local_as_of["nodes"]} == {n["id"] for n in local["nodes"]} or local["truncated"]
    assert graph_s < 6 and local_s < 6, (graph_s, local_s)

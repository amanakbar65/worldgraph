"""The website's AI budget in SQL: api._ai_reserve and api._ai_settle (0015).

The website logs in as a member of wg_web_reader, which can read tables but
not write them. These functions are its only way to log AI usage, and the
lock inside api._ai_reserve keeps concurrent calls under the daily cap.
"""

from __future__ import annotations

from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal

import psycopg
import pytest

from worldgraph.db import connect

RESERVE = "select api._ai_reserve(%s, %s, %s::numeric, %s::numeric) as id"
SETTLE = "select api._ai_settle(%s, %s, %s::integer, %s::integer, %s::numeric) as found"
TODAY = (
    "select coalesce(sum(cost_usd), 0) as spent from llm_usage "
    "where at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'"
)


def spent(conn: psycopg.Connection) -> Decimal:
    return conn.execute(TODAY).fetchone()["spent"]  # type: ignore[index]


@pytest.fixture
def web(db: psycopg.Connection) -> Iterator[psycopg.Connection]:
    """The test connection acting as the website's role."""
    db.execute("set role wg_web_reader")
    yield db
    db.rollback()  # also undoes the set role


def test_web_role_cannot_write_usage_directly(web):
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        web.execute("insert into llm_usage (engine, model, purpose, cost_usd) values ('api', 'm', 'ask', 0)")


def test_web_role_reserves_and_settles(web):
    before = spent(web)
    rid = web.execute(RESERVE, ("ask", "claude-opus-5-5", 0.25, 100)).fetchone()["id"]
    assert rid is not None
    assert spent(web) == before + Decimal("0.25")

    assert web.execute(SETTLE, (rid, "claude-opus-5", 1200, 300, 0.0123)).fetchone()["found"] is True
    assert spent(web) == before + Decimal("0.0123")
    row = web.execute("select * from llm_usage where id = %s", (rid,)).fetchone()
    assert row is not None
    assert (row["model"], row["purpose"], row["input_tokens"], row["output_tokens"], row["reserved"]) == (
        "claude-opus-5",
        "ask",
        1200,
        300,
        False,
    )
    # A settled row never changes again.
    assert web.execute(SETTLE, (rid, None, 0, 0, 0)).fetchone()["found"] is False
    assert spent(web) == before + Decimal("0.0123")


def test_reserve_refuses_what_does_not_fit(db):
    db.execute(
        "insert into llm_usage (engine, model, purpose, cost_usd) values ('api', 'm', 'analysis', 1.9)"
    )
    budget = spent(db) + Decimal("0.1")  # 10 cents left today
    assert db.execute(RESERVE, ("ask", "claude-opus-5-5", 0.11, budget)).fetchone()["id"] is None
    assert db.execute(RESERVE, ("projection", "claude-opus-5-5", 0.1, budget)).fetchone()["id"] is not None
    assert db.execute(RESERVE, ("ask", "claude-opus-5-5", 0.01, budget)).fetchone()["id"] is None


def test_yesterdays_spend_does_not_count(db):
    db.execute(
        "insert into llm_usage (at, engine, model, purpose, cost_usd) "
        "values (now() - interval '2 days', 'api', 'm', 'ask', 50)"
    )
    assert db.execute(RESERVE, ("ask", "claude-opus-5-5", 0.2, spent(db) + 1)).fetchone()["id"] is not None


@pytest.mark.parametrize(
    "args",
    [
        ("analysis", "claude-opus-5-5", 0.1, 2),  # analysis belongs to the pipeline
        ("ask", "Robert'); drop table llm_usage;--", 0.1, 2),
        ("ask", "claude-opus-5-5", 0, 2),  # a reservation must count something
        ("ask", "claude-opus-5-5", 50, 100),
        ("ask", "claude-opus-5-5", 0.1, -1),
    ],
)
def test_reserve_checks_its_arguments(web, args):
    with pytest.raises(psycopg.errors.RaiseException):
        web.execute(RESERVE, args)


def test_settle_touches_only_open_reservations_from_the_last_hour(db):
    db.execute("insert into llm_usage (engine, model, purpose, cost_usd) values ('api', 'm', 'ask', 0.3)")
    plain = db.execute("select max(id) as id from llm_usage").fetchone()["id"]  # type: ignore[index]
    assert db.execute(SETTLE, (plain, None, 0, 0, 0)).fetchone()["found"] is False

    old = db.execute(RESERVE, ("ask", "claude-opus-5-5", 0.3, 1000)).fetchone()["id"]
    db.execute("update llm_usage set at = now() - interval '2 hours' where id = %s", (old,))
    assert db.execute(SETTLE, (old, None, 0, 0, 0)).fetchone()["found"] is False

    with pytest.raises(psycopg.errors.RaiseException):
        db.execute(SETTLE, (old, None, 0, 0, -1))


def test_only_the_web_role_may_call_the_budget_functions(db):
    rows = db.execute(
        """select p.proname, r.rolname
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           cross join lateral aclexplode(p.proacl) a
           left join pg_roles r on r.oid = a.grantee
           where n.nspname = 'api' and p.proname in ('_ai_reserve', '_ai_settle')
             and a.privilege_type = 'EXECUTE'"""
    ).fetchall()
    grantees = {(r["proname"], r["rolname"]) for r in rows}
    assert ("_ai_reserve", "wg_web_reader") in grantees
    assert ("_ai_settle", "wg_web_reader") in grantees
    # No PUBLIC grant (grantee 0 has no role row).
    assert all(rolname is not None for _, rolname in grantees)


def test_concurrent_reservations_stay_under_the_cap(migrated_db_url):
    """Twenty calls at once with $1 left: only four reservations of 25 cents fit."""
    with connect(migrated_db_url, autocommit=True) as admin:
        start = spent(admin)
        marker = admin.execute(
            "insert into llm_usage (engine, model, purpose, cost_usd) values ('api', 'm', 'analysis', 0) "
            "returning id"
        ).fetchone()["id"]  # type: ignore[index]
    budget = start + 1

    def reserve(_: int) -> int | None:
        with connect(migrated_db_url, autocommit=True) as conn:
            conn.execute("set role wg_web_reader")
            return conn.execute(RESERVE, ("ask", "claude-opus-5-5", 0.25, budget)).fetchone()["id"]  # type: ignore[index]

    try:
        with ThreadPoolExecutor(max_workers=20) as pool:
            ids = list(pool.map(reserve, range(20)))
        granted = [i for i in ids if i is not None]
        assert len(granted) == 4
        with connect(migrated_db_url, autocommit=True) as admin:
            assert spent(admin) == start + 1
    finally:
        with connect(migrated_db_url, autocommit=True) as admin:
            admin.execute("delete from llm_usage where id >= %s", (marker,))

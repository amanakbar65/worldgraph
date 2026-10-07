"""Sync every enabled forecast provider (hourly)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import httpx
import psycopg

from worldgraph.pipeline.entities import load_matcher
from worldgraph.pipeline.forecasts import manifold, polymarket
from worldgraph.pipeline.forecasts.common import upsert
from worldgraph.pipeline.places import load_places

MAX_NEW_PER_RUN = 40  # new questions get a history backfill (one extra request each)
MAX_OPEN = 200  # questions kept open per provider


def enabled_providers(conn: psycopg.Connection) -> set[str]:
    with conn.cursor() as cur:
        cur.execute("select id from forecast_provider where enabled and id <> 'sample'")
        return {r["id"] for r in cur.fetchall()}


def sync_manifold(conn: psycopg.Connection, client: httpx.Client, now: datetime) -> dict[str, Any]:
    places, matcher = load_places(), load_matcher(conn)
    found = manifold.search(client, now)
    with conn.cursor() as cur:
        cur.execute("select provider_ref from forecast where provider = 'manifold'")
        known = {r["provider_ref"] for r in cur.fetchall()}
    # Keep the most-traded questions; new ones only up to the per-run budget.
    found.sort(key=lambda m: -m.volume)
    stats = {"seen": len(found), "new": 0, "updated": 0, "closed": 0}
    new_budget = MAX_NEW_PER_RUN
    open_count = 0
    for m in found:
        if open_count >= MAX_OPEN:
            break
        if m.ref not in known:
            if new_budget <= 0:
                continue
            new_budget -= 1
            m.history = manifold.history(client, m.ref, now)
        upsert(conn, m, places, matcher, now)
        stats["new" if m.ref not in known else "updated"] += 1
        open_count += 1
    # Questions we show that dropped out of the search (closed, resolved): refresh them.
    seen_refs = {m.ref for m in found}
    with conn.cursor() as cur:
        cur.execute(
            "select provider_ref, category from forecast where provider = 'manifold' and status = 'open' "
            "and not (provider_ref = any(%s))",
            (list(seen_refs),),
        )
        stale = cur.fetchall()
    for row in stale[:60]:
        m = manifold.market(client, row["provider_ref"], row["category"], now)
        if m is None:
            continue
        if m.status == "open":
            m.status = "closed"  # no longer passes our filters: stop showing it as live
        upsert(conn, m, places, matcher, now)
        stats["closed"] += 1
    return stats


def sync_polymarket(conn: psycopg.Connection, client: httpx.Client, now: datetime) -> dict[str, Any]:
    places, matcher = load_places(), load_matcher(conn)
    markets = polymarket.search(client, now)
    for m in markets:
        upsert(conn, m, places, matcher, now)
    return {"seen": len(markets)}


def sync_all(conn: psycopg.Connection, client: httpx.Client | None = None) -> dict[str, Any]:
    from worldgraph.pipeline.run import http_client

    now = datetime.now(UTC)
    providers = enabled_providers(conn)
    stats: dict[str, Any] = {}
    own = client is None
    client = client or http_client()
    try:
        if "manifold" in providers:
            stats["manifold"] = sync_manifold(conn, client, now)
        if "polymarket" in providers:  # off unless the owner enables it
            stats["polymarket"] = sync_polymarket(conn, client, now)
    finally:
        if own:
            client.close()
    with conn.cursor() as cur:
        # Resolved questions disappear a month after resolution.
        cur.execute(
            "delete from node n using forecast f where n.id = f.node_id and not n.is_sample "
            "and f.status <> 'open' and f.end_date < now() - interval '30 days'"
        )
        stats["removed"] = cur.rowcount
    return stats

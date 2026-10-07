"""Run pipeline jobs and log each run in `ingest_run`.

`wg pipeline run` (every 15 minutes in GitHub Actions) does, in order:
news → forecasts (every hour) → prune (every 6 hours) → AI analysis (only
when an Anthropic key is set). Each job commits on its own, so one failing
source never loses the others' work.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import psycopg

from worldgraph.pipeline import cluster, store
from worldgraph.pipeline.embed import Embedder
from worldgraph.pipeline.entities import load_matcher
from worldgraph.pipeline.items import Item
from worldgraph.pipeline.places import load_places

log = logging.getLogger("worldgraph.pipeline")

USER_AGENT = "WorldGraph/0.1 (+https://github.com/amanakbar65/worldgraph)"
STRONG_SINGLE = 14.0  # a lone GDELT item needs this score to start a story


def http_client() -> httpx.Client:
    return httpx.Client(
        timeout=httpx.Timeout(30, connect=10),
        follow_redirects=True,
        headers={"User-Agent": USER_AGENT},
    )


def logged(conn: psycopg.Connection, job: str, fn: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    """Run one job in its own transaction and record the outcome."""
    with conn.cursor() as cur:
        cur.execute("insert into ingest_run (job) values (%s) returning id", (job,))
        run_id = cur.fetchone()["id"]  # type: ignore[index]
    conn.commit()
    started = time.monotonic()
    try:
        stats = fn()
        conn.commit()
        ok, error = True, None
    except Exception as exc:  # recorded, then re-raised by the caller's choice
        conn.rollback()
        stats, ok, error = {}, False, f"{type(exc).__name__}: {exc}"[:2000]
        log.exception("job %s failed", job)
    stats = {**stats, "seconds": round(time.monotonic() - started, 1)}
    with conn.cursor() as cur:
        cur.execute(
            "update ingest_run set finished_at = now(), ok = %s, stats = %s::jsonb, error = %s where id = %s",
            (ok, json.dumps(stats, default=str), error, run_id),
        )
    conn.commit()
    return {"ok": ok, "error": error, **stats}


def due(conn: psycopg.Connection, job: str, every: timedelta) -> bool:
    with conn.cursor() as cur:
        cur.execute("select max(started_at) as last from ingest_run where job = %s and ok", (job,))
        last = cur.fetchone()["last"]  # type: ignore[index]
    return last is None or datetime.now(UTC) - last >= every


# -- news ------------------------------------------------------------------------


def collect(
    conn: psycopg.Connection, client: httpx.Client, sources: tuple[str, ...], now: datetime
) -> tuple[list[Item], dict[str, Any]]:
    from worldgraph.pipeline.sources import gdelt, hazards, rss

    places = load_places()
    state = store.get_state(conn, "news") or {}
    items: list[Item] = []
    stats: dict[str, Any] = {}
    if "gdelt" in sources:
        try:
            found, cursor, s = gdelt.fetch(client, places, state.get("gdelt_last"))
            items += found
            state["gdelt_last"] = cursor
            stats["gdelt"] = {**s, "items": len(found)}
        except (httpx.HTTPError, RuntimeError) as exc:
            stats["gdelt"] = {"error": f"{type(exc).__name__}: {exc}"[:300]}
    if "rss" in sources:
        found, feed_state, s = rss.fetch(client, places, state.get("rss") or {}, now=now)
        items += found
        state["rss"] = feed_state
        stats["rss"] = {**s, "items": len(found)}
    if "hazards" in sources:
        found, s = hazards.fetch(client, places, now=now)
        items += found
        stats["hazards"] = {**s, "items": len(found)}
    store.set_state(conn, "news", state)
    return items, stats


def process(conn: psycopg.Connection, items: list[Item], embedder: Embedder, now: datetime) -> dict[str, Any]:
    """Dedupe, tag, embed, cluster and store a batch of items."""
    unique: dict[str, Item] = {}
    for item in items:
        if item.url and item.url not in unique:
            unique[item.url] = item
    known = store.known_urls(conn, list(unique))
    fresh = [i for u, i in unique.items() if u not in known]
    stats: dict[str, Any] = {"collected": len(items), "new": len(fresh)}
    if not fresh:
        stats["reranked"] = store.refresh_importance(conn, now)
        return stats

    matcher = load_matcher(conn)
    for item in fresh:
        item.entities = matcher.match(" ".join([item.title, *item.orgs]))
    for item, vector in zip(fresh, embedder.embed([i.title for i in fresh]), strict=True):
        item.embedding = vector

    groups = cluster.group_items(fresh, cluster.nearest_stories(conn, fresh))
    kept = [
        g
        for g in groups
        if g.story_id is not None
        or len(g.items) > 1
        or g.items[0].hazard
        or g.items[0].provider != "gdelt"
        or g.items[0].score >= STRONG_SINGLE
    ]
    stats["dropped_weak_singles"] = len(groups) - len(kept)
    stats.update(store.write_groups(conn, kept, now))
    return stats


def run_news(
    conn: psycopg.Connection,
    embedder: Embedder,
    *,
    client: httpx.Client | None = None,
    sources: tuple[str, ...] = ("gdelt", "rss", "hazards"),
) -> dict[str, Any]:
    now = datetime.now(UTC)
    own_client = client is None
    client = client or http_client()
    try:
        items, collect_stats = collect(conn, client, sources, now)
    finally:
        if own_client:
            client.close()
    return {**collect_stats, **process(conn, items, embedder, now)}

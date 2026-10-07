"""Manifold (play-money crowd forecasts): public API, no key needed.

We read open yes/no questions in business topics with enough forecasters,
store the probability every hour and backfill 30 days of history once.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import httpx

from worldgraph.pipeline.forecasts.common import Market, allowed, category_for, clean_question, downsample

API = "https://api.manifold.markets/v0"

# Manifold topic → our category.
TOPICS: dict[str, str] = {
    "economics-default": "economy",
    "global-macro": "economy",
    "us-economy": "economy",
    "inflation": "economy",
    "interest-rates": "finance",
    "finance": "finance",
    "stocks": "finance",
    "energy": "energy",
    "oil": "energy",
    "geopolitics": "geopolitics",
    "china": "geopolitics",
    "india": "economy",
}
MIN_FORECASTERS = 15
MIN_VOLUME = 1000.0
MAX_YEARS_AHEAD = 3


def _dt(ms: int | None) -> datetime | None:
    return datetime.fromtimestamp(ms / 1000, tz=UTC) if ms else None


def to_market(raw: dict[str, Any], category: str, now: datetime) -> Market | None:
    if raw.get("outcomeType") != "BINARY" or raw.get("token", "MANA") != "MANA":
        return None
    question = clean_question(raw.get("question") or "")
    if not question or not allowed(question, now):
        return None
    if (raw.get("uniqueBettorCount") or 0) < MIN_FORECASTERS or (raw.get("volume") or 0) < MIN_VOLUME:
        return None
    end = _dt(raw.get("closeTime"))
    if end is not None and (end - now).days > 365 * MAX_YEARS_AHEAD:
        return None
    resolved = bool(raw.get("isResolved"))
    status = "resolved" if resolved else ("closed" if end is not None and end < now else "open")
    prob = raw.get("probability")
    if prob is None:
        return None
    return Market(
        provider="manifold",
        ref=raw["id"],
        question=question,
        url=raw.get("url"),
        probability=float(prob),
        volume=float(raw.get("volume") or 0),
        liquidity=float(raw.get("totalLiquidity") or 0),
        end_date=end,
        status=status,
        resolved_outcome=raw.get("resolution") if resolved else None,
        category=category_for(question, category),
        slug=raw.get("slug"),
    )


def search(client: httpx.Client, now: datetime, per_topic: int = 100) -> list[Market]:
    seen: dict[str, Market] = {}
    for topic, category in TOPICS.items():
        response = client.get(
            f"{API}/search-markets",
            params={
                "term": "",
                "filter": "open",
                "contractType": "BINARY",
                "topicSlug": topic,
                "sort": "liquidity",
                "limit": per_topic,
            },
        )
        if response.status_code >= 400:
            continue
        data = response.json()
        if not isinstance(data, list):
            continue
        for raw in data:
            m = to_market(raw, category, now) if isinstance(raw, dict) else None
            if m and m.ref not in seen:
                seen[m.ref] = m
    return list(seen.values())


def market(client: httpx.Client, ref: str, category: str, now: datetime) -> Market | None:
    response = client.get(f"{API}/market/{ref}")
    if response.status_code == 404:
        return None
    response.raise_for_status()
    raw = response.json()
    m = to_market(raw, category, now)
    if m is None and raw.get("isResolved"):
        # Keep resolved questions we already show, even if they now fail the filters.
        m = Market(
            provider="manifold",
            ref=ref,
            question=raw.get("question", ""),
            url=raw.get("url"),
            probability=float(raw.get("probability") or 0),
            volume=float(raw.get("volume") or 0),
            liquidity=float(raw.get("totalLiquidity") or 0),
            end_date=_dt(raw.get("closeTime")),
            status="resolved",
            resolved_outcome=raw.get("resolution"),
            category=category,
            slug=raw.get("slug"),
        )
    return m


def history(client: httpx.Client, ref: str, now: datetime) -> list:
    """30 days of probability from the trade log (probAfter on each forecast)."""
    response = client.get(f"{API}/bets", params={"contractId": ref, "limit": 1000})
    if response.status_code >= 400:
        return []
    points = [
        (_dt(b["createdTime"]), float(b["probAfter"]))
        for b in response.json()
        if isinstance(b, dict) and b.get("probAfter") is not None and b.get("createdTime")
    ]
    return downsample([(t, p) for t, p in points if t is not None], now)

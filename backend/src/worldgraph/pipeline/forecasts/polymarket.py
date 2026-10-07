"""Polymarket (real-money market): OFF by default.

Real-money providers stay disabled until the owner decides otherwise
(forecast_provider.enabled). Even when enabled, the API layer shows them only
to viewers whose country is known and not blocked (India is blocked), and
fails closed. We never link to trading, wallets or referrals.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import httpx

from worldgraph.pipeline.forecasts.common import Market, allowed, category_for, clean_question

API = "https://gamma-api.polymarket.com/markets"
MIN_VOLUME = 50_000.0


def to_market(raw: dict[str, Any], now: datetime) -> Market | None:
    try:
        outcomes = json.loads(raw.get("outcomes") or "[]")
        prices = [float(p) for p in json.loads(raw.get("outcomePrices") or "[]")]
    except (ValueError, TypeError):
        return None
    if outcomes != ["Yes", "No"] or len(prices) != 2:
        return None
    question = clean_question(raw.get("question") or "")
    volume = float(raw.get("volume") or 0)
    if not question or not allowed(question, now) or volume < MIN_VOLUME:
        return None
    end = raw.get("endDate")
    end_date = datetime.fromisoformat(end.replace("Z", "+00:00")) if end else None
    closed = bool(raw.get("closed"))
    return Market(
        provider="polymarket",
        ref=str(raw.get("id")),
        question=question,
        url=f"https://polymarket.com/event/{raw['slug']}" if raw.get("slug") else None,
        probability=prices[0],
        volume=volume,
        liquidity=float(raw.get("liquidity") or 0),
        end_date=end_date,
        status="closed" if closed else "open",
        volume_unit="USD",
        real_money=True,
        category=category_for(question, "economy"),
        slug=raw.get("slug"),
    )


def search(client: httpx.Client, now: datetime | None = None, limit: int = 100) -> list[Market]:
    now = now or datetime.now(UTC)
    response = client.get(
        API,
        params={
            "active": "true",
            "closed": "false",
            "order": "volume24hr",
            "ascending": "false",
            "limit": limit,
        },
    )
    response.raise_for_status()
    markets = [to_market(raw, now) for raw in response.json() if isinstance(raw, dict)]
    return [m for m in markets if m is not None]

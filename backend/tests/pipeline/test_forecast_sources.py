"""Forecast adapters on hand-made API responses (no network)."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

from worldgraph.pipeline.forecasts import manifold, polymarket
from worldgraph.pipeline.forecasts.common import allowed, category_for, downsample, short_title

NOW = datetime(2026, 10, 7, 12, 0, tzinfo=UTC)


def raw_market(question: str, **over):
    base = {
        "id": "abc123",
        "question": question,
        "slug": "a-question",
        "url": "https://manifold.markets/x/a-question",
        "probability": 0.31,
        "volume": 25000,
        "totalLiquidity": 1200,
        "uniqueBettorCount": 80,
        "outcomeType": "BINARY",
        "isResolved": False,
        "token": "MANA",
        "closeTime": int((NOW + timedelta(days=90)).timestamp() * 1000),
    }
    return {**base, **over}


def test_question_filters():
    assert allowed("Will the US enter a recession in 2027?", NOW)
    assert not allowed("Will the Fed cut rates in 2025?", NOW)  # a year that has ended
    assert not allowed("Will I finish my thesis this year?", NOW)  # personal
    assert not allowed("Will India win the cricket world cup?", NOW)
    assert not allowed("Will Polymarket be right about the election?", NOW)  # about betting platforms
    assert not allowed("Will this market resolve YES?", NOW)
    assert not allowed("Will my cat like the new food?", NOW)


def test_titles_and_categories():
    assert short_title("[ACX 2026] Will oil reach $150 before the end of 2026?") == (
        "Will oil reach $150 before the end of 2026",
        False,
    )
    title, auto = short_title("Will " + "very " * 20 + "long question resolve?")
    assert auto and len(title.split()) == 12 and title.endswith("…")
    assert category_for("Will OPEC cut oil output?", "economy") == "energy"
    assert category_for("Will China invade Taiwan by 2028?", "economy") == "geopolitics"
    assert category_for("Will new US tariffs on steel take effect?", "economy") == "trade"
    assert category_for("Will GDP grow 3%?", "economy") == "economy"


def test_manifold_market():
    m = manifold.to_market(raw_market("Will Brent oil close above $100 in 2026?"), "economy", NOW)
    assert (
        m and m.category == "energy" and m.status == "open" and m.volume_unit == "MANA" and not m.real_money
    )
    assert m.node_id == "forecast:manifold-a-question"
    assert (
        manifold.to_market(raw_market("Will oil rise in 2026?", uniqueBettorCount=3), "economy", NOW) is None
    )
    assert (
        manifold.to_market(
            raw_market("Will oil rise in 2026?", outcomeType="MULTIPLE_CHOICE"), "economy", NOW
        )
        is None
    )
    far = raw_market("Will oil rise by 2040?", closeTime=int((NOW + timedelta(days=4000)).timestamp() * 1000))
    assert manifold.to_market(far, "economy", NOW) is None


def test_history_downsampling():
    points = [(NOW - timedelta(days=d, hours=h), 0.5 + d / 100) for d in range(40) for h in (1, 13)]
    snaps = downsample(points, NOW)
    assert all(NOW - s.ts <= timedelta(days=31) for s in snaps)  # day buckets start at midnight
    assert len({s.ts for s in snaps}) == len(snaps)
    assert snaps == sorted(snaps, key=lambda s: s.ts)


def test_polymarket_market_is_real_money():
    raw = {
        "id": 77,
        "question": "Will the Fed cut rates in December 2026?",
        "slug": "fed-dec",
        "outcomes": json.dumps(["Yes", "No"]),
        "outcomePrices": json.dumps(["0.42", "0.58"]),
        "volume": "250000",
        "liquidity": "40000",
        "endDate": "2026-12-20T00:00:00Z",
        "closed": False,
    }
    m = polymarket.to_market(raw, NOW)
    assert m and m.real_money and m.volume_unit == "USD" and m.probability == 0.42 and m.category == "finance"
    assert polymarket.to_market({**raw, "volume": "100"}, NOW) is None

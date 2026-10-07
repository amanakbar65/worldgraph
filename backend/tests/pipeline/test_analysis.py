"""The website AI job: validation, cost and budget (no API calls)."""

from __future__ import annotations

import json
from decimal import Decimal
from types import SimpleNamespace

import pytest

from worldgraph.pipeline import analysis


def good(story_id: str = "story:a") -> dict:
    return {
        "id": story_id,
        "headline": "Saudi Arabia extends oil output cuts into next year",
        "so_what": "Fuel-heavy businesses face higher costs for longer.",
        "event_type": "policy-decision",
        "impact": "risk",
        "direction": "up",
        "magnitude": 3,
        "horizon": "months",
        "confidence": 0.8,
        "sectors": ["energy", "logistics-trade"],
        "actions": ["Review fuel surcharges with carriers"],
        "entities": ["commodity:crude-oil"],
        "links": [
            {
                "from": "story:b",
                "link_type": "inferred",
                "mechanism": "tighter crude supply",
                "direction": "up",
                "confidence": 0.5,
                "evidence": "Lower output usually lifts crude prices.",
            }
        ],
    }


def test_validation_keeps_good_items_and_explains_bad_ones():
    long_headline = {**good("story:c"), "headline": "word " * 13}
    bad_link = {**good("story:d"), "links": [{**good()["links"][0], "mechanism": "price"}]}
    raw = {
        "items": [good(), long_headline, bad_link, good("story:not-in-batch")],
        "skipped": [{"id": "story:e", "reason": "sport"}, {"id": "story:zzz", "reason": "x"}],
    }
    items, skipped, problems = analysis.validate(raw, {"story:a", "story:c", "story:d", "story:e"})
    assert [i["id"] for i in items] == ["story:a"]
    assert items[0]["links"][0]["from"] == "story:b"  # serialised with the contract's field name
    assert skipped == [{"id": "story:e", "reason": "sport"}]
    assert len(problems) == 2


def test_cost():
    usage = SimpleNamespace(
        input_tokens=1000, output_tokens=2000, cache_read_input_tokens=10000, cache_creation_input_tokens=0
    )
    # 1k × $4 + 2k × $20 + 10k × $0.20, per million tokens
    assert analysis.cost_usd("claude-opus-5-5", usage) == Decimal("0.046")


class FakeClient:
    def __init__(self, reply: dict):
        self.calls = 0
        self.reply = reply
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        self.calls += 1
        assert kwargs["output_config"]["format"]["type"] == "json_schema"
        assert kwargs["system"][0]["cache_control"] == {"type": "ephemeral"}
        return SimpleNamespace(
            model=kwargs["model"],
            stop_reason="end_turn",
            content=[SimpleNamespace(type="text", text=json.dumps(self.reply))],
            usage=SimpleNamespace(
                input_tokens=500,
                output_tokens=800,
                cache_read_input_tokens=0,
                cache_creation_input_tokens=1500,
            ),
        )


@pytest.mark.db
def test_budget_stops_the_job_before_any_call(sdb, monkeypatch):
    monkeypatch.setenv("WG_AI_DAILY_BUDGET_USD", "0.05")
    analysis.get_settings.cache_clear()
    client = FakeClient({"items": [], "skipped": []})
    result = analysis.run_analysis(sdb, client=client)
    assert result["stopped"] == "daily budget reached" and client.calls == 0

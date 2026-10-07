"""Website AI analysis: turn waiting story drafts into story cards with the Claude API.

Runs only when ANTHROPIC_API_KEY is set (the deployed website). The test link
does the same work on the owner's own Claude account instead, while the app
is open. Both use prompts/analysis.md and prompts/analysis.schema.json.

Every call is logged in llm_usage with its cost; the job stops once today's
spend (UTC) reaches its share of WG_AI_DAILY_BUDGET_USD.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, Literal

import psycopg
from pydantic import BaseModel, Field, ValidationError, field_validator

from worldgraph.config import REPO_DIR, get_settings

log = logging.getLogger("worldgraph.pipeline.analysis")

PROMPTS = REPO_DIR / "prompts"
ANALYSIS_SHARE = 0.75  # the rest of the daily budget is kept for Ask
BATCH = 6
EST_COST_PER_BATCH = Decimal("0.12")  # a conservative guess, checked before each call

# US dollars per million tokens: (input, output, cache read). Cache writes cost 1.25 × input.
PRICES: dict[str, tuple[float, float, float]] = {
    "claude-opus-5-5": (4.00, 20.00, 0.20),
    "claude-sonnet-5-5": (2.00, 10.00, 0.20),
    "claude-haiku-5-5": (0.10, 0.50, 0.01),
}

SECTORS = Literal[
    "energy",
    "agri-food",
    "manufacturing",
    "logistics-trade",
    "finance",
    "tech",
    "health",
    "real-estate",
    "consumer",
]


def _words(text: str, low: int, high: int) -> str:
    text = " ".join(text.split())
    if not low <= len(text.split()) <= high:
        raise ValueError(f"must be {low}-{high} words")
    return text


class Link(BaseModel):
    from_: str = Field(alias="from")
    link_type: Literal["reported", "inferred"]
    mechanism: str
    direction: Literal["up", "down"]
    confidence: float = Field(ge=0, le=1)
    evidence: str = Field(max_length=300)

    @field_validator("mechanism")
    @classmethod
    def _mechanism(cls, v: str) -> str:
        return _words(v, 2, 4)


class Item(BaseModel):
    """Mirrors AnalysisItem in frontend/src/api/contract.ts."""

    id: str
    headline: str
    so_what: str
    event_type: str = Field(min_length=2, max_length=40)
    impact: Literal["risk", "opportunity", "neutral"]
    direction: Literal["up", "down"]
    magnitude: int = Field(ge=1, le=5)
    horizon: Literal["now", "weeks", "months"]
    confidence: float = Field(ge=0, le=1)
    sectors: list[SECTORS] = Field(min_length=1, max_length=3)
    actions: list[str] = Field(max_length=3)
    entities: list[str] = Field(max_length=12)
    links: list[Link] = Field(max_length=4)

    @field_validator("headline")
    @classmethod
    def _headline(cls, v: str) -> str:
        return _words(v, 1, 12)

    @field_validator("so_what")
    @classmethod
    def _so_what(cls, v: str) -> str:
        return _words(v, 1, 20)

    @field_validator("actions")
    @classmethod
    def _actions(cls, v: list[str]) -> list[str]:
        return [_words(a, 1, 8) for a in v]


def cost_usd(model: str, usage: Any) -> Decimal:
    price_in, price_out, price_cached = PRICES.get(model, PRICES["claude-opus-5-5"])
    cached = getattr(usage, "cache_read_input_tokens", 0) or 0
    written = getattr(usage, "cache_creation_input_tokens", 0) or 0
    fresh = getattr(usage, "input_tokens", 0) or 0
    out = getattr(usage, "output_tokens", 0) or 0
    dollars = (fresh * price_in + written * price_in * 1.25 + cached * price_cached + out * price_out) / 1e6
    return Decimal(str(round(dollars, 5)))


def spent_today(conn: psycopg.Connection) -> Decimal:
    with conn.cursor() as cur:
        cur.execute(
            "select coalesce(sum(cost_usd), 0) as spent from llm_usage "
            "where at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'"
        )
        return Decimal(cur.fetchone()["spent"])  # type: ignore[index]


def record_usage(conn: psycopg.Connection, model: str, purpose: str, usage: Any, cost: Decimal) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "insert into llm_usage (engine, model, purpose, input_tokens, output_tokens, cost_usd) "
            "values ('api', %s, %s, %s, %s, %s)",
            (
                model,
                purpose,
                (getattr(usage, "input_tokens", 0) or 0)
                + (getattr(usage, "cache_read_input_tokens", 0) or 0)
                + (getattr(usage, "cache_creation_input_tokens", 0) or 0),
                getattr(usage, "output_tokens", 0) or 0,
                cost,
            ),
        )
    conn.commit()  # usage is recorded even if a later step fails


def rpc(conn: psycopg.Connection, name: str, args: dict[str, Any]) -> Any:
    with conn.cursor() as cur:
        cur.execute(f"select api.{name}(%s::jsonb) as data", (json.dumps(args),))
        return cur.fetchone()["data"]  # type: ignore[index]


def compact(item: dict[str, Any]) -> dict[str, Any]:
    """Only what the model needs: keeps the prompt short and the cost low."""
    return {
        "id": item["id"],
        "titles": item["titles"][:8],
        "snippets": item["snippets"][:5],
        "sources": item["sources"][:8],
        "first_seen": item["first_seen"],
        "region": (item.get("region") or {}).get("name"),
        "guess": {"event_type": item["event_type"], "sectors": item["sectors"]},
        "entities": [{"id": e["id"], "name": e["name"]} for e in item.get("entities") or []],
        "candidates": [
            {
                "id": c["id"],
                "headline": c["headline"],
                "so_what": c.get("so_what"),
                "region": (c.get("region") or {}).get("name"),
                "first_seen": c.get("first_seen"),
            }
            for c in item.get("candidates") or []
        ],
    }


def validate(raw: dict[str, Any], batch_ids: set[str]) -> tuple[list[dict], list[dict], list[str]]:
    """Valid items and skips for this batch, plus reasons for anything dropped."""
    items, skipped, problems = [], [], []
    for entry in raw.get("items") or []:
        try:
            item = Item.model_validate(entry)
        except ValidationError as exc:
            problems.append(f"{entry.get('id')}: {exc.errors()[0]['msg']}")
            continue
        if item.id in batch_ids:
            items.append(item.model_dump(by_alias=True))
    for entry in raw.get("skipped") or []:
        if isinstance(entry, dict) and entry.get("id") in batch_ids:
            skipped.append(
                {"id": entry["id"], "reason": str(entry.get("reason") or "not business news")[:120]}
            )
    return items, skipped, problems


def analyse_batch(client: Any, model: str, prompt: str, schema: dict[str, Any], batch: list[dict]) -> Any:
    payload = {"today": datetime.now(UTC).date().isoformat(), "items": [compact(i) for i in batch]}
    return client.beta.messages.create(
        model=model,
        max_tokens=16000,
        system=[{"type": "text", "text": prompt, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",  # another model takes over if this one declines
    )


def run_analysis(conn: psycopg.Connection, limit: int = 12, client: Any = None) -> dict[str, Any]:
    settings = get_settings()
    model = settings.wg_ai_model
    budget = Decimal(str(settings.wg_ai_daily_budget_usd)) * Decimal(str(ANALYSIS_SHARE))
    stats: dict[str, Any] = {
        "model": model,
        "saved": 0,
        "skipped": 0,
        "rejected": 0,
        "calls": 0,
        "cost_usd": 0.0,
    }
    if spent_today(conn) + EST_COST_PER_BATCH > budget:
        return {**stats, "stopped": "daily budget reached"}

    pending = rpc(conn, "pending_analysis", {"limit": limit})["items"]
    if not pending:
        return {**stats, "stopped": "nothing waiting"}
    if client is None:
        import anthropic

        client = anthropic.Anthropic(api_key=settings.anthropic_api_key, max_retries=3)
    prompt = (PROMPTS / "analysis.md").read_text(encoding="utf-8")
    schema = json.loads((PROMPTS / "analysis.schema.json").read_text(encoding="utf-8"))
    schema.pop("$comment", None)

    problems: list[str] = []
    for start in range(0, len(pending), BATCH):
        if spent_today(conn) + EST_COST_PER_BATCH > budget:
            stats["stopped"] = "daily budget reached"
            break
        batch = pending[start : start + BATCH]
        response = analyse_batch(client, model, prompt, schema, batch)
        served_by = getattr(response, "model", None) or model
        cost = cost_usd(served_by, response.usage)
        record_usage(conn, served_by, "analysis", response.usage, cost)
        stats["calls"] += 1
        stats["cost_usd"] = round(stats["cost_usd"] + float(cost), 5)
        if response.stop_reason in ("refusal", "max_tokens"):
            problems.append(f"batch {start // BATCH}: stopped ({response.stop_reason})")
            continue
        text = next((b.text for b in response.content if getattr(b, "type", "") == "text"), "")
        try:
            raw = json.loads(text)
        except json.JSONDecodeError:
            problems.append(f"batch {start // BATCH}: reply was not JSON")
            continue
        items, skipped, dropped = validate(raw, {i["id"] for i in batch})
        problems += dropped
        if items or skipped:
            result = rpc(
                conn,
                "save_analysis",
                {"engine": "api", "model": served_by, "items": items, "skipped": skipped},
            )
            conn.commit()
            stats["saved"] += result["saved"]
            stats["skipped"] += result.get("skipped", 0)
            stats["rejected"] += len(result["rejected"])
            problems += [f"{r['id']}: {r['reason']}" for r in result["rejected"]]
    if problems:
        stats["problems"] = problems[:20]
    return stats

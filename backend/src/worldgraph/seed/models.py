"""Pydantic models for the sample-data files (see seed/README.md).

Validation here is strict on purpose: word limits, ID formats, link types and
cross-references are all checked by `uv run wg seed check`.
"""

from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

ID_RE = re.compile(r"^[a-z_]+:[a-z0-9][a-z0-9.-]*$")

SECTORS = (
    "energy",
    "agri-food",
    "manufacturing",
    "logistics-trade",
    "finance",
    "tech",
    "health",
    "real-estate",
    "consumer",
)
Sector = Literal[
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
Impact = Literal["risk", "opportunity", "neutral"]
Direction = Literal["up", "down"]
Horizon = Literal["now", "weeks", "months"]
Category = Literal[
    "economy",
    "finance",
    "policy",
    "politics",
    "geopolitics",
    "trade",
    "tech",
    "commodities",
    "energy",
]


def word_count(text: str) -> int:
    return len(text.split())


def _check_id(value: str, prefix: str | tuple[str, ...] | None = None) -> str:
    if not ID_RE.match(value):
        raise ValueError(f"bad id {value!r}: use type:slug, lowercase, e.g. commodity:crude-oil")
    if prefix and not value.startswith(prefix):
        raise ValueError(f"id {value!r} must start with {prefix}")
    return value


def _words(text: str, low: int, high: int, what: str) -> str:
    n = word_count(text)
    if not low <= n <= high:
        raise ValueError(f"{what} must be {low}-{high} words, got {n}: {text!r}")
    return text.strip()


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


# ---------------------------------------------------------------------------
# Entities
# ---------------------------------------------------------------------------

EntityKind = Literal["sector", "commodity", "infrastructure", "organization", "policy", "person", "bloc"]


class Entity(Strict):
    """One reference entity. `sample: true` marks an invented one."""

    id: str
    type: EntityKind
    name: str
    subtype: str | None = None
    summary: str | None = None
    aliases: list[str] = []
    qid: str | None = None
    icon: str | None = None  # lucide icon name (sectors)
    hs: str | None = None  # HS code (commodities)
    sectors: list[Sector] = []
    lon: float | None = None
    lat: float | None = None
    located_in: str | None = None  # region id
    produced_by: list[str] = []  # region ids (commodities)
    members: list[str] = []  # region ids (blocs)
    owns: list[str] = []  # node ids (organizations → infrastructure)
    competes_with: list[str] = []
    depends_on: list[str] = []  # node ids this entity relies on
    regions: list[str] = []  # regions a policy applies to
    facts: dict[str, str] = {}
    sample: bool = False

    @field_validator("id")
    @classmethod
    def _id(cls, v: str) -> str:
        return _check_id(v)

    @field_validator("qid")
    @classmethod
    def _qid(cls, v: str | None) -> str | None:
        if v is not None and not re.match(r"^Q\d+$", v):
            raise ValueError(f"bad Wikidata id {v!r}")
        return v

    @model_validator(mode="after")
    def _prefix(self) -> Entity:
        expected = {
            "sector": "sector:",
            "commodity": "commodity:",
            "infrastructure": "infra:",
            "organization": "org:",
            "policy": "policy:",
            "person": "person:",
            "bloc": "region:",
        }[self.type]
        _check_id(self.id, expected)
        if (self.lon is None) != (self.lat is None):
            raise ValueError(f"{self.id}: give both lon and lat, or neither")
        if self.lon is not None and not (-180 <= self.lon <= 180 and -90 <= self.lat <= 90):  # type: ignore[operator]
            raise ValueError(f"{self.id}: lon/lat out of range")
        if self.type == "sector" and self.id.removeprefix("sector:") not in SECTORS:
            raise ValueError(f"{self.id}: unknown sector")
        return self


# ---------------------------------------------------------------------------
# Indicators (KPI series generated from a short description)
# ---------------------------------------------------------------------------


class Indicator(Strict):
    id: str
    name: Annotated[str, Field(max_length=24)]  # short KPI label
    subject: str  # region or commodity id
    unit: str
    frequency: Literal["daily", "weekly", "monthly", "quarterly"]
    higher_is: Literal["better", "worse", "neutral"]
    points: Annotated[int, Field(ge=6, le=120)]
    start: float  # first value
    end: float  # latest value
    volatility: Annotated[float, Field(ge=0)] = 0.0  # noise as a fraction of |end - start| or of the level
    decimals: Annotated[int, Field(ge=0, le=4)] = 1

    @field_validator("id")
    @classmethod
    def _id(cls, v: str) -> str:
        return _check_id(v, "indicator:")


# ---------------------------------------------------------------------------
# Storylines
# ---------------------------------------------------------------------------


class Move(Strict):
    days_ago: Annotated[float, Field(ge=0, le=365)]
    delta: Annotated[float, Field(ge=-0.6, le=0.6)]


class History(Strict):
    days: Annotated[int, Field(ge=7, le=365)] = 90
    start: Annotated[float, Field(ge=0.01, le=0.99)]
    end: Annotated[float, Field(ge=0.01, le=0.99)]
    moves: list[Move] = []  # sharp jumps (e.g. a 10+ point move in the last day)
    volume: Annotated[float, Field(ge=0)]  # latest total volume
    liquidity: Annotated[float, Field(ge=0)]
    noise: Annotated[float, Field(ge=0, le=0.1)] = 0.015


class Forecast(Strict):
    id: str
    short_title: str
    question: str
    category: Category
    location: str  # region or infrastructure id (where the ring sits on the globe)
    about: list[str]  # node ids the question is about (first region is its home)
    end_in_days: Annotated[int, Field(ge=1, le=730)]
    resolution_rule: str
    history: History

    @field_validator("id")
    @classmethod
    def _id(cls, v: str) -> str:
        return _check_id(v, "forecast:")

    @field_validator("short_title")
    @classmethod
    def _short(cls, v: str) -> str:
        return _words(v, 2, 12, "short_title")


class Story(Strict):
    id: str
    kind: Literal["event", "projected"] = "event"
    headline: str
    so_what: str
    event_type: str
    impact: Impact
    direction: Direction
    magnitude: Annotated[int, Field(ge=1, le=5)]
    horizon: Horizon
    confidence: Annotated[float, Field(ge=0, le=1)]
    sectors: Annotated[list[Sector], Field(min_length=1, max_length=3)]
    at: str  # location: a region or infrastructure id
    mentions: list[str] = []  # other node ids the story is about
    age_hours: Annotated[float, Field(ge=0, le=24 * 60)] | None = None  # events only
    sources: Annotated[int, Field(ge=1, le=60)] = 3
    actions: Annotated[list[str], Field(max_length=3)] = []

    @field_validator("id")
    @classmethod
    def _id(cls, v: str) -> str:
        return _check_id(v, "story:")

    @field_validator("headline")
    @classmethod
    def _headline(cls, v: str) -> str:
        return _words(v, 3, 12, "headline")

    @field_validator("so_what")
    @classmethod
    def _so_what(cls, v: str) -> str:
        return _words(v, 5, 20, "so_what")

    @field_validator("actions")
    @classmethod
    def _actions(cls, v: list[str]) -> list[str]:
        return [_words(a, 2, 8, "action") for a in v]

    @model_validator(mode="after")
    def _kind(self) -> Story:
        if self.kind == "event" and self.age_hours is None:
            raise ValueError(f"{self.id}: events need age_hours")
        if self.kind == "projected" and self.age_hours is not None:
            raise ValueError(f"{self.id}: projected stories have no age_hours")
        return self


class Link(Strict):
    model_config = ConfigDict(extra="forbid", frozen=True, populate_by_name=True)

    from_: str = Field(alias="from")
    to: str
    type: Literal["reported", "inferred", "projected", "conditional"]
    mechanism: str
    direction: Direction
    confidence: Annotated[float, Field(ge=0.05, le=1)]
    lag_days: Annotated[int, Field(ge=0, le=365)] | None = None
    forecast: str | None = None  # conditional only
    outcome: Literal["YES", "NO"] | None = None  # conditional only
    evidence: Annotated[str, Field(max_length=300)] | None = None

    @field_validator("mechanism")
    @classmethod
    def _mechanism(cls, v: str) -> str:
        return _words(v, 2, 4, "mechanism")

    @model_validator(mode="after")
    def _conditional(self) -> Link:
        is_conditional = self.type == "conditional"
        if is_conditional != (self.forecast is not None and self.outcome is not None):
            raise ValueError(f"{self.from_} → {self.to}: conditional links need forecast and outcome")
        return self


class Storyline(Strict):
    id: str
    title: str
    entities: list[Entity] = []
    forecasts: list[Forecast] = []
    stories: Annotated[list[Story], Field(min_length=1)]
    links: list[Link] = []

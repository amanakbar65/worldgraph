"""The common shape every news source is turned into."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime

from worldgraph.pipeline.places import Place
from worldgraph.pipeline.themes import Classification


@dataclass
class Item:
    url: str
    title: str
    source_name: str  # outlet shown to people, e.g. "Reuters" or "reuters.com"
    published_at: datetime
    provider: str  # 'gdelt' | 'rss' | 'usgs' | 'gdacs'
    lang: str = "en"
    snippet: str | None = None  # at most one sentence, ≤ 300 characters
    place: Place | None = None
    countries: list[str] = field(default_factory=list)  # every country named
    themes: Counter[str] = field(default_factory=Counter)
    orgs: list[str] = field(default_factory=list)
    tone: float | None = None
    cls: Classification | None = None
    entities: list[str] = field(default_factory=list)  # our entity ids
    hazard: bool = False  # a measured hazard (earthquake, alert): its own story
    magnitude: int | None = None  # set by hazard sources
    embedding: list[float] | None = None

    @property
    def score(self) -> float:
        return self.cls.score if self.cls else 0.0

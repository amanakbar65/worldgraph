"""Importance scoring (0–100), shared by the sample data and the live pipeline.

Importance mixes how big the event is (magnitude), how widely it's covered
(sources and mentions), and how new it is. It is a ranking signal for the
globe and "Top 5 now", not a claim about the world.
"""

from __future__ import annotations

import math


def importance(
    magnitude: int | None,
    source_count: int,
    mention_count: int,
    age_hours: float | None,
    *,
    projected: bool = False,
) -> float:
    mag = (magnitude or 2) / 5  # 0.2 … 1.0
    coverage = min(1.0, math.log1p(source_count) / math.log1p(40))  # 40+ sources saturates
    buzz = min(1.0, math.log1p(mention_count) / math.log1p(400))
    # Freshness halves roughly every two days; unknown age counts as middling.
    freshness = 0.5 if age_hours is None else math.exp(-max(age_hours, 0) / 72)
    score = 100 * (0.45 * mag + 0.25 * coverage + 0.10 * buzz + 0.20 * freshness)
    if projected:
        score *= 0.6  # possible future impacts rank below things that happened
    return round(max(0.0, min(100.0, score)), 1)

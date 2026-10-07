"""Group news items into stories.

An item joins the most similar live story (seen in the last 72 hours) when
the headlines are close enough: very close on their own, fairly close and
about the same country or entity, or related and about both. Items that join nothing are grouped
with each other the same way; each new group becomes a new story.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
import psycopg

from worldgraph.pipeline.embed import to_pgvector
from worldgraph.pipeline.items import Item

SIM_HIGH = 0.72  # same story, whatever the place
SIM_NEAR = 0.62  # same story if the place or an entity matches too
SIM_BOTH = 0.55  # same story if the place and an entity both match
WINDOW_HOURS = 72


@dataclass
class Group:
    items: list[Item]
    story_id: str | None = None  # an existing story this group joins
    vec: np.ndarray | None = None  # sum of item vectors
    countries: set[str] = field(default_factory=set)
    entities: set[str] = field(default_factory=set)

    def add(self, item: Item) -> None:
        self.items.append(item)
        v = np.asarray(item.embedding, dtype=np.float32)
        self.vec = v.copy() if self.vec is None else self.vec + v
        if item.place:
            self.countries.add(item.place.country_id)
        self.entities.update(item.entities)

    @property
    def centroid(self) -> np.ndarray:
        assert self.vec is not None
        norm = float(np.linalg.norm(self.vec)) or 1.0
        return self.vec / norm

    @property
    def best(self) -> Item:
        return max(self.items, key=lambda i: (i.hazard, i.score))


def joins(sim: float, same_country: bool, shared_entity: bool) -> bool:
    return (
        sim >= SIM_HIGH
        or (sim >= SIM_NEAR and (same_country or shared_entity))
        or (sim >= SIM_BOTH and same_country and shared_entity)
    )


def nearest_stories(conn: psycopg.Connection, items: list[Item], k: int = 3) -> list[list[dict[str, Any]]]:
    """For each item, up to k live stories with the closest embedding."""
    if not items:
        return []
    vectors = [to_pgvector(i.embedding or []) for i in items]
    with conn.cursor() as cur:
        cur.execute("set local hnsw.ef_search = 100")
        cur.execute(
            """
            with q as (
                select t.i, t.v::vector as v
                from unnest(%(vectors)s::text[]) with ordinality as t(v, i)
            )
            select q.i, c.node_id, c.sim, c.country_id, c.entities
            from q
            cross join lateral (
                select s.node_id, 1 - (s.embedding <=> q.v) as sim, s.country_id,
                       array(select e.dst from edge e
                             where e.src = s.node_id and e.type = 'mentions'
                               and e.dst not like 'region:%%' and e.dst not like 'sector:%%') as entities
                from story s
                where s.embedding is not null
                  and s.last_seen > now() - make_interval(hours => %(hours)s)
                order by s.embedding <=> q.v
                limit %(k)s
            ) c
            order by q.i, c.sim desc
            """,
            {"vectors": vectors, "hours": WINDOW_HOURS, "k": k},
        )
        rows = cur.fetchall()
    out: list[list[dict[str, Any]]] = [[] for _ in items]
    for r in rows:
        out[r["i"] - 1].append(r)
    return out


def group_items(items: list[Item], candidates: list[list[dict[str, Any]]]) -> list[Group]:
    """Assign every item to an existing story or a new group."""
    groups: list[Group] = []
    by_story: dict[str, Group] = {}
    fresh: list[Group] = []  # groups without a story yet

    order = sorted(range(len(items)), key=lambda i: -items[i].score)
    for idx in order:
        item = items[idx]
        if item.hazard:
            g = Group(items=[])
            g.add(item)
            groups.append(g)
            continue

        country = item.place.country_id if item.place else None
        ents = set(item.entities)
        best_story, best_sim = None, -1.0
        for c in candidates[idx] if idx < len(candidates) else []:
            if c["sim"] > best_sim and joins(
                c["sim"], c["country_id"] == country, bool(ents & set(c["entities"]))
            ):
                best_story, best_sim = c["node_id"], c["sim"]
        if best_story is not None:
            g = by_story.get(best_story)
            if g is None:
                g = by_story[best_story] = Group(items=[], story_id=best_story)
                groups.append(g)
            g.add(item)
            continue

        v = np.asarray(item.embedding, dtype=np.float32)
        best_group, best_sim = None, -1.0
        if fresh:
            sims = np.stack([g.centroid for g in fresh]) @ v
            for g, sim in zip(fresh, sims.tolist(), strict=True):
                if sim > best_sim and joins(sim, country in g.countries, bool(ents & g.entities)):
                    best_group, best_sim = g, sim
        if best_group is None:
            best_group = Group(items=[])
            fresh.append(best_group)
            groups.append(best_group)
        best_group.add(item)
    return groups

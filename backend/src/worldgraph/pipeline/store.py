"""Write grouped news items to the database as stories, articles and edges."""

from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timedelta
from typing import Any

import h3
import numpy as np
import psycopg

from worldgraph.pipeline.cluster import Group
from worldgraph.pipeline.embed import normalise, to_pgvector
from worldgraph.pipeline.items import Item
from worldgraph.pipeline.places import Place
from worldgraph.pipeline.text import limit_words, story_id
from worldgraph.scoring import importance

MAX_ARTICLES_PER_STORY = 40
PENDING_HEADLINE_WORDS = 40  # the story_headline_words limit for drafts
IMPORTANCE_WINDOW = timedelta(days=8)


# -- small state store ---------------------------------------------------------


def get_state(conn: psycopg.Connection, key: str) -> Any:
    with conn.cursor() as cur:
        cur.execute("select value from pipeline_state where key = %s", (key,))
        row = cur.fetchone()
    return row["value"] if row else None


def set_state(conn: psycopg.Connection, key: str, value: Any) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "insert into pipeline_state (key, value, updated_at) values (%s, %s::jsonb, now()) "
            "on conflict (key) do update set value = excluded.value, updated_at = now()",
            (key, json.dumps(value)),
        )


def known_urls(conn: psycopg.Connection, urls: list[str]) -> set[str]:
    if not urls:
        return set()
    with conn.cursor() as cur:
        cur.execute("select url from article where url = any(%s)", (urls,))
        return {r["url"] for r in cur.fetchall()}


# -- story drafts ----------------------------------------------------------------


def _headline(group: Group) -> str:
    """Prefer outlet feeds (cleaner titles), then the item nearest the group's centre."""
    centre = group.centroid

    def rank(item: Item) -> tuple[bool, bool, float]:
        sim = float(np.dot(centre, np.asarray(item.embedding, dtype=np.float32))) if item.embedding else 0.0
        return (item.hazard, item.provider == "rss", sim)

    return limit_words(max(group.items, key=rank).title, PENDING_HEADLINE_WORDS)


def _place(group: Group) -> Place | None:
    countries = Counter(i.place.country_id for i in group.items if i.place)
    if not countries:
        return None
    top = countries.most_common(1)[0][0]
    precision = {"point": 0, "city": 1, "state": 2, "country": 3}
    in_top = [i for i in group.items if i.place and i.place.country_id == top]
    best = min(in_top, key=lambda i: (precision.get(i.place.precision, 4), -i.score))  # type: ignore[union-attr]
    return best.place


def _weighted(items: list[Item], attr: str) -> str | None:
    votes: Counter[str] = Counter()
    for item in items:
        if item.cls is not None:
            votes[getattr(item.cls, attr)] += max(item.score, 1)
    return votes.most_common(1)[0][0] if votes else None


def _sectors(items: list[Item]) -> list[str]:
    votes: Counter[str] = Counter()
    for item in items:
        for rank, sector in enumerate(item.cls.sectors if item.cls else []):
            votes[sector] += max(item.score, 1) / (rank + 1)
    return [s for s, _ in votes.most_common(3)]


def draft(group: Group) -> dict[str, Any] | None:
    """A new pending story from a group of items (None if it has no place)."""
    place = _place(group)
    if place is None:
        return None
    seed = min(i.url for i in group.items)
    headline = _headline(group)
    hazard_mag = max((i.magnitude or 0 for i in group.items if i.hazard), default=0)
    magnitude = hazard_mag or max((i.cls.magnitude for i in group.items if i.cls), default=2)
    impact = "risk" if any(i.hazard for i in group.items) else (_weighted(group.items, "impact") or "neutral")
    return {
        "id": story_id(headline, seed),
        "headline": headline,
        "event_type": _weighted(group.items, "event_type") or "market-shift",
        "impact": impact,
        "magnitude": magnitude,
        "sectors": _sectors(group.items),
        "place": place,
        "first_seen": min(i.published_at for i in group.items),
        "last_seen": max(i.published_at for i in group.items),
        "embedding": to_pgvector(normalise(group.centroid.tolist())),
        "n": len(group.items),
        "providers": sorted({i.provider for i in group.items}),
    }


def _point_sql(lon: float, lat: float) -> str:
    return f"SRID=4326;POINT({lon:.6f} {lat:.6f})"


def insert_story(cur: psycopg.Cursor, d: dict[str, Any]) -> bool:
    place: Place = d["place"]
    cur.execute(
        "insert into node (id, type, subtype, name, geom, is_sample) "
        "values (%s, 'story', 'event', %s, st_geogfromtext(%s), false) on conflict (id) do nothing",
        (d["id"], d["headline"], _point_sql(place.lon, place.lat)),
    )
    if cur.rowcount == 0:
        return False
    cur.execute(
        """
        insert into story (node_id, kind, headline, so_what, event_type, impact, magnitude, importance,
            sectors, primary_region, location, h3_cell, first_seen, last_seen, embedding,
            analysis_status, country_id, admin1_id, props)
        values (%(id)s, 'event', %(headline)s, null, %(event_type)s, %(impact)s, %(magnitude)s, 0,
            %(sectors)s, %(region)s, st_geogfromtext(%(point)s), %(h3)s, %(first_seen)s, %(last_seen)s,
            %(embedding)s::vector, 'pending', %(country)s, %(admin1)s, %(props)s::jsonb)
        """,
        {
            **d,
            "region": place.region_id,
            "point": _point_sql(place.lon, place.lat),
            "h3": h3.latlng_to_cell(place.lat, place.lon, 7),
            "country": place.country_id,
            "admin1": place.admin1_id,
            "props": json.dumps({"n": d["n"], "providers": d["providers"]}),
        },
    )
    return True


def merge_into(cur: psycopg.Cursor, group: Group) -> None:
    """Fold new items into an existing story: centroid, providers, last seen."""
    assert group.story_id is not None
    cur.execute(
        "select embedding::text as embedding, props, analysis_status from story where node_id = %s",
        (group.story_id,),
    )
    row = cur.fetchone()
    if row is None:
        return
    props = row["props"] or {}
    n = int(props.get("n") or 1)
    if row["embedding"]:
        old = np.asarray(json.loads(row["embedding"]), dtype=np.float32)
        vec = old * n + (group.vec if group.vec is not None else 0)
        embedding: str | None = to_pgvector(normalise(vec.tolist()))
    else:
        embedding = None
    props["n"] = n + len(group.items)
    props["providers"] = sorted(set(props.get("providers") or []) | {i.provider for i in group.items})
    cur.execute(
        """
        update story set
            embedding = coalesce(%(embedding)s::vector, embedding),
            props = %(props)s::jsonb,
            last_seen = greatest(last_seen, %(last)s),
            sectors = case when analysis_status = 'pending' and cardinality(sectors) < 3
                           then (select array(select distinct unnest(sectors || %(sectors)s::text[]) limit 3))
                           else sectors end
        where node_id = %(id)s
        """,
        {
            "embedding": embedding,
            "props": json.dumps(props),
            "last": max(i.published_at for i in group.items),
            "sectors": _sectors(group.items),
            "id": group.story_id,
        },
    )


def insert_articles(cur: psycopg.Cursor, sid: str, items: list[Item]) -> int:
    cur.execute("select count(*) as n from article where story_id = %s", (sid,))
    room = MAX_ARTICLES_PER_STORY - cur.fetchone()["n"]  # type: ignore[index]
    added = 0
    for item in sorted(items, key=lambda i: (-i.score, i.published_at))[: max(room, 0)]:
        cur.execute(
            "insert into article (story_id, url, source_name, title, published_at, lang, snippet) "
            "values (%s, %s, %s, %s, %s, %s, %s) on conflict (url) do nothing",
            (sid, item.url, item.source_name, item.title[:500], item.published_at, item.lang, item.snippet),
        )
        added += cur.rowcount
    return added


def insert_edges(cur: psycopg.Cursor, sid: str, items: list[Item], place: Place | None) -> None:
    targets: list[str] = []
    for item in items:
        targets += item.entities
        targets += item.countries[:3]
        targets += [f"sector:{s}" for s in (item.cls.sectors[:2] if item.cls else [])]
    if place is not None:
        targets += [place.region_id, place.country_id]
    targets = [t for t in dict.fromkeys(targets) if t != sid]
    if not targets:
        return
    cur.execute(
        "insert into edge (src, dst, type) select %s, n.id, 'mentions' from node n where n.id = any(%s) "
        "on conflict do nothing",
        (sid, targets),
    )


def refresh_counts(cur: psycopg.Cursor, story_ids: list[str]) -> None:
    if not story_ids:
        return
    cur.execute(
        """
        update story s set
            source_count = a.sources,
            mention_count = greatest(s.mention_count, a.n),
            first_seen = least(s.first_seen, a.first),
            last_seen = greatest(s.last_seen, a.last)
        from (select story_id, count(distinct source_name) as sources, count(*) as n,
                     min(published_at) as first, max(published_at) as last
              from article where story_id = any(%s) group by story_id) a
        where s.node_id = a.story_id
        """,
        (story_ids,),
    )


def refresh_importance(conn: psycopg.Connection, now: datetime) -> int:
    """Re-rank live stories (importance fades with age, so recompute every run)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            select s.node_id, s.magnitude, s.source_count, s.mention_count, s.last_seen, s.importance
            from story s join node n on n.id = s.node_id
            where not n.is_sample and s.kind = 'event' and s.last_seen > %s
            """,
            (now - IMPORTANCE_WINDOW,),
        )
        ids, scores = [], []
        for r in cur.fetchall():
            age = max((now - r["last_seen"]).total_seconds() / 3600, 0) if r["last_seen"] else None
            score = importance(r["magnitude"], r["source_count"], r["mention_count"], age)
            if abs(score - (r["importance"] or 0)) >= 0.1:
                ids.append(r["node_id"])
                scores.append(score)
        if ids:
            cur.execute(
                "update story s set importance = v.score from unnest(%s::text[], %s::real[]) as v(id, score) "
                "where s.node_id = v.id",
                (ids, scores),
            )
    return len(ids)


def write_groups(conn: psycopg.Connection, groups: list[Group], now: datetime) -> dict[str, int]:
    stats = {"stories_new": 0, "stories_updated": 0, "articles": 0}
    touched: list[str] = []
    with conn.cursor() as cur:
        for group in groups:
            if group.story_id is None:
                d = draft(group)
                if d is None or not insert_story(cur, d):
                    continue
                sid, place = d["id"], d["place"]
                stats["stories_new"] += 1
            else:
                merge_into(cur, group)
                sid, place = group.story_id, None
                stats["stories_updated"] += 1
            stats["articles"] += insert_articles(cur, sid, group.items)
            insert_edges(cur, sid, group.items, place)
            touched.append(sid)
        refresh_counts(cur, touched)
    stats["reranked"] = refresh_importance(conn, now)
    return stats

"""Keep the free database small: drop stale drafts, trim old stories.

Rules (live data only; sample data is never touched):
- single-source stories that never got a second source: removed after 36 hours
- embeddings (only needed for clustering): cleared after 3 days
- stories older than 14 days: removed unless important (≥ 60) or part of a
  cascade; nothing is kept beyond 60 days
- links of stories the AI skipped (not business news): 7 days
- run log: 14 days; AI usage log: 90 days
"""

from __future__ import annotations

import psycopg

RULES: list[tuple[str, str]] = [
    (
        "single_source",
        """
        delete from node n using story s
        where n.id = s.node_id and not n.is_sample and s.source_count <= 1
          and s.last_seen < now() - interval '36 hours'
          and s.analysis_status <> 'done'
          and not exists (select 1 from causal_link c
                          where c.src_story = s.node_id or c.dst_story = s.node_id)
        """,
    ),
    (
        "embeddings_cleared",
        """
        update story s set embedding = null from node n
        where n.id = s.node_id and not n.is_sample and s.embedding is not null
          and s.last_seen < now() - interval '3 days'
        """,
    ),
    (
        "old_stories",
        """
        delete from node n using story s
        where n.id = s.node_id and not n.is_sample
          and (s.last_seen < now() - interval '60 days'
               or (s.last_seen < now() - interval '14 days' and s.importance < 60
                   and not exists (select 1 from causal_link c
                                   where c.src_story = s.node_id or c.dst_story = s.node_id)))
        """,
    ),
    ("orphan_articles", "delete from article where story_id is null and not is_sample"),
    ("skipped_urls", "delete from skipped_url where at < now() - interval '7 days'"),
    ("runs", "delete from ingest_run where started_at < now() - interval '14 days'"),
    ("llm_usage", "delete from llm_usage where at < now() - interval '90 days'"),
]


def prune(conn: psycopg.Connection) -> dict[str, int]:
    counts: dict[str, int] = {}
    with conn.cursor() as cur:
        for name, sql in RULES:
            cur.execute(sql)
            counts[name] = cur.rowcount
    return counts

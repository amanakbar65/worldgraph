"""The owner's review list for the knowledge graph (`wg kg review` → docs/kg-review.md).

It lists what the schema couldn't place on its own:
- facts left in props.facts (their label names no property, or the value
  doesn't fit the property's kind);
- stored property keys the node's type doesn't define;
- stored values that no longer validate (for example an entity that was
  deleted);
- links that break their relation's endpoint rules (only rows from before
  migration 0022: the database refuses new ones);
- links with the generic relation `relates_to`;
- causal links whose polarity is unknown.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import psycopg

LIMIT = 200  # rows listed per section (counts are always complete)


def _rows(conn: psycopg.Connection, sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return list(cur.fetchall())


def collect(conn: psycopg.Connection) -> dict[str, Any]:
    """Everything for the review list, read from the database."""
    facts = _rows(
        conn,
        """
        select n.id, n.type, n.name, f.label, f.value
        from node n
        cross join lateral (
            select e.k as label, e.v #>> '{}' as value
            from jsonb_each(case when jsonb_typeof(n.props -> 'facts') = 'object'
                                 then n.props -> 'facts' else '{}'::jsonb end) as e(k, v)
            union all
            select x ->> 'label', x ->> 'value'
            from jsonb_array_elements(case when jsonb_typeof(n.props -> 'facts') = 'array'
                                           then n.props -> 'facts' else '[]'::jsonb end) as x
        ) f
        where n.props ? 'facts'
        order by n.type, n.id, f.label
        """,
    )
    unknown_keys = _rows(
        conn,
        """
        select n.type, k as key, count(*) as nodes, min(n.id) as example
        from node n
        cross join lateral jsonb_object_keys(n.properties) as k
        join node_type nt on nt.key = n.type
        where not exists (select 1 from jsonb_array_elements(nt.properties) d where d ->> 'key' = k)
        group by n.type, k
        order by n.type, k
        """,
    )
    problems = _rows(
        conn,
        """
        select n.id, n.type, n.name, array_to_string(p.problems, '; ') as problems
        from node n
        cross join lateral (select api._property_problems(n.type, n.properties) as problems) p
        where n.properties <> '{}'::jsonb and cardinality(p.problems) > 0
        order by n.type, n.id
        """,
    )
    broken = _rows(
        conn,
        """
        select e.type as relation, s.type as src_type, d.type as dst_type, count(*) as links,
               min(e.src || ' → ' || e.dst) as example
        from edge e
        join node s on s.id = e.src
        join node d on d.id = e.dst
        where not api._relation_allows(e.type, s.type, d.type)
        group by 1, 2, 3
        order by 4 desc, 1, 2, 3
        """,
    )
    related = _rows(
        conn,
        """
        select e.src, s.type as src_type, e.dst, d.type as dst_type, e.is_sample
        from edge e
        join node s on s.id = e.src
        join node d on d.id = e.dst
        where e.type = 'relates_to'
        order by e.is_sample, e.src, e.dst
        """,
    )
    polarity = _rows(
        conn,
        """
        select case when s.direction is null then 'the cause story has no direction yet'
                    else 'set by hand to unknown' end as reason,
               count(*) as links, bool_and(cl.is_sample) as all_sample
        from causal_link cl
        join story s on s.node_id = cl.src_story
        where cl.polarity is null
        group by 1
        order by 1
        """,
    )
    props_keys = _rows(
        conn,
        """
        select n.type, k as key, count(*) as nodes
        from node n cross join lateral jsonb_object_keys(n.props) as k
        where k <> 'facts'
        group by 1, 2
        order by 1, 2
        """,
    )
    summary = {
        "Facts left as notes": len(facts),
        "Unknown property keys": sum(r["nodes"] for r in unknown_keys),
        "Property values that don't validate": len(problems),
        "Links that break relation rules": sum(r["links"] for r in broken),
        "Generic relates_to links": len(related),
        "Causal links with unknown polarity": sum(r["links"] for r in polarity),
    }
    return {
        "generated_at": datetime.now(UTC),
        "summary": summary,
        "facts": facts,
        "unknown_keys": unknown_keys,
        "problems": problems,
        "broken": broken,
        "related": related,
        "polarity": polarity,
        "props_keys": props_keys,
    }


def _table(headers: list[str], rows: list[list[Any]]) -> list[str]:
    def cell(v: Any) -> str:
        return str(v).replace("|", "\\|").replace("\n", " ")

    out = ["| " + " | ".join(headers) + " |", "| " + " | ".join("---" for _ in headers) + " |"]
    out += ["| " + " | ".join(cell(v) for v in row) + " |" for row in rows[:LIMIT]]
    if len(rows) > LIMIT:
        out.append(f"\n…and {len(rows) - LIMIT} more.")
    return out


def render(data: dict[str, Any], source: str = "the database in DATABASE_URL") -> str:
    """The review list as Markdown."""
    lines = [
        "# Knowledge graph: review list",
        "",
        f"Generated by `uv run wg kg review` from {source} on "
        f"{data['generated_at']:%d %b %Y %H:%M} UTC. Rerun it after a migration or a data change; "
        "nothing here blocks the app.",
        "",
        "| What | Count |",
        "| --- | --- |",
        *[f"| {k} | {v} |" for k, v in data["summary"].items()],
        "",
        "## Facts left as notes",
        "",
        "Facts in `props.facts` whose label names no property of the node's type, or whose value "
        "doesn't fit it. They stay as notes; give each a property in `schema/types.yaml` or move it by hand.",
        "",
    ]
    if data["facts"]:
        lines += _table(
            ["Node", "Type", "Label", "Value"],
            [[r["id"], r["type"], r["label"], r["value"]] for r in data["facts"]],
        )
    else:
        lines.append("None.")
    lines += [
        "",
        "## Unknown property keys",
        "",
        "Stored keys the type doesn't define (allowed for now; strict mode can come later).",
        "",
    ]
    if data["unknown_keys"]:
        lines += _table(
            ["Type", "Key", "Nodes", "Example"],
            [[r["type"], r["key"], r["nodes"], r["example"]] for r in data["unknown_keys"]],
        )
    else:
        lines.append("None.")
    lines += ["", "## Property values that don't validate", ""]
    if data["problems"]:
        lines += _table(
            ["Node", "Type", "Problems"], [[r["id"], r["type"], r["problems"]] for r in data["problems"]]
        )
    else:
        lines.append("None.")
    lines += [
        "",
        "## Links that break relation rules",
        "",
        "Rows from before migration 0022 whose source or target type the relation doesn't allow "
        "(new rows are refused). Fix the link, or widen the relation in `schema/types.yaml`.",
        "",
    ]
    if data["broken"]:
        lines += _table(
            ["Relation", "From type", "To type", "Links", "Example"],
            [[r["relation"], r["src_type"], r["dst_type"], r["links"], r["example"]] for r in data["broken"]],
        )
    else:
        lines.append("None.")
    lines += [
        "",
        "## Links with the generic relation `relates_to`",
        "",
        "Each could get a more exact relation. In the sample data they tie a forecast to the story "
        "its conditional effects start from.",
        "",
    ]
    if data["related"]:
        lines += _table(
            ["From", "From type", "To", "To type", "Sample"],
            [
                [r["src"], r["src_type"], r["dst"], r["dst_type"], "yes" if r["is_sample"] else "no"]
                for r in data["related"]
            ],
        )
    else:
        lines.append("None.")
    lines += ["", "## Causal links with unknown polarity", ""]
    if data["polarity"]:
        lines += _table(
            ["Why", "Links", "All sample"],
            [[r["reason"], r["links"], "yes" if r["all_sample"] else "no"] for r in data["polarity"]],
        )
        lines += [
            "",
            "A pipeline draft has no direction until AI analysis runs; its links get their polarity then.",
        ]
    else:
        lines.append("None.")
    lines += [
        "",
        "## Other keys in `props` (for reference)",
        "",
        "Bookkeeping and side-table copies, not facts: regions keep their codes and population in the "
        "`region` table, which their derived properties read.",
        "",
    ]
    lines += _table(["Type", "Key", "Nodes"], [[r["type"], r["key"], r["nodes"]] for r in data["props_keys"]])
    return "\n".join(lines) + "\n"

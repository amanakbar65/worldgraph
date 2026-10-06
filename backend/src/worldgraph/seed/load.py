"""Write a sample-data bundle to Postgres.

The bundle becomes a list of plain SQL statements. `load_bundle` runs them
in one transaction; `write_sql_chunks` saves them as files so they can be
applied through the Supabase connector (no database password needed).

Re-running is safe: sample rows are deleted and recreated, reference rows
(regions, sectors, commodities…) are upserted.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Sequence
from datetime import date, datetime
from pathlib import Path
from typing import Any

import psycopg

from worldgraph.seed.build import Bundle

BATCH = 400


class Raw(str):
    """An SQL expression inserted as-is (never user input)."""


def lit(value: Any) -> str:
    """Render a Python value as an SQL literal."""
    if value is None:
        return "null"
    if isinstance(value, Raw):
        return str(value)
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int | float):
        if value != value or value in (float("inf"), float("-inf")):  # NaN / inf
            return "null"
        return repr(value)
    if isinstance(value, datetime):
        return f"'{value.isoformat()}'::timestamptz"
    if isinstance(value, date):
        return f"'{value.isoformat()}'::date"
    if isinstance(value, dict):
        return _quote(json.dumps(value, ensure_ascii=False, sort_keys=True)) + "::jsonb"
    if isinstance(value, list | tuple):
        if not value:
            return "'{}'::text[]"
        return "array[" + ", ".join(lit(v) for v in value) + "]::text[]"
    return _quote(str(value))


def _quote(text: str) -> str:
    if "\x00" in text:
        raise ValueError("text contains a NUL byte")
    return "'" + text.replace("'", "''") + "'"


def point(lon: float | None, lat: float | None) -> Raw | None:
    if lon is None or lat is None:
        return None
    return Raw(f"st_geogfromtext('SRID=4326;POINT({float(lon):.6f} {float(lat):.6f})')")


def _values(rows: Iterable[Sequence[Any]]) -> str:
    return ",\n".join("(" + ", ".join(lit(v) for v in row) + ")" for row in rows)


def _batched(rows: list[Any], size: int = BATCH) -> Iterable[list[Any]]:
    for i in range(0, len(rows), size):
        yield rows[i : i + size]


NODE_COLS = "id, type, subtype, name, aliases, summary, qid, props, geom, is_sample"


def _node_row(n: dict[str, Any]) -> tuple:
    return (
        n["id"],
        n["type"],
        n["subtype"],
        n["name"],
        n["aliases"],
        n["summary"],
        n["qid"],
        n["props"],
        point(n["lon"], n["lat"]),
        n["is_sample"],
    )


def bundle_statements(bundle: Bundle) -> list[str]:
    stmts: list[str] = [
        "set search_path to public, extensions",
        # Sample rows go first (cascades remove their stories, links, snapshots…).
        "delete from article where is_sample",
        "delete from edge where is_sample",
        "delete from node where is_sample",
    ]

    reference = [n for n in bundle.nodes if not n["is_sample"]]
    sample = [n for n in bundle.nodes if n["is_sample"]]

    for batch in _batched(reference):
        stmts.append(
            f"insert into node ({NODE_COLS}) values\n{_values(_node_row(n) for n in batch)}\n"
            "on conflict (id) do update set type = excluded.type, subtype = excluded.subtype, "
            "name = excluded.name, aliases = excluded.aliases, summary = excluded.summary, "
            "qid = excluded.qid, props = excluded.props, geom = excluded.geom, "
            "is_sample = excluded.is_sample, updated_at = now()"
        )
    region_cols = (
        "node_id, level, iso2, code, parent_id, country_id, population, continent, subregion, capital"
    )
    region_rows = [
        (
            r["node_id"],
            r["level"],
            r["iso2"],
            r["code"],
            r["parent_id"],
            r["country_id"],
            r["population"],
            r["continent"],
            r["subregion"],
            r["capital"],
        )
        for r in bundle.regions
    ]
    for batch in _batched(region_rows):
        stmts.append(
            f"insert into region ({region_cols}) values\n{_values(batch)}\n"
            "on conflict (node_id) do update set level = excluded.level, iso2 = excluded.iso2, "
            "code = excluded.code, parent_id = excluded.parent_id, country_id = excluded.country_id, "
            "population = excluded.population, continent = excluded.continent, "
            "subregion = excluded.subregion, capital = excluded.capital"
        )
    ref_edges = [
        (e["src"], e["dst"], e["type"], e["props"], False) for e in bundle.edges if not e["is_sample"]
    ]
    for batch in _batched(ref_edges):
        stmts.append(
            "insert into edge (src, dst, type, props, is_sample) values\n"
            f"{_values(batch)}\non conflict do nothing"
        )

    for batch in _batched(sample):
        stmts.append(f"insert into node ({NODE_COLS}) values\n{_values(_node_row(n) for n in batch)}")

    story_cols = (
        "node_id, kind, headline, so_what, event_type, impact, direction, magnitude, horizon, "
        "confidence, importance, sectors, primary_region, location, h3_cell, actions, first_seen, "
        "last_seen, mention_count, source_count, analysis_status, analysed_at, analysis_engine, "
        "country_id, admin1_id"
    )
    story_rows = [
        (
            s["node_id"],
            s["kind"],
            s["headline"],
            s["so_what"],
            s["event_type"],
            s["impact"],
            s["direction"],
            s["magnitude"],
            s["horizon"],
            s["confidence"],
            s["importance"],
            s["sectors"],
            s["primary_region"],
            point(s["lon"], s["lat"]),
            s["h3_cell"],
            s["actions"],
            s["first_seen"],
            s["last_seen"],
            s["mention_count"],
            s["source_count"],
            "done",
            bundle.now,
            "sample",
            s["country_id"],
            s["admin1_id"],
        )
        for s in bundle.stories
    ]
    for batch in _batched(story_rows, 200):
        stmts.append(f"insert into story ({story_cols}) values\n{_values(batch)}")

    article_rows = [
        (
            a["story_id"],
            None,
            a["source_name"],
            a["title"],
            a["published_at"],
            "en",
            a["snippet"],
            True,
        )
        for a in bundle.articles
    ]
    for batch in _batched(article_rows):
        stmts.append(
            "insert into article (story_id, url, source_name, title, published_at, lang, snippet, "
            f"is_sample) values\n{_values(batch)}"
        )

    fc_cols = (
        "node_id, provider, provider_ref, question, short_title, category, end_date, "
        "resolution_rule, volume_unit"
    )
    fc_rows = [
        (
            f["node_id"],
            f["provider"],
            f["provider_ref"],
            f["question"],
            f["short_title"],
            f["category"],
            f["end_date"],
            f["resolution_rule"],
            f["volume_unit"],
        )
        for f in bundle.forecasts
    ]
    for batch in _batched(fc_rows):
        stmts.append(f"insert into forecast ({fc_cols}) values\n{_values(batch)}")
    snap_rows = [
        (s["forecast_id"], s["ts"], s["probability"], s["volume"], s["liquidity"]) for s in bundle.snapshots
    ]
    for batch in _batched(snap_rows, 800):
        stmts.append(
            "insert into forecast_snapshot (forecast_id, ts, probability, volume, liquidity) values\n"
            f"{_values(batch)}"
        )

    ind_rows = [
        (
            i["node_id"],
            i["subject_id"],
            i["name"],
            i["unit"],
            i["frequency"],
            i["higher_is"],
            i["source_name"],
        )
        for i in bundle.indicators
    ]
    for batch in _batched(ind_rows):
        stmts.append(
            "insert into indicator_series (node_id, subject_id, name, unit, frequency, higher_is, "
            f"source_name) values\n{_values(batch)}"
        )
    point_rows = [(p["series_id"], p["date"], p["value"]) for p in bundle.points]
    for batch in _batched(point_rows, 800):
        stmts.append(f"insert into indicator_point (series_id, date, value) values\n{_values(batch)}")

    sample_edges = [(e["src"], e["dst"], e["type"], e["props"], True) for e in bundle.edges if e["is_sample"]]
    for batch in _batched(sample_edges):
        stmts.append(
            "insert into edge (src, dst, type, props, is_sample) values\n"
            f"{_values(batch)}\non conflict do nothing"
        )

    link_cols = (
        "src_story, dst_story, link_type, mechanism, direction, lag_days, confidence, forecast_id, "
        "outcome, method, model_version, is_sample"
    )
    link_rows = [
        (
            lk["src_story"],
            lk["dst_story"],
            lk["link_type"],
            lk["mechanism"],
            lk["direction"],
            lk["lag_days"],
            lk["confidence"],
            lk["forecast_id"],
            lk["outcome"],
            "sample",
            None,
            True,
        )
        for lk in bundle.links
    ]
    for batch in _batched(link_rows):
        stmts.append(f"insert into causal_link ({link_cols}) values\n{_values(batch)}")
    ev_rows = [
        (lk["src_story"], lk["dst_story"], lk["outcome"], "Sample evidence", lk["evidence"][:300])
        for lk in bundle.links
    ]
    for batch in _batched(ev_rows):
        stmts.append(
            "insert into evidence (causal_link_id, source_name, url, published_at, snippet, is_sample)\n"
            "select cl.id, v.source_name, null, null, v.snippet, true\n"
            f"from (values\n{_values(batch)}\n) as v(src, dst, outcome, source_name, snippet)\n"
            "join causal_link cl on cl.src_story = v.src and cl.dst_story = v.dst "
            "and cl.outcome is not distinct from v.outcome"
        )
    stmts.append("analyze node; analyze edge; analyze story; analyze forecast_snapshot")
    return stmts


def load_bundle(conn: psycopg.Connection, bundle: Bundle) -> dict[str, int]:
    """Replace the sample data in one transaction."""
    with conn.transaction():
        for stmt in bundle_statements(bundle):
            conn.execute(stmt)
    return bundle.summary()


def write_sql_chunks(bundle: Bundle, out_dir: Path, max_bytes: int = 400_000) -> list[Path]:
    """Save the statements as numbered files of at most `max_bytes` each."""
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("seed_*.sql"):
        old.unlink()
    chunks: list[list[str]] = [[]]
    size = 0
    for stmt in bundle_statements(bundle):
        if stmt.startswith("set search_path"):
            continue
        if size + len(stmt) > max_bytes and chunks[-1]:
            chunks.append([])
            size = 0
        chunks[-1].append(stmt)
        size += len(stmt)
    paths = []
    for i, chunk in enumerate(chunks, start=1):
        path = out_dir / f"seed_{i:03d}.sql"
        path.write_text(
            "set search_path to public, extensions;\n" + ";\n\n".join(chunk) + ";\n",
            encoding="utf-8",
        )
        paths.append(path)
    return paths

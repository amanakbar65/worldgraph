"""Turn the sample-data files into a validated, time-resolved bundle.

Everything is deterministic for a given `now`: random series are seeded from
each item's id, so `wg seed check` and `wg seed load` always agree.
"""

from __future__ import annotations

import hashlib
import json
import math
import random
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import h3
import yaml
from pydantic import ValidationError

from worldgraph.scoring import importance
from worldgraph.seed.models import Entity, Forecast, Indicator, Link, Story, Storyline

SEED_DIR = Path(__file__).parent
GAZETTEER = SEED_DIR / "gazetteer.json"

# Invented publication names for sample sources. Never real outlets.
SAMPLE_SOURCES = (
    "Sample Wire",
    "Example Business Daily",
    "Demo Trade Journal",
    "Placeholder Markets Report",
    "Sample Policy Digest",
    "Demo Energy Monitor",
    "Example Freight Weekly",
    "Sample Agri Bulletin",
)


class SeedError(ValueError):
    """A problem in the sample-data files, with a readable message."""


@dataclass
class Bundle:
    now: datetime
    nodes: list[dict[str, Any]] = field(default_factory=list)
    regions: list[dict[str, Any]] = field(default_factory=list)
    edges: list[dict[str, Any]] = field(default_factory=list)
    stories: list[dict[str, Any]] = field(default_factory=list)
    articles: list[dict[str, Any]] = field(default_factory=list)
    links: list[dict[str, Any]] = field(default_factory=list)
    forecasts: list[dict[str, Any]] = field(default_factory=list)
    snapshots: list[dict[str, Any]] = field(default_factory=list)
    indicators: list[dict[str, Any]] = field(default_factory=list)
    points: list[dict[str, Any]] = field(default_factory=list)

    def summary(self) -> dict[str, int]:
        sample_nodes = [n for n in self.nodes if n["is_sample"]]
        return {
            "regions (countries, states, cities, blocs)": len(self.regions),
            "reference entities": sum(1 for n in self.nodes if not n["is_sample"] and n["type"] != "region"),
            "sample stories": sum(1 for s in self.stories if s["kind"] == "event"),
            "sample projected impacts": sum(1 for s in self.stories if s["kind"] == "projected"),
            "sample causal links": len(self.links),
            "sample forecasts": len(self.forecasts),
            "forecast snapshots": len(self.snapshots),
            "indicator series": len(self.indicators),
            "sample nodes in total": len(sample_nodes),
        }


def _rng(key: str) -> random.Random:
    return random.Random(int(hashlib.sha256(key.encode()).hexdigest()[:16], 16))


def _read_yaml(path: Path) -> Any:
    try:
        return yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise SeedError(f"{path.name}: not valid YAML ({exc})") from exc


def _validation_message(path: Path, exc: ValidationError) -> str:
    lines = [f"{path.name}:"]
    for err in exc.errors()[:12]:
        where = ".".join(str(p) for p in err["loc"])
        lines.append(f"  {where}: {err['msg']}")
    return "\n".join(lines)


def load_sources(
    seed_dir: Path = SEED_DIR,
) -> tuple[list[Entity], list[Indicator], list[Storyline]]:
    entities: list[Entity] = []
    for path in sorted((seed_dir / "entities").glob("*.yaml")):
        if path.name == "indicators.yaml":
            continue
        raw = _read_yaml(path) or []
        for item in raw:
            try:
                entities.append(Entity.model_validate(item))
            except ValidationError as exc:
                raise SeedError(_validation_message(path, exc)) from exc
    indicators: list[Indicator] = []
    ind_path = seed_dir / "entities" / "indicators.yaml"
    if ind_path.exists():
        for item in _read_yaml(ind_path) or []:
            try:
                indicators.append(Indicator.model_validate(item))
            except ValidationError as exc:
                raise SeedError(_validation_message(ind_path, exc)) from exc
    storylines: list[Storyline] = []
    for path in sorted((seed_dir / "storylines").glob("*.yaml")):
        try:
            storylines.append(Storyline.model_validate(_read_yaml(path)))
        except ValidationError as exc:
            raise SeedError(_validation_message(path, exc)) from exc
    return entities, indicators, storylines


def load_gazetteer(path: Path = GAZETTEER) -> list[dict[str, Any]]:
    return json.loads(path.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Series generators
# ---------------------------------------------------------------------------


def forecast_snapshots(fc: Forecast, now: datetime) -> list[dict[str, Any]]:
    """Daily points over `days`, then hourly for the last 72 hours."""
    h = fc.history
    rng = _rng(fc.id)
    start_ts = now - timedelta(days=h.days)
    times: list[datetime] = [start_ts + timedelta(days=d) for d in range(h.days - 3)]
    hourly_from = now - timedelta(hours=72)
    times += [hourly_from + timedelta(hours=i) for i in range(73)]
    total_moves = sum(m.delta for m in h.moves)
    base_end = h.end - total_moves
    rows = []
    walk = 0.0
    for t in times:
        frac = (t - start_ts) / (now - start_ts)
        value = h.start + (base_end - h.start) * frac
        walk = walk * 0.85 + rng.gauss(0, h.noise)
        if t < now - timedelta(hours=2):
            value += walk  # the last two hours land exactly on `end`
        for move in h.moves:
            if t >= now - timedelta(days=move.days_ago):
                value += move.delta
        p = min(0.99, max(0.01, value))
        rows.append(
            {
                "forecast_id": fc.id,
                "ts": t,
                "probability": round(p, 4),
                "volume": round(h.volume * (0.08 + 0.92 * frac**1.4), 0),
                "liquidity": round(h.liquidity * (0.5 + 0.5 * frac), 0),
            }
        )
    rows[-1]["probability"] = round(h.end, 4)
    return rows


_STEP_DAYS = {"daily": 1, "weekly": 7, "monthly": 30, "quarterly": 91}


def indicator_points(ind: Indicator, today: date) -> list[dict[str, Any]]:
    rng = _rng(ind.id)
    step = _STEP_DAYS[ind.frequency]
    span = abs(ind.end - ind.start)
    level = max(abs(ind.start), abs(ind.end), 1e-9)
    noise_scale = ind.volatility * (span if span > 0 else level * 0.05)
    rows = []
    for i in range(ind.points):
        frac = i / (ind.points - 1)
        eased = 0.5 - 0.5 * math.cos(math.pi * frac)
        value = ind.start + (ind.end - ind.start) * eased
        if 0 < i < ind.points - 1:
            value += rng.gauss(0, noise_scale)
        rows.append(
            {
                "series_id": ind.id,
                "date": today - timedelta(days=step * (ind.points - 1 - i)),
                "value": round(value, ind.decimals),
            }
        )
    return rows


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------


def build_bundle(now: datetime | None = None, seed_dir: Path = SEED_DIR) -> Bundle:
    now = (now or datetime.now(UTC)).replace(microsecond=0)
    bundle = Bundle(now=now)
    entities, indicators, storylines = load_sources(seed_dir)

    # Regions from the gazetteer -------------------------------------------
    coords: dict[str, tuple[float, float]] = {}
    region_parent: dict[str, str | None] = {}
    region_level: dict[str, str] = {}
    country_of: dict[str, str] = {}
    gazetteer = load_gazetteer(seed_dir / "gazetteer.json")
    for row in gazetteer:
        rid = row["id"]
        coords[rid] = (row["lon"], row["lat"])
        region_parent[rid] = row.get("parent")
        region_level[rid] = row["subtype"]
    for rid, level in region_level.items():
        if level == "country":
            country_of[rid] = rid
        else:
            cur = region_parent.get(rid)
            while cur and region_level.get(cur) != "country":
                cur = region_parent.get(cur)
            if cur:
                country_of[rid] = cur
    for row in gazetteer:
        rid, level = row["id"], row["subtype"]
        props: dict[str, Any] = {
            k: row[k]
            for k in ("iso2", "iso3", "code", "continent", "subregion", "population", "capital")
            if row.get(k) not in (None, False)
        }
        summary = None
        if level == "country":
            summary = f"Country in {row.get('subregion') or row.get('continent')}"
        bundle.nodes.append(
            _node(
                rid,
                "region",
                level,
                row["name"],
                summary=summary,
                qid=row.get("qid"),
                props=props,
                lon=row["lon"],
                lat=row["lat"],
                is_sample=False,
            )
        )
        bundle.regions.append(
            {
                "node_id": rid,
                "level": level,
                "iso2": row.get("iso2"),
                "code": row.get("code"),
                "parent_id": row.get("parent"),
                "country_id": country_of.get(rid),
                "population": row.get("population"),
                "continent": row.get("continent"),
                "subregion": row.get("subregion"),
                "capital": bool(row.get("capital")),
            }
        )
        if row.get("parent"):
            bundle.edges.append(_edge(rid, row["parent"], "part_of", sample=False))

    known: dict[str, str] = {r["id"]: "region" for r in gazetteer}  # id -> type

    def register(node_id: str, node_type: str, where: str) -> None:
        if node_id in known:
            raise SeedError(f"{where}: id {node_id} is defined twice")
        known[node_id] = node_type

    # Entities (shared files first, then storyline-local ones) ---------------
    all_entities: list[tuple[Entity, str]] = [(e, "entities") for e in entities]
    for sl in storylines:
        all_entities += [(e, f"storylines/{sl.id}") for e in sl.entities]
    for ent, where in all_entities:
        register(ent.id, "region" if ent.type == "bloc" else ent.type, where)
    for ent, _where in all_entities:
        if ent.lon is not None and ent.lat is not None:
            coords[ent.id] = (ent.lon, ent.lat)
        elif ent.located_in and ent.located_in in coords:
            coords[ent.id] = coords[ent.located_in]
    for ent, where in all_entities:
        for ref in [
            ent.located_in,
            *ent.produced_by,
            *ent.members,
            *ent.owns,
            *ent.competes_with,
            *ent.depends_on,
            *ent.regions,
        ]:
            if ref and ref not in known:
                raise SeedError(f"{where}: {ent.id} refers to unknown id {ref}")
        node_type = "region" if ent.type == "bloc" else ent.type
        props: dict[str, Any] = dict(ent.facts)
        if ent.icon:
            props["icon"] = ent.icon
        if ent.hs:
            props["hs"] = ent.hs
        if ent.sectors:
            props["sectors"] = list(ent.sectors)
        lon, lat = coords.get(ent.id, (None, None))
        bundle.nodes.append(
            _node(
                ent.id,
                node_type,
                ent.subtype or (ent.type if ent.type == "bloc" else None),
                ent.name,
                summary=ent.summary,
                aliases=ent.aliases,
                qid=ent.qid,
                props=props,
                lon=lon,
                lat=lat,
                is_sample=ent.sample,
            )
        )
        if ent.type == "bloc":
            bundle.regions.append(
                {
                    "node_id": ent.id,
                    "level": "bloc",
                    "iso2": ent.facts.get("iso2"),
                    "code": None,
                    "parent_id": None,
                    "country_id": None,
                    "population": None,
                    "continent": None,
                    "subregion": None,
                    "capital": False,
                }
            )
        for member in ent.members:
            bundle.edges.append(_edge(member, ent.id, "member_of", sample=ent.sample))
        if ent.located_in:
            bundle.edges.append(_edge(ent.id, ent.located_in, "located_in", sample=ent.sample))
        for region in ent.produced_by:
            bundle.edges.append(_edge(region, ent.id, "produces", sample=ent.sample))
        for target in ent.owns:
            bundle.edges.append(_edge(ent.id, target, "owns", sample=ent.sample))
        for other in ent.competes_with:
            bundle.edges.append(_edge(ent.id, other, "competes_with", sample=ent.sample))
        for target in ent.depends_on:
            bundle.edges.append(_edge(ent.id, target, "depends_on", sample=ent.sample))
        for region in ent.regions:
            bundle.edges.append(_edge(ent.id, region, "about", sample=ent.sample))
        for sector in ent.sectors:
            if ent.type != "sector":
                bundle.edges.append(_edge(ent.id, f"sector:{sector}", "in_sector", sample=ent.sample))

    # Indicators -------------------------------------------------------------
    today = now.date()
    for ind in indicators:
        register(ind.id, "indicator", "entities/indicators.yaml")
        if ind.subject not in known:
            raise SeedError(f"indicators.yaml: {ind.id} subject {ind.subject} is unknown")
        bundle.nodes.append(
            _node(
                ind.id,
                "indicator",
                ind.frequency,
                ind.name,
                summary=None,
                props={"unit": ind.unit},
                is_sample=True,
            )
        )
        bundle.indicators.append(
            {
                "node_id": ind.id,
                "subject_id": ind.subject,
                "name": ind.name,
                "unit": ind.unit,
                "frequency": ind.frequency,
                "higher_is": ind.higher_is,
                "source_name": "Sample series",
            }
        )
        bundle.points += indicator_points(ind, today)
        bundle.edges.append(_edge(ind.id, ind.subject, "about", sample=True))

    # Stories and forecasts ----------------------------------------------------
    stories: dict[str, tuple[Story, str]] = {}
    forecasts: dict[str, tuple[Forecast, str]] = {}
    for sl in storylines:
        for st in sl.stories:
            register(st.id, "story", f"storylines/{sl.id}")
            stories[st.id] = (st, sl.id)
        for fc in sl.forecasts:
            register(fc.id, "forecast", f"storylines/{sl.id}")
            forecasts[fc.id] = (fc, sl.id)

    def place(node_id: str, where: str) -> tuple[float, float]:
        if node_id not in known:
            raise SeedError(f"{where}: unknown location {node_id}")
        if node_id not in coords:
            raise SeedError(f"{where}: {node_id} has no position; give it lon/lat or located_in")
        return coords[node_id]

    def region_chain(node_id: str) -> tuple[str | None, str | None, str | None]:
        """(primary region, country, admin1) for a story location."""
        ent_region = node_id
        if known.get(node_id) != "region":
            ent = next((e for e, _ in all_entities if e.id == node_id), None)
            ent_region = ent.located_in if ent else None
        if not ent_region or ent_region not in region_level:
            return (ent_region, None, None)
        country = country_of.get(ent_region)
        admin1 = None
        cur: str | None = ent_region
        while cur:
            if region_level.get(cur) == "state":
                admin1 = cur
                break
            cur = region_parent.get(cur)
        return (ent_region, country, admin1)

    for sid, (st, sl_id) in stories.items():
        where = f"storylines/{sl_id}: {sid}"
        lon, lat = place(st.at, where)
        for ref in st.mentions:
            if ref not in known:
                raise SeedError(f"{where}: mentions unknown id {ref}")
        primary, country, admin1 = region_chain(st.at)
        first_seen = None if st.kind == "projected" else now - timedelta(hours=st.age_hours or 0)
        rng = _rng(sid)
        mentions = st.sources * rng.randint(3, 9)
        bundle.nodes.append(_node(sid, "story", st.kind, st.headline, lon=lon, lat=lat, is_sample=True))
        bundle.stories.append(
            {
                "node_id": sid,
                "kind": st.kind,
                "headline": st.headline,
                "so_what": st.so_what,
                "event_type": st.event_type,
                "impact": st.impact,
                "direction": st.direction,
                "magnitude": st.magnitude,
                "horizon": st.horizon,
                "confidence": st.confidence,
                "importance": importance(
                    st.magnitude,
                    st.sources,
                    mentions,
                    st.age_hours,
                    projected=st.kind == "projected",
                ),
                "sectors": list(st.sectors),
                "primary_region": primary if primary in region_level else None,
                "country_id": country,
                "admin1_id": admin1,
                "lon": lon,
                "lat": lat,
                "h3_cell": h3.latlng_to_cell(lat, lon, 7),
                "actions": list(st.actions),
                "first_seen": first_seen,
                "last_seen": first_seen + timedelta(hours=min(st.age_hours or 0, 6)) if first_seen else None,
                "mention_count": mentions if st.kind == "event" else 0,
                "source_count": st.sources if st.kind == "event" else 0,
            }
        )
        refs = {st.at, *st.mentions}
        for sector in st.sectors:
            refs.add(f"sector:{sector}")
        for ref in sorted(refs):
            bundle.edges.append(_edge(sid, ref, "mentions", sample=True))
        if st.kind == "event":
            for i in range(st.sources):
                bundle.articles.append(
                    {
                        "story_id": sid,
                        "source_name": SAMPLE_SOURCES[(rng.randint(0, 99) + i) % len(SAMPLE_SOURCES)],
                        "title": st.headline,
                        "published_at": first_seen + timedelta(minutes=rng.randint(0, 240))
                        if first_seen
                        else None,
                        "snippet": None,
                    }
                )

    for fid, (fc, sl_id) in forecasts.items():
        where = f"storylines/{sl_id}: {fid}"
        lon, lat = place(fc.location, where)
        for ref in fc.about:
            if ref not in known:
                raise SeedError(f"{where}: about unknown id {ref}")
        bundle.nodes.append(
            _node(
                fid,
                "forecast",
                "binary",
                fc.short_title,
                summary=fc.question,
                lon=lon,
                lat=lat,
                is_sample=True,
            )
        )
        bundle.forecasts.append(
            {
                "node_id": fid,
                "provider": "sample",
                "provider_ref": fid,
                "question": fc.question,
                "short_title": fc.short_title,
                "category": fc.category,
                "end_date": now + timedelta(days=fc.end_in_days),
                "resolution_rule": fc.resolution_rule,
                "volume_unit": None,
            }
        )
        bundle.snapshots += forecast_snapshots(fc, now)
        home_region = next((r for r in fc.about if known.get(r) == "region"), None)
        if not home_region:
            loc_region, _, _ = region_chain(fc.location)
            if loc_region:
                bundle.edges.append(_edge(fid, loc_region, "about", sample=True))
        for ref in fc.about:
            bundle.edges.append(_edge(fid, ref, "about", sample=True))

    # Links ------------------------------------------------------------------
    seen_links: set[tuple[str, str, str | None]] = set()
    for sl in storylines:
        for link in sl.links:
            _check_link(link, stories, forecasts, sl.id)
            key = (link.from_, link.to, link.outcome)
            if key in seen_links:
                raise SeedError(f"storylines/{sl.id}: duplicate link {link.from_} → {link.to}")
            seen_links.add(key)
            src, dst = stories[link.from_][0], stories[link.to][0]
            bundle.links.append(
                {
                    "src_story": link.from_,
                    "dst_story": link.to,
                    "link_type": link.type,
                    "mechanism": link.mechanism,
                    "direction": link.direction,
                    "lag_days": link.lag_days,
                    "confidence": link.confidence,
                    "forecast_id": link.forecast,
                    "outcome": link.outcome,
                    "evidence": link.evidence
                    or f"Sample evidence: {src.headline.rstrip('.')} {link.mechanism}, "
                    f"affecting {dst.headline[0].lower()}{dst.headline[1:].rstrip('.')}.",
                }
            )
            if link.forecast:
                bundle.edges.append(_edge(link.forecast, link.from_, "relates_to", sample=True))

    _dedupe_edges(bundle)
    qids: dict[str, str] = {}
    for n in bundle.nodes:
        if n["qid"]:
            if n["qid"] in qids:
                raise SeedError(f"Wikidata id {n['qid']} is on both {qids[n['qid']]} and {n['id']}")
            qids[n["qid"]] = n["id"]
    return bundle


def _check_link(link: Link, stories: dict[str, Any], forecasts: dict[str, Any], sl_id: str) -> None:
    where = f"storylines/{sl_id}: link {link.from_} → {link.to}"
    if link.from_ not in stories or link.to not in stories:
        raise SeedError(f"{where}: both ends must be story ids")
    if link.from_ == link.to:
        raise SeedError(f"{where}: a story can't cause itself")
    if link.forecast and link.forecast not in forecasts:
        raise SeedError(f"{where}: unknown forecast {link.forecast}")
    dst_kind = stories[link.to][0].kind
    if link.type in ("projected", "conditional") and dst_kind != "projected":
        raise SeedError(f"{where}: {link.type} links must point to a projected story")
    if link.type in ("reported", "inferred") and dst_kind != "event":
        raise SeedError(f"{where}: {link.type} links must point to an event (it has happened)")


def _node(
    node_id: str,
    node_type: str,
    subtype: str | None,
    name: str,
    *,
    summary: str | None = None,
    aliases: list[str] | None = None,
    qid: str | None = None,
    props: dict[str, Any] | None = None,
    lon: float | None = None,
    lat: float | None = None,
    is_sample: bool,
) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": node_type,
        "subtype": subtype,
        "name": name,
        "aliases": aliases or [],
        "summary": summary,
        "qid": qid,
        "props": props or {},
        "lon": lon,
        "lat": lat,
        "is_sample": is_sample,
    }


def _edge(src: str, dst: str, edge_type: str, *, sample: bool, props: dict | None = None) -> dict[str, Any]:
    return {"src": src, "dst": dst, "type": edge_type, "props": props or {}, "is_sample": sample}


def _dedupe_edges(bundle: Bundle) -> None:
    seen: set[tuple[str, str, str, str | None]] = set()
    unique = []
    for e in bundle.edges:
        key = (e["src"], e["dst"], e["type"], e["props"].get("year"))
        if key in seen or e["src"] == e["dst"]:
            continue
        seen.add(key)
        unique.append(e)
    bundle.edges = unique

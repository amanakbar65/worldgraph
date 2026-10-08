"""Check the built map layers (frontend/public/geo/) against the gazetteer.

Pure Python, so it runs in tests and CI without the geometry libraries.
Run with `uv run wg geo assets --check` (the build runs it too).
"""

from __future__ import annotations

import json
from collections import Counter
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from worldgraph.config import REPO_DIR
from worldgraph.geo.gazetteer import GAZETTEER_PATH, geometry_contains

GEO_DIR = REPO_DIR / "frontend" / "public" / "geo"
CONTINENTS_PATH = REPO_DIR / "frontend" / "src" / "lib" / "geo-continents.json"

CONTINENT_FILES = ("africa", "asia", "europe", "north-america", "south-america", "oceania")
COUNTRY_BUDGET = 450_000
ADMIN1_BUDGET = 1_600_000

# (lon, lat)
GILGIT = (74.31, 35.92)
AKSAI_CHIN = (79.5, 35.2)
MUZAFFARABAD = (73.47, 34.37)
SHAKSGAM = (76.5, 36.0)
# Land India claims, with who administers it (the international default view).
CLAIMED = {
    "Gilgit": (GILGIT, "region:pk"),
    "Muzaffarabad": (MUZAFFARABAD, "region:pk"),
    "Aksai Chin": (AKSAI_CHIN, "region:cn"),
    "the Shaksgam valley": (SHAKSGAM, "region:cn"),
}
JAMMU_KASHMIR = "region:in-jk"
LADAKH = "region:in-la"


# --------------------------------------------------------------------------
# Reading TopoJSON
# --------------------------------------------------------------------------


def _arcs(topology: dict[str, Any]) -> list[list[list[float]]]:
    transform = topology.get("transform")
    out = []
    for arc in topology["arcs"]:
        if transform is None:
            out.append([[float(x), float(y)] for x, y in arc])
            continue
        (kx, ky), (tx, ty) = transform["scale"], transform["translate"]
        x = y = 0
        points = []
        for dx, dy in arc:
            x, y = x + dx, y + dy
            points.append([x * kx + tx, y * ky + ty])
        out.append(points)
    return out


def _ring(refs: list[int], arcs: list[list[list[float]]]) -> list[list[float]]:
    ring: list[list[float]] = []
    for ref in refs:
        arc = arcs[ref] if ref >= 0 else arcs[~ref][::-1]
        ring.extend(arc if not ring else arc[1:])
    return ring


def features(topology: dict[str, Any], object_name: str | None = None) -> Iterator[dict[str, Any]]:
    """GeoJSON-like features (properties + geometry) from a TopoJSON topology."""
    arcs = _arcs(topology)
    objects = topology["objects"]
    obj = objects[object_name] if object_name else next(iter(objects.values()))
    for g in obj["geometries"]:
        if g["type"] == "Polygon":
            coords: Any = [_ring(r, arcs) for r in g["arcs"]]
        elif g["type"] == "MultiPolygon":
            coords = [[_ring(r, arcs) for r in p] for p in g["arcs"]]
        else:
            coords = []
        yield {
            "properties": g.get("properties") or {},
            "geometry": {"type": g["type"], "coordinates": coords},
        }


def load(path: Path) -> list[dict[str, Any]]:
    return list(features(json.loads(path.read_text(encoding="utf-8"))))


def _find(feats: list[dict[str, Any]], region: str) -> dict[str, Any] | None:
    return next((f for f in feats if f["properties"].get("id") == region), None)


def _contains(feature: dict[str, Any] | None, point: tuple[float, float]) -> bool:
    return feature is not None and geometry_contains(feature["geometry"], *point)


def _label(feature: dict[str, Any]) -> str:
    p = feature["properties"]
    return p.get("id") or f"land without an id ({p.get('name')})"


def _twice_area(ring: list[list[float]]) -> float:
    """Signed area x2 (> 0 counterclockwise), measured from the first point to keep precision."""
    ox, oy = ring[0]
    pts = [(x - ox, y - oy) for x, y in ring]
    return sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(pts, pts[1:], strict=False))


def ring_problems(feats: list[dict[str, Any]]) -> list[str]:
    """Rings that renderers may choke on: fewer than 4 points, no area, or wound the wrong way.

    GeoJSON (RFC 7946) winding: outer rings counterclockwise, holes clockwise.
    """
    problems: list[str] = []
    for f in feats:
        g = f["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        if not polys:
            problems.append(f"{_label(f)} has no polygon")
        for rings in polys:
            for i, ring in enumerate(rings):
                area = _twice_area(ring) if len(ring) >= 4 else 0.0
                if area == 0.0 or ring[0] != ring[-1]:
                    problems.append(f"{_label(f)} has a collapsed or open ring")
                elif (area > 0) != (i == 0):
                    problems.append(f"{_label(f)} has a {'hole' if i else 'ring'} wound the wrong way")
    return sorted(set(problems))


# --------------------------------------------------------------------------
# Checks
# --------------------------------------------------------------------------


@dataclass
class CheckReport:
    problems: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    sizes: dict[str, int] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return not self.problems


def _ids(feats: list[dict[str, Any]]) -> list[str]:
    return [f["properties"]["id"] for f in feats if f["properties"].get("id")]


def _dupes(ids: list[str]) -> list[str]:
    return sorted(i for i, n in Counter(ids).items() if n > 1)


def check_assets(
    geo_dir: Path = GEO_DIR,
    gazetteer_path: Path = GAZETTEER_PATH,
    continents_path: Path = CONTINENTS_PATH,
) -> CheckReport:
    report = CheckReport()
    problems, notes = report.problems, report.notes
    gazetteer = json.loads(gazetteer_path.read_text(encoding="utf-8"))
    countries = {r["id"]: r for r in gazetteer if r["subtype"] == "country"}
    states = {r["id"]: r for r in gazetteer if r["subtype"] == "state"}
    cities = [r for r in gazetteer if r["subtype"] == "city"]
    continent_of: dict[str, str] = json.loads(continents_path.read_text(encoding="utf-8"))

    for path in sorted(geo_dir.glob("*.json")):
        report.sizes[path.name] = path.stat().st_size
        budget = ADMIN1_BUDGET if path.name.startswith("admin1-") else None
        budget = COUNTRY_BUDGET if path.name.startswith("countries") else budget
        if budget and path.stat().st_size > budget:
            problems.append(f"{path.name} is {path.stat().st_size:,} bytes (budget {budget:,})")

    # Continent map: every country, valid file keys.
    if set(continent_of) != set(countries):
        problems.append("geo-continents.json does not list exactly the gazetteer countries")
    bad_keys = sorted({v for v in continent_of.values() if v not in CONTINENT_FILES})
    if bad_keys:
        problems.append(f"geo-continents.json uses unknown files: {bad_keys}")

    # Countries, both worldviews.
    default = load(geo_dir / "countries.json")
    india = load(geo_dir / "countries-in.json")
    for name, feats in (("countries.json", default), ("countries-in.json", india)):
        ids = _ids(feats)
        if _dupes(ids):
            problems.append(f"{name}: duplicate ids {_dupes(ids)}")
        unknown = sorted(set(ids) - set(countries))
        if unknown:
            problems.append(f"{name}: ids not in the gazetteer {unknown}")
        missing = sorted(set(countries) - set(ids))
        if name == "countries.json" and missing:
            problems.append(f"{name}: gazetteer countries without a shape {missing}")
        elif missing:
            notes.append(f"{name}: no separate shape in this worldview for {missing}")

    # India's view: India has all the land it claims, and no other shape covers it.
    # The default view: that land is where it is administered.
    for label, (point, administrator) in CLAIMED.items():
        in_view = [_label(f) for f in india if _contains(f, point)] or "no shape"
        if in_view != ["region:in"]:
            problems.append(f"countries-in.json: {label} is in {in_view}, expected India only")
        default_view = [_label(f) for f in default if _contains(f, point)] or "no shape"
        if default_view != [administrator]:
            problems.append(f"countries.json: {label} is in {default_view}, expected {administrator}")
    for name, feats in (("countries.json", default), ("countries-in.json", india)):
        for problem in ring_problems(feats):
            problems.append(f"{name}: {problem}")

    # States, default worldview: exactly the gazetteer's, each in its continent's file.
    admin1 = {key: load(geo_dir / f"admin1-{key}.json") for key in CONTINENT_FILES}
    seen: list[str] = []
    for key, feats in admin1.items():
        for f in feats:
            p = f["properties"]
            seen.append(str(p.get("id")))
            row = states.get(p.get("id"))
            if row is None:
                continue
            if p.get("country") != row["parent"]:
                problems.append(f"admin1-{key}.json: {p['id']} has country {p.get('country')}")
            if continent_of.get(row["parent"]) != key:
                problems.append(f"admin1-{key}.json: {p['id']} belongs in another continent file")
            if p.get("name") != row["name"]:
                problems.append(f"admin1-{key}.json: {p['id']} is named {p.get('name')!r}")
    if _dupes(seen):
        problems.append(f"admin1 files: duplicate ids {_dupes(seen)}")
    not_in_gazetteer = sorted(set(seen) - set(states))
    if not_in_gazetteer:
        problems.append(f"admin1 files: ids not in the gazetteer {not_in_gazetteer}")
    without_shape = sorted(set(states) - set(seen))
    if without_shape:
        problems.append(f"gazetteer states without a shape {without_shape}")

    # States, India's worldview for Asia.
    asia_default = admin1["asia"]
    asia_in = load(geo_dir / "admin1-asia-in.json")
    layers = {
        **{f"admin1-{key}.json": feats for key, feats in admin1.items()},
        "admin1-asia-in.json": asia_in,
    }
    for name, feats in layers.items():
        found = ring_problems(feats)
        problems.extend(f"{name}: {problem}" for problem in found[:10])
        if len(found) > 10:
            problems.append(f"{name}: {len(found) - 10} more shapes with ring problems")
    manifest = json.loads((geo_dir / "manifest.json").read_text(encoding="utf-8"))
    hidden = set(manifest["worldviews"]["india"]["statesNotShown"])
    expected = set(_ids(asia_default)) - hidden
    if set(_ids(asia_in)) != expected:
        diff = sorted(set(_ids(asia_in)) ^ expected)
        problems.append(f"admin1-asia-in.json: ids differ from admin1-asia.json minus statesNotShown: {diff}")
    if not {"region:pk-gb", "region:pk-jk"} <= hidden:
        problems.append("admin1-asia-in.json: Gilgit-Baltistan and Azad Kashmir should not be shown")
    notes.append(f"admin1-asia-in.json leaves out {sorted(hidden)}")
    # Claimed land: Azad Kashmir joins Jammu and Kashmir, the rest joins Ladakh.
    for label, (point, _administrator) in CLAIMED.items():
        state = JAMMU_KASHMIR if point == MUZAFFARABAD else LADAKH
        holders = [_label(f) for f in asia_in if _contains(f, point)] or "no shape"
        if holders != [state]:
            problems.append(f"admin1-asia-in.json: {label} is in {holders}, expected {state} only")
    if not _contains(_find(asia_default, "region:pk-gb"), GILGIT):
        problems.append("admin1-asia.json: Gilgit-Baltistan does not contain Gilgit")

    # Places: the gazetteer's cities, in order.
    places = json.loads((geo_dir / "places.json").read_text(encoding="utf-8"))
    if [p[0] for p in places] != [c["id"] for c in cities]:
        problems.append("places.json does not match the gazetteer's cities")
    elif any(p[4] not in countries and p[4] not in states for p in places):
        problems.append("places.json: a city's parent is not a gazetteer region")

    # Manifest: lists every file with its real size.
    listed = {f["name"]: f["bytes"] for f in manifest["files"]}
    for name, size in report.sizes.items():
        if name == "manifest.json":
            continue
        if listed.get(name) != size:
            problems.append(f"manifest.json: {name} is listed as {listed.get(name)} bytes, file has {size}")
    return report

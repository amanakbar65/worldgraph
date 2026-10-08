"""Build the map layers that WorldGraph draws itself.

Inside the claude.ai Artifact the app can't load map tiles from other sites,
so it ships its own vector layers as static files in frontend/public/geo/.
Everything comes from Natural Earth (public domain), from the same cached
files the gazetteer is built from.

Outputs (TopoJSON unless noted):

- countries.json: every country, international (default) worldview, 1:50m.
- countries-in.json: every country in India's official worldview, built
  from Natural Earth's India point-of-view file (1:10m, simplified to match).
- admin1-<continent>.json: states and provinces, one file per continent
  (africa, asia, europe, north-america, south-america, oceania), 1:10m.
- admin1-asia-in.json: Asian states and provinces in India's worldview.
- places.json (plain JSON): the gazetteer's cities as
  [id, name, lon, lat, parent, population, capital (0/1)].
- manifest.json (plain JSON): file names, sizes, build date and the
  Natural Earth version.
- frontend/src/lib/geo-continents.json: country id -> admin-1 file key.

IDs. Shapes carry the property "id" made by the gazetteer's own code
(`build_countries`, `build_states`), so every id matches seed/gazetteer.json
exactly. Country features whose ISO code is -99 (Siachen Glacier, Somaliland,
Northern Cyprus, ...) or that the gazetteer doesn't list are kept as land,
with "id": null, so the map has no holes. States that Natural Earth splits
into several shapes are merged into one MultiPolygon.

Simplification. Each file is one topology, so a border shared by two shapes
is stored once and simplified once: neighbours never drift apart. The
Douglas-Peucker tolerance of each arc follows the size of the smallest shape
that uses it (about two-thirds of a pixel when that shape fills the screen),
so Liechtenstein keeps its detail while Siberia loses points nobody can see.
If a file comes out over its size budget, the tolerances are raised step by
step until it fits. Rings never collapse below a triangle.

India's worldview for states and provinces (admin1-asia-in.json).
Natural Earth publishes India's worldview for countries only, so the state
layer is derived from the default one:

1. Every Asian state polygon is intersected with its country's polygon from
   the India-view countries file. This takes Gilgit-Baltistan and Azad
   Kashmir out of Pakistan (both states end up empty and are left out of
   the file) and Aksai Chin and the Shaksgam valley out of China's Xinjiang.
2. India's India-view polygon minus all clipped Indian states is the
   territory India claims that no Indian state polygon covers. The part that
   lies inside the Pakistan-administered Azad Kashmir polygon (the default
   admin-1 shape of region:pk-jk) is added to Jammu and Kashmir
   (region:in-jk). The other large pieces in Kashmir (Gilgit-Baltistan,
   Siachen, the Shaksgam valley and Aksai Chin) are added to Ladakh
   (region:in-la). This follows the Survey of India map of November 2019.
3. Any other gap between a country's India-view polygon and its clipped
   states (thin slivers where the admin-0 and admin-1 lines differ, or land
   India's view gives to a country whose provinces don't cover it) is merged
   into the state of that country that has (nearly) all of its border with
   states: the Golan Heights join Quneitra, the Baikonur lease joins
   Qyzylorda. Gaps that touch no state, or are split between several (such
   as northern Cyprus), get no state; the country layer still shows them.

Run with `uv run --group geo wg geo assets`.
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import numpy as np
import shapely
import topojson
from shapely.geometry import MultiPolygon, Polygon, box, mapping, shape
from shapely.geometry.base import BaseGeometry
from simplification.cutil import simplify_coords_idx

from worldgraph.geo.assets_check import (
    ADMIN1_BUDGET,
    CONTINENT_FILES,
    CONTINENTS_PATH,
    COUNTRY_BUDGET,
    GEO_DIR,
)
from worldgraph.geo.gazetteer import (
    CACHE_DIR,
    GAZETTEER_PATH,
    NE_BASE,
    NE_FILES,
    _features,
    build_countries,
    build_states,
)

SOURCE_FILES = {
    "countries": NE_FILES["countries"],
    "countries_in": "ne_10m_admin_0_countries_ind.geojson",
    "states": NE_FILES["states"],
}
VERSION_FILE = "VERSION"

CONTINENT_KEYS = {
    "Africa": "africa",
    "Asia": "asia",
    "Europe": "europe",
    "North America": "north-america",
    "South America": "south-america",
    "Oceania": "oceania",
}
# Natural Earth files these under "Seven seas (open ocean)" or "Antarctica";
# each goes with the continent it is closest to.
CONTINENT_OVERRIDES = {
    "region:aq": "oceania",
    "region:gs": "south-america",
    "region:hm": "oceania",
    "region:io": "asia",
    "region:mu": "africa",
    "region:mv": "asia",
    "region:sc": "africa",
    "region:sh": "africa",
    "region:tf": "africa",
}

INDIA = "region:in"
JAMMU_KASHMIR = "region:in-jk"
LADAKH = "region:in-la"
AZAD_KASHMIR = "region:pk-jk"
# Claimed pieces of Kashmir: anything bigger than this (square degrees) whose
# centre lies in the Kashmir box goes to Ladakh; smaller slivers are gap-filled.
KASHMIR_BOX = box(72.0, 32.0, 81.5, 37.5)
CLAIM_MIN_AREA = 0.01
# Gaps smaller than this (square degrees) are too small to see; skip them.
GAP_MIN_AREA = 1e-7
# A gap joins the state that has at least this share of its border with
# states; otherwise (e.g. northern Cyprus, split between several districts
# that Natural Earth doesn't draw) it is left without a state.
GAP_MAIN_SHARE = 0.9


# --------------------------------------------------------------------------
# Sources
# --------------------------------------------------------------------------


def download(cache_dir: Path = CACHE_DIR) -> dict[str, Path]:
    """Fetch the Natural Earth files (once) and the repository's VERSION file."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    paths: dict[str, Path] = {}
    with httpx.Client(timeout=180, follow_redirects=True) as client:
        for key, filename in SOURCE_FILES.items():
            path = cache_dir / filename
            if not path.exists():
                response = client.get(NE_BASE + filename)
                response.raise_for_status()
                path.write_bytes(response.content)
            paths[key] = path
        version = cache_dir / VERSION_FILE
        if not version.exists():
            response = client.get(NE_BASE.removesuffix("geojson/") + VERSION_FILE)
            response.raise_for_status()
            version.write_text(response.text.strip() + "\n", encoding="utf-8")
        paths["version"] = version
    return paths


def continent_key(country: dict[str, Any]) -> str:
    key = CONTINENT_OVERRIDES.get(country["id"]) or CONTINENT_KEYS.get(country["continent"])
    if key is None:
        raise ValueError(f"No admin-1 file for {country['id']} (continent {country['continent']!r})")
    return key


# --------------------------------------------------------------------------
# Geometry helpers
# --------------------------------------------------------------------------


@dataclass
class Shape:
    id: str | None
    name: str
    geom: BaseGeometry
    country: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    def properties(self) -> dict[str, Any]:
        props: dict[str, Any] = {"id": self.id, "name": self.name}
        if self.country is not None:
            props["country"] = self.country
        return props


def polygons(geom: BaseGeometry) -> Iterator[Polygon]:
    """Every non-empty polygon inside a geometry (collections included)."""
    if geom.is_empty:
        return
    if isinstance(geom, Polygon):
        yield geom
    elif hasattr(geom, "geoms"):
        for part in geom.geoms:
            yield from polygons(part)


def polygonal(geom: BaseGeometry) -> BaseGeometry:
    """A valid Polygon or MultiPolygon (possibly empty), dropping lines and points."""
    if not geom.is_valid:
        geom = shapely.make_valid(geom)
    parts = list(polygons(geom))
    if not parts:
        return MultiPolygon()
    return parts[0] if len(parts) == 1 else MultiPolygon(parts)


def merge(geoms: list[BaseGeometry]) -> BaseGeometry:
    if len(geoms) == 1:
        return polygonal(geoms[0])
    return polygonal(shapely.union_all([polygonal(g) for g in geoms]))


def _cos_area(geom: BaseGeometry) -> float:
    """Area in square degrees with longitude scaled by cos(latitude)."""
    return sum(p.area * math.cos(math.radians(p.centroid.y)) for p in polygons(geom))


def size_of(geom: BaseGeometry) -> float:
    """How big a shape looks, in degrees (side of a square of the same area)."""
    return math.sqrt(max(_cos_area(geom), 0.0))


def drop_specks(geom: BaseGeometry, min_area: float) -> BaseGeometry:
    """Remove parts smaller than min_area (cos-scaled sq. degrees), keeping the largest part."""
    parts = list(polygons(geom))
    if len(parts) <= 1:
        return geom
    areas = [p.area * math.cos(math.radians(p.centroid.y)) for p in parts]
    largest = max(range(len(parts)), key=areas.__getitem__)
    kept = [p for i, p in enumerate(parts) if i == largest or areas[i] >= min_area]
    return kept[0] if len(kept) == 1 else MultiPolygon(kept)


# --------------------------------------------------------------------------
# Layers from Natural Earth
# --------------------------------------------------------------------------


def country_shapes(features: Iterable[dict[str, Any]], names: dict[str, str]) -> list[Shape]:
    """One shape per gazetteer country (parts merged); other land with id None."""
    groups: dict[tuple[str | None, str], list[BaseGeometry]] = defaultdict(list)
    for feature in features:
        p = feature["properties"]
        iso2 = p["ISO_A2_EH"]
        region = f"region:{iso2.lower()}" if iso2 and iso2 != "-99" else None
        if region is not None and region not in names:
            region = None
        key = (region, names[region] if region else p["NAME"])
        groups[key].append(shape(feature["geometry"]))
    shapes = [Shape(region, name, merge(geoms)) for (region, name), geoms in groups.items()]
    return sorted(shapes, key=_sort_key)


def state_shapes(
    features: Iterable[dict[str, Any]], country_ids: set[str]
) -> tuple[list[Shape], list[dict[str, Any]]]:
    """One shape per gazetteer state, split shapes merged; plus the state rows."""
    rows, pairs = build_states(features, country_ids)
    by_id = {r["id"]: r for r in rows}
    groups: dict[str, list[BaseGeometry]] = defaultdict(list)
    for state_id, geometry in pairs:
        groups[state_id].append(shape(geometry))
    shapes = [
        Shape(sid, by_id[sid]["name"], merge(geoms), country=by_id[sid]["parent"])
        for sid, geoms in groups.items()
    ]
    return sorted(shapes, key=_sort_key), rows


def _sort_key(s: Shape) -> tuple[bool, str, str]:
    return (s.id is None, s.id or "", s.name)


# --------------------------------------------------------------------------
# India's worldview for Asian states (see the module docstring)
# --------------------------------------------------------------------------


@dataclass
class IndiaViewReport:
    dropped: list[str] = field(default_factory=list)
    added_to: dict[str, float] = field(default_factory=dict)  # state id -> km² added


def _km2(geom: BaseGeometry) -> float:
    return _cos_area(geom) * 111.32**2


def india_view_states(
    states: list[Shape], countries_in: dict[str, BaseGeometry], azad_kashmir: BaseGeometry
) -> tuple[list[Shape], IndiaViewReport]:
    report = IndiaViewReport()
    clipped: dict[str, Shape] = {}
    for s in states:
        country = countries_in.get(s.country or "")
        geom = s.geom if country is None else polygonal(s.geom.intersection(country))
        if geom.is_empty or _cos_area(geom) < GAP_MIN_AREA:
            report.dropped.append(s.id or s.name)
            continue
        clipped[s.id or s.name] = Shape(s.id, s.name, geom, s.country)

    additions: dict[str, list[BaseGeometry]] = defaultdict(list)
    by_country: dict[str, list[Shape]] = defaultdict(list)
    for s in clipped.values():
        by_country[s.country or ""].append(s)

    for country_id, members in sorted(by_country.items()):
        country = countries_in.get(country_id)
        if country is None:
            continue
        gaps = polygonal(country.difference(shapely.union_all([m.geom for m in members])))
        pieces: list[BaseGeometry] = list(polygons(gaps))
        if country_id == INDIA:
            pieces = _assign_kashmir(pieces, azad_kashmir, additions)
        for piece in pieces:
            if _cos_area(piece) < GAP_MIN_AREA:
                continue
            target = _main_neighbour(piece, members)
            if target is not None:
                additions[target].append(piece)

    out: list[Shape] = []
    for key, s in clipped.items():
        extra = additions.get(key)
        if extra:
            s = Shape(s.id, s.name, merge([s.geom, *extra]), s.country)
            report.added_to[key] = round(sum(_km2(g) for g in extra), 1)
        out.append(s)
    return sorted(out, key=_sort_key), report


def _assign_kashmir(
    pieces: list[BaseGeometry],
    azad_kashmir: BaseGeometry,
    additions: dict[str, list[BaseGeometry]],
) -> list[BaseGeometry]:
    """Claimed Kashmir goes to J&K (Azad Kashmir) or Ladakh (the rest); returns leftovers."""
    leftovers: list[BaseGeometry] = []
    for piece in pieces:
        if not piece.intersects(KASHMIR_BOX):
            leftovers.append(piece)
            continue
        in_azad = polygonal(piece.intersection(azad_kashmir))
        if _cos_area(in_azad) >= GAP_MIN_AREA:
            additions[JAMMU_KASHMIR].append(in_azad)
        rest = polygonal(piece.difference(azad_kashmir)) if not in_azad.is_empty else piece
        for part in polygons(rest):
            if _cos_area(part) >= CLAIM_MIN_AREA and KASHMIR_BOX.contains(part.representative_point()):
                additions[LADAKH].append(part)
            else:
                leftovers.append(part)
    return leftovers


def _main_neighbour(piece: BaseGeometry, members: list[Shape]) -> str | None:
    """The state that has most of the piece's border with states, if it has nearly all of it."""
    edge = piece.boundary.buffer(1e-6)
    x0, y0, x1, y1 = edge.bounds
    shared: dict[str, float] = {}
    for m in members:
        mx0, my0, mx1, my1 = m.geom.bounds
        if mx0 > x1 or mx1 < x0 or my0 > y1 or my1 < y0:
            continue
        length = m.geom.boundary.intersection(edge).length
        if length > 0:
            shared[m.id or m.name] = length
    if not shared:
        return None
    best = max(shared, key=shared.__getitem__)
    return best if shared[best] >= GAP_MAIN_SHARE * sum(shared.values()) else None


# --------------------------------------------------------------------------
# TopoJSON with size-aware simplification
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class LayerSpec:
    object_name: str
    budget: int  # largest file size in bytes
    fraction: float  # tolerance = shape size x fraction, ...
    min_tolerance: float  # ... kept between these two (degrees)
    max_tolerance: float
    min_island: float  # drop parts smaller than this (cos-scaled sq. degrees), except the largest
    grid: int  # output grid: one unit is 1/grid of the bounding box


# Countries are drawn at globe and continent zoom (a pixel is ~0.05°); closer
# in, the states take over. States are drawn down to state zoom, so each keeps
# detail relative to its own size: about 2/3 px when it fills 1,000 px.
COUNTRY_SPEC = LayerSpec("countries", COUNTRY_BUDGET, 1 / 500, 0.01, 0.05, 0.005, 50_000)
ADMIN1_SPEC = LayerSpec("admin1", ADMIN1_BUDGET, 1 / 1500, 0.0005, 0.02, 0.0, 500_000)
# The topology is computed on a fine grid, so tiny shapes and shared borders
# survive; the output is then moved to the layer's (coarser) grid.
TOPOLOGY_GRID = 1_000_000
# A file over budget is simplified again with every tolerance multiplied by
# the next factor, until it fits.
MULTIPLIERS = (1.0, 1.1, 1.2, 1.35, 1.5, 1.65, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.5, 4.0, 5.0, 6.0, 8.0)


@dataclass
class Encoded:
    text: str
    features: int
    multiplier: float


@dataclass
class _Topology:
    object_name: str
    geometries: list[dict[str, Any]]
    arcs: list[np.ndarray]  # absolute coordinates on TOPOLOGY_GRID
    arc_tolerance: np.ndarray  # degrees, before the multiplier
    ring_arcs: np.ndarray  # fewest arcs in any ring that uses the arc
    scale: list[float]
    translate: list[float]


def encode(shapes: list[Shape], spec: LayerSpec) -> Encoded:
    topology = _topology(shapes, spec)
    for multiplier in MULTIPLIERS:
        text = _serialize(topology, spec, multiplier)
        if len(text.encode("utf-8")) <= spec.budget:
            return Encoded(text, len(shapes), multiplier)
    raise ValueError(f"{spec.object_name}: cannot fit in {spec.budget} bytes")


def _tolerance(geom: BaseGeometry, spec: LayerSpec) -> float:
    return min(max(size_of(geom) * spec.fraction, spec.min_tolerance), spec.max_tolerance)


def _topology(shapes: list[Shape], spec: LayerSpec) -> _Topology:
    tolerances = [_tolerance(s.geom, spec) for s in shapes]
    collection = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": s.properties(),
                "geometry": mapping(drop_specks(s.geom, max(spec.min_island, tol * tol))),
            }
            for s, tol in zip(shapes, tolerances, strict=True)
        ],
    }
    topo = topojson.Topology(collection, prequantize=TOPOLOGY_GRID, object_name=spec.object_name).to_dict()
    geometries = topo["objects"][spec.object_name]["geometries"]
    if len(geometries) != len(shapes) or any("arcs" not in g for g in geometries):
        raise ValueError(f"{spec.object_name}: the topology lost a shape")

    arcs = [np.cumsum(np.asarray(a, dtype=np.int64), axis=0) for a in topo["arcs"]]
    arc_tolerance = np.full(len(arcs), np.inf)
    ring_arcs = np.full(len(arcs), 1_000_000)
    for geometry, tol in zip(geometries, tolerances, strict=True):
        for ring in _rings(geometry):
            for ref in ring:
                i = ref if ref >= 0 else ~ref
                arc_tolerance[i] = min(arc_tolerance[i], tol)
                ring_arcs[i] = min(ring_arcs[i], len(ring))
    return _Topology(
        object_name=spec.object_name,
        # Keep type, arcs and properties; drop the library's generated "id".
        geometries=[
            {"type": g["type"], "arcs": g["arcs"], "properties": g["properties"]} for g in geometries
        ],
        arcs=arcs,
        arc_tolerance=arc_tolerance,
        ring_arcs=ring_arcs,
        scale=[float(v) for v in topo["transform"]["scale"]],
        translate=[float(v) for v in topo["transform"]["translate"]],
    )


def _serialize(topology: _Topology, spec: LayerSpec, multiplier: float) -> str:
    t = topology
    ratio = max(1, round(TOPOLOGY_GRID / spec.grid))
    kept = [
        _coarsen(
            _simplify_arc(
                arc, float(t.arc_tolerance[i]) * multiplier, t.scale, t.translate, int(t.ring_arcs[i])
            ),
            ratio,
        )
        for i, arc in enumerate(t.arcs)
    ]
    result = {
        "type": "Topology",
        "transform": {"scale": [v * ratio for v in t.scale], "translate": t.translate},
        "objects": {t.object_name: {"type": "GeometryCollection", "geometries": t.geometries}},
        "arcs": [_delta(a) for a in kept],
    }
    return json.dumps(result, ensure_ascii=False, separators=(",", ":"))


def _coarsen(arc: np.ndarray, ratio: int) -> np.ndarray:
    """Move an arc to a grid `ratio` times coarser, dropping repeated points."""
    if ratio == 1:
        return arc
    coarse = np.rint(arc / ratio).astype(np.int64)
    keep = np.concatenate([[True], np.any(coarse[1:] != coarse[:-1], axis=1)])
    keep[-1] = True  # both ends are junctions shared with other arcs
    out = coarse[keep]
    if len(out) > 2 and (out[-1] == out[-2]).all():
        out = np.delete(out, -2, axis=0)
    return out


def _rings(geometry: dict[str, Any]) -> Iterator[list[int]]:
    if geometry["type"] == "Polygon":
        yield from geometry["arcs"]
    elif geometry["type"] == "MultiPolygon":
        for polygon in geometry["arcs"]:
            yield from polygon


def _simplify_arc(
    arc: np.ndarray, tol: float, scale: list[float], translate: list[float], ring_arcs: int
) -> np.ndarray:
    n = len(arc)
    if n <= 2 or not math.isfinite(tol):
        return arc
    lon = arc[:, 0] * scale[0] + translate[0]
    lat = arc[:, 1] * scale[1] + translate[1]
    # Measure in locally even units: a degree of longitude shrinks with latitude.
    x = lon * math.cos(math.radians(float(lat.mean())))
    pts = np.column_stack([x, lat])
    keep = _douglas_peucker(pts, tol)
    closed = bool((arc[0] == arc[-1]).all())
    need = 4 if closed else (3 if ring_arcs <= 2 else 2)
    if len(keep) < need <= n:
        keep = _widest(pts, keep, need)
    return arc[keep]


def _douglas_peucker(pts: np.ndarray, tol: float) -> list[int]:
    """Indices kept by Douglas-Peucker (first and last always kept)."""
    return [int(i) for i in simplify_coords_idx(np.ascontiguousarray(pts, dtype=np.float64), tol)]


def _distances(p: np.ndarray, a: np.ndarray, b: np.ndarray) -> np.ndarray:
    ab = b - a
    length2 = float(ab @ ab)
    if length2 == 0.0:
        return np.hypot(p[:, 0] - a[0], p[:, 1] - a[1])
    t = np.clip(((p - a) @ ab) / length2, 0.0, 1.0)
    proj = a + np.outer(t, ab)
    return np.hypot(p[:, 0] - proj[:, 0], p[:, 1] - proj[:, 1])


def _widest(pts: np.ndarray, keep: list[int], need: int) -> list[int]:
    """Add the points farthest from what's kept until there are `need` of them."""
    chosen = set(keep)
    while len(chosen) < need:
        idx = sorted(chosen)
        best, best_d = None, -1.0
        for a, b in zip(idx, idx[1:], strict=False):
            if b - a < 2:
                continue
            d = _distances(pts[a + 1 : b], pts[a], pts[b])
            j = int(np.argmax(d))
            if d[j] > best_d:
                best, best_d = a + 1 + j, float(d[j])
        if best is None:
            break
        chosen.add(best)
    return sorted(chosen)


def _delta(arc: np.ndarray) -> list[list[int]]:
    out = np.empty_like(arc)
    out[0] = arc[0]
    out[1:] = arc[1:] - arc[:-1]
    return out.tolist()


# --------------------------------------------------------------------------
# Build everything
# --------------------------------------------------------------------------


def _write(path: Path, text: str) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path.stat().st_size


def build_assets(
    cache_dir: Path = CACHE_DIR,
    out_dir: Path = GEO_DIR,
    continents_path: Path = CONTINENTS_PATH,
    gazetteer_path: Path = GAZETTEER_PATH,
) -> dict[str, Any]:
    paths = download(cache_dir)
    gazetteer = json.loads(gazetteer_path.read_text(encoding="utf-8"))
    gaz_countries = [r for r in gazetteer if r["subtype"] == "country"]

    # The same code as the gazetteer decides the ids, from the same files.
    countries = build_countries(_features(paths["countries"]))
    if [c["id"] for c in countries] != [c["id"] for c in gaz_countries]:
        raise ValueError("Country ids differ from seed/gazetteer.json: rebuild the gazetteer first")
    names = {c["id"]: c["name"] for c in countries}
    continent_of = {c["id"]: continent_key(c) for c in countries}

    files: dict[str, Encoded] = {}
    files["countries.json"] = encode(country_shapes(_features(paths["countries"]), names), COUNTRY_SPEC)
    countries_in = country_shapes(_features(paths["countries_in"]), names)
    files["countries-in.json"] = encode(countries_in, COUNTRY_SPEC)

    states, _rows = state_shapes(_features(paths["states"]), set(names))
    by_continent: dict[str, list[Shape]] = defaultdict(list)
    for s in states:
        by_continent[continent_of[s.country or ""]].append(s)
    for key in CONTINENT_FILES:
        files[f"admin1-{key}.json"] = encode(by_continent[key], ADMIN1_SPEC)

    azad = next(s.geom for s in states if s.id == AZAD_KASHMIR)
    india_geoms = {s.id: s.geom for s in countries_in if s.id}
    asia_in, india_report = india_view_states(by_continent["asia"], india_geoms, azad)
    files["admin1-asia-in.json"] = encode(asia_in, ADMIN1_SPEC)

    sizes = {name: _write(out_dir / name, enc.text) for name, enc in files.items()}
    sizes["places.json"] = _write(out_dir / "places.json", places_json(gazetteer))
    _write(
        continents_path,
        json.dumps(dict(sorted(continent_of.items())), indent=0, separators=(",", ":")) + "\n",
    )

    version = paths["version"].read_text(encoding="utf-8").strip()
    manifest = {
        "built": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": {
            "name": "Natural Earth",
            "version": version,
            "license": "public domain",
            "files": sorted(SOURCE_FILES.values()),
        },
        "files": [
            {
                "name": name,
                "bytes": sizes[name],
                **(
                    {"features": files[name].features, "object": _object_name(name)}
                    if name in files
                    else {"places": sum(1 for r in gazetteer if r["subtype"] == "city")}
                ),
            }
            for name in sorted(sizes)
        ],
        "worldviews": {
            "default": {"countries": "countries.json", "admin1": "admin1-<continent>.json"},
            "india": {
                "countries": "countries-in.json",
                "admin1": "admin1-asia-in.json for Asia, admin1-<continent>.json elsewhere",
                "statesNotShown": sorted(india_report.dropped),
            },
        },
    }
    sizes["manifest.json"] = _write(out_dir / "manifest.json", json.dumps(manifest, indent=2) + "\n")
    details = [
        f"{name}: {sizes[name] / 1000:,.0f} KB"
        + (f", {files[name].features} shapes, tolerance x{files[name].multiplier:g}" if name in files else "")
        for name in sorted(sizes)
    ]
    details += [
        f"India view adds {km2:,.0f} km² to {sid}"
        for sid, km2 in sorted(india_report.added_to.items())
        if km2 >= 1
    ]
    details.append(f"India view leaves out {', '.join(sorted(india_report.dropped))}")
    return {"out": str(out_dir), "details": details}


def _object_name(filename: str) -> str:
    return COUNTRY_SPEC.object_name if filename.startswith("countries") else ADMIN1_SPEC.object_name


def places_json(gazetteer: list[dict[str, Any]]) -> str:
    rows = [
        [r["id"], r["name"], r["lon"], r["lat"], r["parent"], r["population"], 1 if r["capital"] else 0]
        for r in gazetteer
        if r["subtype"] == "city"
    ]
    return (
        "[\n" + ",\n".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in rows) + "\n]\n"
    )

"""Build the gazetteer: every country, every state/province, and major cities.

Source: Natural Earth (public domain), downloaded from its GitHub repository.
Output: seed/gazetteer.json, one region per line, committed to Git so that
loading sample data works offline.

Run with `uv run wg geo gazetteer`.
"""

from __future__ import annotations

import json
import re
import unicodedata
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Any

import httpx

from worldgraph.config import BACKEND_DIR

NE_BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
NE_FILES = {
    "countries": "ne_50m_admin_0_countries.geojson",
    "states": "ne_10m_admin_1_states_provinces.geojson",
    "places": "ne_10m_populated_places.geojson",
}
CACHE_DIR = BACKEND_DIR / "data" / "cache" / "naturalearth"
GAZETTEER_PATH = Path(__file__).resolve().parents[1] / "seed" / "gazetteer.json"

# Cities: every national capital plus every city of at least this population.
CITY_MIN_POPULATION = 1_000_000

_ISO_3166_2 = re.compile(r"^[A-Z]{2}-[A-Z0-9]{1,3}$")
_PREFERRED_COUNTRY_TYPES = ("Sovereign country", "Country")


def slugify(text: str) -> str:
    """'São Paulo' -> 'sao-paulo'."""
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")


# --------------------------------------------------------------------------
# Download
# --------------------------------------------------------------------------


def download(cache_dir: Path = CACHE_DIR) -> dict[str, Path]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    paths = {}
    with httpx.Client(timeout=120, follow_redirects=True) as client:
        for key, filename in NE_FILES.items():
            path = cache_dir / filename
            if not path.exists():
                response = client.get(NE_BASE + filename)
                response.raise_for_status()
                path.write_bytes(response.content)
            paths[key] = path
    return paths


def _features(path: Path) -> list[dict[str, Any]]:
    return json.loads(path.read_text(encoding="utf-8"))["features"]


# --------------------------------------------------------------------------
# Point-in-polygon (enough for assigning cities to states)
# --------------------------------------------------------------------------


def _ring_contains(ring: Sequence[Sequence[float]], x: float, y: float) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def _polygons(geometry: dict[str, Any]) -> list[list[list[list[float]]]]:
    if geometry["type"] == "Polygon":
        return [geometry["coordinates"]]
    if geometry["type"] == "MultiPolygon":
        return geometry["coordinates"]
    return []


def geometry_contains(geometry: dict[str, Any], x: float, y: float) -> bool:
    for rings in _polygons(geometry):
        outer, holes = rings[0], rings[1:]
        if _ring_contains(outer, x, y) and not any(_ring_contains(h, x, y) for h in holes):
            return True
    return False


def bbox(geometry: dict[str, Any]) -> tuple[float, float, float, float]:
    xs: list[float] = []
    ys: list[float] = []
    for rings in _polygons(geometry):
        for point in rings[0]:
            xs.append(point[0])
            ys.append(point[1])
    return (min(xs), min(ys), max(xs), max(ys)) if xs else (0.0, 0.0, 0.0, 0.0)


# --------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------


def _round(value: float) -> float:
    return round(float(value), 4)


def build_countries(features: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    best: dict[str, dict[str, Any]] = {}
    for feature in features:
        p = feature["properties"]
        iso2 = p["ISO_A2_EH"]
        if not iso2 or iso2 == "-99":
            continue  # territories without an ISO code (e.g. Siachen Glacier)
        rank = (p["TYPE"] in _PREFERRED_COUNTRY_TYPES, p.get("POP_EST") or 0)
        if iso2 not in best or rank > best[iso2]["_rank"]:
            best[iso2] = {
                "_rank": rank,
                "id": f"region:{iso2.lower()}",
                "name": p["NAME"],
                "subtype": "country",
                "iso2": iso2,
                "iso3": p["ISO_A3_EH"] if p["ISO_A3_EH"] != "-99" else None,
                "qid": p.get("WIKIDATAID") or None,
                "lon": _round(p["LABEL_X"]),
                "lat": _round(p["LABEL_Y"]),
                "continent": p["CONTINENT"],
                "subregion": p["SUBREGION"],
            }
    rows = sorted(best.values(), key=lambda r: r["id"])
    for row in rows:
        row.pop("_rank")
    return rows


def build_states(
    features: Iterable[dict[str, Any]], country_ids: set[str]
) -> tuple[list[dict[str, Any]], list[tuple[str, dict[str, Any]]]]:
    """Returns state rows plus (state_id, geometry) pairs for city lookup."""
    by_id: dict[str, dict[str, Any]] = {}
    shapes: list[tuple[str, dict[str, Any]]] = []
    for feature in features:
        p = feature["properties"]
        iso2 = (p.get("iso_a2") or "").upper()
        parent = f"region:{iso2.lower()}"
        if parent not in country_ids:
            continue
        code = (p.get("iso_3166_2") or "").upper()
        state_id = (
            f"region:{code.lower()}"
            if _ISO_3166_2.match(code) and code.startswith(iso2 + "-")
            else f"region:{iso2.lower()}-ne{p['ne_id']}"
        )
        area = p.get("area_sqkm") or 0
        row = by_id.get(state_id)
        # Some states are split into several shapes; label the largest one.
        if row is None or area > row["_area"]:
            by_id[state_id] = {
                "_area": area,
                "id": state_id,
                "name": p.get("name") or p.get("name_en") or code,
                "subtype": "state",
                "code": code if _ISO_3166_2.match(code) else None,
                "qid": p.get("wikidataid") or None,
                "lon": _round(p["longitude"]),
                "lat": _round(p["latitude"]),
                "parent": parent,
            }
        shapes.append((state_id, feature["geometry"]))
    rows = sorted(by_id.values(), key=lambda r: r["id"])
    for row in rows:
        row.pop("_area")
    return rows, shapes


def build_cities(
    features: Iterable[dict[str, Any]],
    country_ids: set[str],
    state_shapes: list[tuple[str, dict[str, Any]]],
) -> list[dict[str, Any]]:
    boxes = [(state_id, geometry, bbox(geometry)) for state_id, geometry in state_shapes]
    rows: list[dict[str, Any]] = []
    used: set[str] = set()
    for feature in features:
        p = feature["properties"]
        population = p.get("POP_MAX") or 0
        if population < CITY_MIN_POPULATION and p.get("ADM0CAP") != 1:
            continue
        iso2 = (p.get("ISO_A2") or "").upper()
        country_id = f"region:{iso2.lower()}"
        if country_id not in country_ids:
            continue
        x, y = float(p["LONGITUDE"]), float(p["LATITUDE"])
        state_id = next(
            (
                sid
                for sid, geometry, (x0, y0, x1, y1) in boxes
                if sid.startswith(country_id + "-")
                and x0 <= x <= x1
                and y0 <= y <= y1
                and geometry_contains(geometry, x, y)
            ),
            None,
        )
        parent = state_id or country_id
        base = f"{parent}.{slugify(p['NAME'])}"
        city_id, n = base, 2
        while city_id in used:
            city_id, n = f"{base}-{n}", n + 1
        used.add(city_id)
        rows.append(
            {
                "id": city_id,
                "name": p["NAME"],
                "subtype": "city",
                "qid": p.get("WIKIDATAID") or None,
                "lon": _round(x),
                "lat": _round(y),
                "parent": parent,
                "population": int(population),
                "capital": p.get("ADM0CAP") == 1,
            }
        )
    return sorted(rows, key=lambda r: r["id"])


def dedupe_qids(rows: list[dict[str, Any]]) -> int:
    """A Wikidata ID may belong to one node only. Countries win, then states."""
    seen: set[str] = set()
    dropped = 0
    for row in rows:
        qid = row.get("qid")
        if not qid:
            continue
        if qid in seen or not re.match(r"^Q\d+$", qid):
            row["qid"] = None
            dropped += 1
        else:
            seen.add(qid)
    return dropped


def build_gazetteer(cache_dir: Path = CACHE_DIR, out: Path = GAZETTEER_PATH) -> dict[str, int]:
    paths = download(cache_dir)
    countries = build_countries(_features(paths["countries"]))
    country_ids = {c["id"] for c in countries}
    states, shapes = build_states(_features(paths["states"]), country_ids)
    cities = build_cities(_features(paths["places"]), country_ids, shapes)
    rows = countries + states + cities
    dropped = dedupe_qids(rows)
    out.write_text(
        "[\n" + ",\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n]\n",
        encoding="utf-8",
    )
    return {
        "countries": len(countries),
        "states/provinces": len(states),
        "cities": len(cities),
        "duplicate Wikidata IDs dropped": dropped,
        "written to": str(out.relative_to(BACKEND_DIR)),
    }

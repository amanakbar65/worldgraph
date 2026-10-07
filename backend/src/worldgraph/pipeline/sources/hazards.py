"""Measured hazards: earthquakes (USGS) and disaster alerts (GDACS).

Each significant hazard becomes its own story, with a magnitude set from
the measurement rather than from news coverage.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from email.utils import parsedate_to_datetime
from typing import Any
from xml.etree import ElementTree

import httpx

from worldgraph.pipeline.items import Item
from worldgraph.pipeline.places import Place, Places
from worldgraph.pipeline.text import clean, first_sentence
from worldgraph.pipeline.themes import Classification

USGS_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson"
GDACS_URL = "https://www.gdacs.org/xml/rss.xml"
MAX_AGE = timedelta(hours=72)

GDACS_TYPES = {
    "TC": ("tropical cyclone", "extreme-weather", ("logistics-trade", "energy")),
    "FL": ("flood", "extreme-weather", ("agri-food", "logistics-trade")),
    "DR": ("drought", "extreme-weather", ("agri-food", "energy")),
    "VO": ("volcanic eruption", "hazard", ("logistics-trade",)),
    "WF": ("wildfire", "extreme-weather", ("agri-food", "real-estate")),
    # Earthquakes come from USGS.
}
_NS = {
    "gdacs": "http://www.gdacs.org",
    "geo": "http://www.w3.org/2003/01/geo/wgs84_pos#",
}


def _place_for_point(places: Places, lon: float, lat: float, text: str, max_km: float) -> Place | None:
    named = [r for r in places.match_text(text) if places.country_of(r)]
    if named:
        country = places.country_of(named[0])
        assert country is not None
    else:
        country = places.nearest_country(lon, lat, max_km)
    if country is None:
        return None
    return Place(country, places.nearest_state(country, lon, lat, 500), None, lon, lat, "point")


def quake_magnitude(mag: float, alert: str | None) -> int:
    if mag >= 7.5 or alert == "red":
        return 5
    if mag >= 7.0 or alert == "orange":
        return 4
    if mag >= 6.5 or alert == "yellow":
        return 3
    return 2


def parse_usgs(data: dict[str, Any], places: Places, *, now: datetime) -> list[Item]:
    items: list[Item] = []
    for feature in data.get("features", []):
        p = feature.get("properties") or {}
        mag = p.get("mag") or 0
        alert = p.get("alert")
        if not (
            mag >= 6.0 or alert in ("yellow", "orange", "red") or (mag >= 5.5 and (p.get("sig") or 0) >= 600)
        ):
            continue
        published = datetime.fromtimestamp((p.get("time") or 0) / 1000, tz=UTC)
        if now - published > MAX_AGE:
            continue
        lon, lat = feature["geometry"]["coordinates"][:2]
        where = p.get("place") or ""
        place = _place_for_point(places, lon, lat, where, 1500 if mag >= 7 else 400)
        if place is None:
            continue  # open ocean, far from anyone
        magnitude = quake_magnitude(mag, alert)
        title = f"M{mag:.1f} earthquake: {where}" if where else f"M{mag:.1f} earthquake"
        tsunami = " A tsunami message was issued." if p.get("tsunami") else ""
        items.append(
            Item(
                url=p.get("url") or f"https://earthquake.usgs.gov/earthquakes/eventpage/{feature['id']}",
                title=title,
                source_name="USGS",
                published_at=published,
                provider="usgs",
                snippet=f"USGS measured a magnitude {mag:.1f} earthquake {where}.{tsunami}".strip(),
                place=place,
                countries=[place.country_id],
                cls=Classification(
                    score=50 + 10 * magnitude,
                    sectors=["manufacturing", "logistics-trade"],
                    event_type="hazard",
                    impact="risk",
                    magnitude=magnitude,
                ),
                hazard=True,
                magnitude=magnitude,
            )
        )
    return items


def _text(item: ElementTree.Element, path: str) -> str:
    node = item.find(path, _NS)
    return (node.text or "").strip() if node is not None else ""


def parse_gdacs(content: bytes, places: Places, *, now: datetime) -> list[Item]:
    root = ElementTree.fromstring(content)
    items: list[Item] = []
    for item in root.iter("item"):
        level = _text(item, "gdacs:alertlevel")
        kind = _text(item, "gdacs:eventtype")
        if level not in ("Orange", "Red") or kind not in GDACS_TYPES:
            continue
        if _text(item, "gdacs:iscurrent").lower() == "false":
            continue
        label, event_type, sectors = GDACS_TYPES[kind]
        try:
            published = parsedate_to_datetime(_text(item, "pubDate")).astimezone(UTC)
            lat, lon = float(_text(item, "geo:Point/geo:lat")), float(_text(item, "geo:Point/geo:long"))
        except (TypeError, ValueError):
            continue
        if now - published > MAX_AGE:
            continue
        description = clean(_text(item, "description"))
        country_text = _text(item, "gdacs:country")
        place = _place_for_point(places, lon, lat, f"{country_text} {description}", 600)
        if place is None:
            continue
        name = _text(item, "gdacs:eventname")
        country_name = places.rows[place.country_id]["name"]
        title = f"{level} alert: {label} {name.title() if name else ''} in {country_name}"
        title = re.sub(r"\s+", " ", title).strip()
        magnitude = 4 if level == "Red" else 3
        items.append(
            Item(
                url=_text(item, "link"),
                title=title,
                source_name="GDACS",
                published_at=published,
                provider="gdacs",
                snippet=first_sentence(description),
                place=place,
                countries=[place.country_id],
                cls=Classification(
                    score=50 + 10 * magnitude,
                    sectors=list(sectors),
                    event_type=event_type,
                    impact="risk",
                    magnitude=magnitude,
                ),
                hazard=True,
                magnitude=magnitude,
            )
        )
    return items


def fetch(
    client: httpx.Client, places: Places, *, now: datetime | None = None
) -> tuple[list[Item], dict[str, Any]]:
    now = now or datetime.now(UTC)
    items: list[Item] = []
    stats: dict[str, Any] = {"failed": []}
    try:
        items += parse_usgs(client.get(USGS_URL).raise_for_status().json(), places, now=now)
    except (httpx.HTTPError, ValueError) as exc:
        stats["failed"].append(f"usgs: {type(exc).__name__}")
    try:
        items += parse_gdacs(client.get(GDACS_URL).raise_for_status().content, places, now=now)
    except (httpx.HTTPError, ElementTree.ParseError) as exc:
        stats["failed"].append(f"gdacs: {type(exc).__name__}")
    return items, stats

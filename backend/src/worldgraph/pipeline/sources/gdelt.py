"""GDELT 2.1 Global Knowledge Graph: worldwide news, every 15 minutes.

Each GKG file lists the articles GDELT read in 15 minutes, with themes,
places, organisations, tone and the page title. We keep only the headline,
URL, outlet and date (never article text) and only business-relevant items.

Files: https://data.gdeltproject.org/gdeltv2/YYYYMMDDHHMMSS.gkg.csv.zip
(HTTPS only; the plain-HTTP links in lastupdate.txt are rewritten).
"""

from __future__ import annotations

import io
import re
import zipfile
from collections import Counter
from collections.abc import Iterable, Iterator
from datetime import UTC, datetime, timedelta

import httpx

from worldgraph.pipeline.items import Item
from worldgraph.pipeline.places import Place, Places
from worldgraph.pipeline.text import clean_title
from worldgraph.pipeline.themes import classify

BASE = "https://data.gdeltproject.org/gdeltv2/"
LAST_UPDATE = BASE + "lastupdate.txt"
STEP = timedelta(minutes=15)
TS_FORMAT = "%Y%m%d%H%M%S"

# Column positions in a GKG 2.1 row (tab-separated, 27 columns).
C_DATE, C_COLLECTION, C_SOURCE, C_URL = 1, 2, 3, 4
C_THEMES, C_LOCATIONS, C_ORGS, C_TONE, C_EXTRAS = 8, 10, 14, 15, 26

_TITLE = re.compile(r"<PAGE_TITLE>(.*?)</PAGE_TITLE>", re.DOTALL)
MIN_SCORE = 7.0  # relevance gate (see themes.classify)

# Syndication networks publish one article on hundreds of domains; count them once.
_SYNDICATED = [
    (re.compile(r"^https?://(www\.)?[^/]+/news/\d{9}/"), "bignewsnetwork.com"),
]


def source_name(common_name: str, url: str) -> str:
    for pattern, name in _SYNDICATED:
        if pattern.match(url):
            return name
    return common_name.strip().lower().removeprefix("www.")


def latest_timestamp(client: httpx.Client) -> str:
    """The newest GKG file's timestamp, e.g. '20261007181500'."""
    text = client.get(LAST_UPDATE).raise_for_status().text
    for line in text.splitlines():
        if line.endswith(".gkg.csv.zip"):
            return line.rsplit("/", 1)[1].split(".", 1)[0]
    raise RuntimeError("GDELT lastupdate.txt lists no GKG file")


def timestamps_to_fetch(last: str | None, latest: str, max_files: int = 4) -> list[str]:
    """Files after `last` up to `latest`, newest `max_files` only."""
    end = datetime.strptime(latest, TS_FORMAT)
    if last is None:
        return [latest]
    start = datetime.strptime(last, TS_FORMAT) + STEP
    stamps = []
    t = end
    while t >= start and len(stamps) < max_files:
        stamps.append(t.strftime(TS_FORMAT))
        t -= STEP
    return sorted(stamps)


def download_lines(client: httpx.Client, stamp: str) -> Iterator[str] | None:
    """The rows of one GKG file, or None if GDELT skipped that slot (404)."""
    response = client.get(f"{BASE}{stamp}.gkg.csv.zip")
    if response.status_code == 404:
        return None
    response.raise_for_status()
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        name = archive.namelist()[0]
        data = archive.read(name)
    return iter(data.decode("utf-8", errors="replace").splitlines())


def _themes(field: str) -> Counter[str]:
    counts: Counter[str] = Counter()
    for entry in field.split(";"):
        if entry:
            counts[entry.rsplit(",", 1)[0]] += 1
    return counts


def _orgs(field: str) -> list[str]:
    seen: list[str] = []
    for entry in field.split(";"):
        name = entry.rsplit(",", 1)[0].strip()
        if name and name not in seen:
            seen.append(name)
    return seen[:20]


def _float(text: str) -> float | None:
    try:
        return float(text)
    except ValueError:
        return None


def _place(field: str, places: Places) -> tuple[Place | None, list[str]]:
    """The main place: the most-mentioned country, at the most precise level we can find."""
    mentions: Counter[str] = Counter()
    resolved: list[tuple[int, Place]] = []
    for entry in field.split(";"):
        f = entry.split("#")
        if len(f) < 9:
            continue
        place = places.from_gdelt(f[0], f[2], f[3], _float(f[5]), _float(f[6]))
        if place is None:
            continue
        mentions[place.country_id] += 1
        resolved.append((int(f[8]) if f[8].isdigit() else 0, place))
    if not resolved:
        return None, []
    countries = [c for c, _ in mentions.most_common()]
    top = countries[0]
    precision = {"city": 0, "state": 1, "country": 2}
    in_top = sorted(
        (p for _, p in resolved if p.country_id == top),
        key=lambda p: (precision.get(p.precision, 3), 0),
    )
    # The most precise place, but only if it's mentioned more than once or is all we have.
    best = in_top[0]
    region_counts = Counter(p.admin1_id for p in in_top if p.admin1_id)
    if best.admin1_id and region_counts[best.admin1_id] < 2 and len(region_counts) > 1:
        commonest = region_counts.most_common(1)[0][0]
        best = next(p for p in in_top if p.admin1_id == commonest)
    return best, countries[:5]


def parse_rows(lines: Iterable[str], places: Places, min_score: float = MIN_SCORE) -> list[Item]:
    items: list[Item] = []
    seen: set[str] = set()
    for line in lines:
        cols = line.split("\t")
        if len(cols) < 27 or cols[C_COLLECTION] != "1":  # 1 = web pages
            continue
        url = cols[C_URL].strip()
        if not url.startswith("http") or url in seen:
            continue
        match = _TITLE.search(cols[C_EXTRAS])
        source = source_name(cols[C_SOURCE], url)
        title = clean_title(match.group(1) if match else "", source)
        if len(title.split()) < 4:
            continue
        themes = _themes(cols[C_THEMES])
        cls = classify(title, themes)
        if cls.score < min_score:
            continue
        place, countries = _place(cols[C_LOCATIONS], places)
        t_place, t_countries = places.place_from_text(title)
        if t_place is not None and (place is None or place.country_id not in t_countries):
            place = t_place  # the headline names the place; GDELT's guess disagrees
        if place is None:
            continue  # the map needs a place
        countries = list(dict.fromkeys(t_countries + countries))[:5]
        try:
            published = datetime.strptime(cols[C_DATE], TS_FORMAT).replace(tzinfo=UTC)
        except ValueError:
            continue
        tone = _float(cols[C_TONE].split(",", 1)[0]) if cols[C_TONE] else None
        seen.add(url)
        items.append(
            Item(
                url=url,
                title=title,
                source_name=source,
                published_at=published,
                provider="gdelt",
                place=place,
                countries=countries,
                themes=themes,
                orgs=_orgs(cols[C_ORGS]),
                tone=tone,
                cls=cls,
            )
        )
    return items


def fetch(
    client: httpx.Client, places: Places, last: str | None, max_files: int = 4
) -> tuple[list[Item], str | None, dict[str, int]]:
    """New items since `last`. Returns (items, new cursor, stats)."""
    latest = latest_timestamp(client)
    stamps = timestamps_to_fetch(last, latest, max_files)
    items: list[Item] = []
    stats = {"files": 0, "missing": 0}
    for stamp in stamps:
        lines = download_lines(client, stamp)
        if lines is None:
            stats["missing"] += 1
            continue
        stats["files"] += 1
        items += parse_rows(lines, places)
    return items, (latest if stamps else last), stats

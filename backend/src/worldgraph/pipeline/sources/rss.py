"""Business news feeds: headlines and links from outlets and official bodies.

We keep the headline, link, outlet, date and at most one sentence of the
feed's own summary. Feeds are fetched politely: one request per feed per run,
with ETag / Last-Modified so unchanged feeds cost nothing.
"""

from __future__ import annotations

import calendar
import hashlib
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import feedparser
import httpx

from worldgraph.pipeline.items import Item
from worldgraph.pipeline.places import Places
from worldgraph.pipeline.text import clean_title, first_sentence
from worldgraph.pipeline.themes import classify

MAX_AGE = timedelta(hours=48)
SEEN_PER_FEED = 400


@dataclass(frozen=True)
class Feed:
    id: str
    name: str  # outlet shown in the app
    url: str
    country: str | None = None  # where stories are, when the headline doesn't say
    sectors: tuple[str, ...] = ()
    official: bool = False  # central banks, regulators, trade bodies
    business: bool = True  # a business section (False: general news, filtered harder)


FEEDS: tuple[Feed, ...] = (
    # Global business desks
    Feed("bbc-business", "BBC News", "https://feeds.bbci.co.uk/news/business/rss.xml", "region:gb"),
    Feed("guardian-business", "The Guardian", "https://www.theguardian.com/uk/business/rss", "region:gb"),
    Feed("dw-business", "DW", "https://rss.dw.com/rdf/rss-en-bus", "region:de"),
    Feed(
        "cnbc-business",
        "CNBC",
        "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147",
        "region:us",
    ),
    Feed("aljazeera", "Al Jazeera", "https://www.aljazeera.com/xml/rss/all.xml", business=False),
    Feed("nikkei-asia", "Nikkei Asia", "https://asia.nikkei.com/rss/feed/nar", "region:jp"),
    Feed("japan-times", "The Japan Times", "https://www.japantimes.co.jp/feed/", "region:jp", business=False),
    Feed(
        "straits-times-business",
        "The Straits Times",
        "https://www.straitstimes.com/news/business/rss.xml",
        "region:sg",
    ),
    Feed(
        "cna-business",
        "CNA",
        "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6936",
        "region:sg",
    ),
    Feed("scmp-business", "South China Morning Post", "https://www.scmp.com/rss/92/feed", "region:hk"),
    Feed(
        "the-national",
        "The National",
        "https://www.thenationalnews.com/arc/outboundfeeds/rss/?outputType=xml",
        "region:ae",
        business=False,
    ),
    Feed("dawn-business", "Dawn", "https://www.dawn.com/feeds/business", "region:pk"),
    Feed(
        "allafrica-business", "allAfrica", "https://allafrica.com/tools/headlines/rdf/business/headlines.rdf"
    ),
    Feed("africanews", "Africanews", "https://www.africanews.com/feed/rss", business=False),
    Feed("mercopress-economy", "MercoPress", "https://en.mercopress.com/rss/economy"),
    # India
    Feed(
        "et-economy",
        "The Economic Times",
        "https://economictimes.indiatimes.com/news/economy/rssfeeds/1373380680.cms",
        "region:in",
    ),
    Feed("mint-economy", "Mint", "https://www.livemint.com/rss/economy", "region:in"),
    Feed(
        "businessline-economy",
        "BusinessLine",
        "https://www.thehindubusinessline.com/economy/feeder/default.rss",
        "region:in",
    ),
    # Official sources
    Feed(
        "fed",
        "Federal Reserve",
        "https://www.federalreserve.gov/feeds/press_all.xml",
        "region:us",
        ("finance",),
        official=True,
    ),
    Feed(
        "ecb",
        "European Central Bank",
        "https://www.ecb.europa.eu/rss/press.html",
        "region:de",
        ("finance",),
        official=True,
    ),
    Feed(
        "rbi",
        "Reserve Bank of India",
        "https://www.rbi.org.in/pressreleases_rss.xml",
        "region:in",
        ("finance",),
        official=True,
    ),
    Feed(
        "wto",
        "WTO",
        "https://www.wto.org/library/rss/latest_news_e.xml",
        "region:ch",
        ("logistics-trade",),
        official=True,
    ),
    Feed(
        "eia", "US EIA", "https://www.eia.gov/rss/todayinenergy.xml", "region:us", ("energy",), official=True
    ),
)

# Official feeds post routine notices too; these never become stories.
_OFFICIAL_NOISE = (
    "tender",
    "recruitment",
    "vacancy",
    "corrigendum",
    "auction of",
    "money market operations",
    "results of",
    "minutes of",
    "calendar",
    "speech by",
    "interview with",
    "agenda",
    "holiday",
    "in the matter of",
    "penalty",
    "order against",
    "defaulter",
    "remittance advice",
)
# Official sites title speeches "Speaker Name: Topic".
_SPEECH = re.compile(r"^[A-Z][\w.'\- ]{2,40}: ")


def _published(entry: Any) -> datetime | None:
    parsed = entry.get("published_parsed") or entry.get("updated_parsed")
    if not parsed:
        return None
    return datetime.fromtimestamp(calendar.timegm(parsed), tz=UTC)


def url_key(url: str) -> str:
    return hashlib.sha1(url.encode()).hexdigest()[:12]


def parse_feed(
    feed: Feed, content: bytes, places: Places, *, now: datetime, seen: set[str] | None = None
) -> list[Item]:
    parsed = feedparser.parse(content)
    items: list[Item] = []
    for entry in parsed.entries:
        url = (entry.get("link") or "").strip()
        if not url.startswith("http") or (seen is not None and url_key(url) in seen):
            continue
        title = clean_title(entry.get("title"), feed.name)
        if len(title.split()) < 4:
            continue
        published = _published(entry) or now
        if published > now + timedelta(hours=1) or now - published > MAX_AGE:
            continue
        if feed.official and (any(word in title.lower() for word in _OFFICIAL_NOISE) or _SPEECH.match(title)):
            continue
        base = 8.0 if feed.official else (4.0 if feed.business else 0.0)
        cls = classify(title, default_sectors=feed.sectors, base_score=base)
        if feed.official and cls.score == 0 and feed.sectors:
            # Official notices rarely use newsroom words; trust the source.
            cls = classify(f"{title} {feed.sectors[0]}", default_sectors=feed.sectors, base_score=base)
        if cls.score < 6:
            continue
        snippet = first_sentence(entry.get("summary"))
        place, countries = places.place_from_text(title + " " + (snippet or ""), feed.country)
        if place is None:
            continue
        items.append(
            Item(
                url=url,
                title=title,
                source_name=feed.name,
                published_at=published,
                provider="rss",
                snippet=snippet if snippet and snippet.lower() != title.lower() else None,
                place=place,
                countries=countries,
                cls=cls,
            )
        )
    return items


def fetch(
    client: httpx.Client,
    places: Places,
    state: dict[str, Any],
    *,
    now: datetime | None = None,
    feeds: tuple[Feed, ...] = FEEDS,
) -> tuple[list[Item], dict[str, Any], dict[str, Any]]:
    """Fetch every feed. `state` holds ETags and recently seen links per feed.

    Returns (items, new state, stats). A failing feed is skipped and reported.
    """
    now = now or datetime.now(UTC)
    new_state: dict[str, Any] = {}
    items: list[Item] = []
    stats: dict[str, Any] = {"feeds_ok": 0, "unchanged": 0, "failed": []}
    for feed in feeds:
        fs = dict(state.get(feed.id) or {})
        headers = {}
        if fs.get("etag"):
            headers["If-None-Match"] = fs["etag"]
        if fs.get("modified"):
            headers["If-Modified-Since"] = fs["modified"]
        try:
            response = client.get(feed.url, headers=headers)
            if response.status_code == 304:
                stats["unchanged"] += 1
                new_state[feed.id] = fs
                continue
            response.raise_for_status()
        except httpx.HTTPError as exc:
            stats["failed"].append(f"{feed.id}: {type(exc).__name__}")
            new_state[feed.id] = fs
            continue
        seen = set(fs.get("seen") or [])
        found = parse_feed(feed, response.content, places, now=now, seen=seen)
        # Remember every link in the feed (kept or not) so it isn't reconsidered.
        links = [url_key((e.get("link") or "").strip()) for e in feedparser.parse(response.content).entries]
        merged = list(dict.fromkeys(links + list(fs.get("seen") or [])))[:SEEN_PER_FEED]
        new_state[feed.id] = {
            "etag": response.headers.get("etag"),
            "modified": response.headers.get("last-modified"),
            "seen": merged,
        }
        stats["feeds_ok"] += 1
        items += found
    return items, new_state, stats

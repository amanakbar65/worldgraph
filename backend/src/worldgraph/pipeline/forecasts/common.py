"""What every forecast provider produces, and how it is stored."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

import psycopg

from worldgraph.geo.gazetteer import slugify
from worldgraph.pipeline.entities import EntityMatcher
from worldgraph.pipeline.places import Places

MAX_TITLE_WORDS = 12

# Questions about people's private lives, games and entertainment are not shown.
EXCLUDE = re.compile(
    r"\b(I|I'll|I'm|me|my|mine|we|our)\b|"
    r"\b(nba|nfl|mlb|nhl|ufc|fifa|world cup|super bowl|premier league|champions league|cricket|tennis|"
    r"golf|f1|formula 1|olympic\w*|oscar\w*|grammy\w*|emmy\w*|box office|album|movie|film|celebrity|"
    r"taylor swift|kardashian|youtube|tiktok|twitch|streamer|manifold|this market|this question|"
    r"dating|married|pregnan\w*|die\b|death of|assassinat\w*|elon musk tweet|gta ?\d|"
    r"bet with|his bet|her bet|resolves? (yes|no|n/?a)|test market|poll:|polymarket|kalshi|betting|bets?)",
    re.IGNORECASE,
)
_BRACKETS = re.compile(r"\s*\[[^\]]*\]\s*")
_YEAR = re.compile(r"\b(19|20)\d\d\b")
# A question must be about the economy, markets or world affairs.
_WORLD_AFFAIRS = re.compile(
    r"\b(war|invade\w*|invasion|ceasefire|sanction\w*|regime|president|prime minister|election|"
    r"nato|treaty|nuclear|military|coup|default\w*|recession|economy|gdp|inflation|tariff\w*|"
    r"stablecoin|bitcoin|stock\w*|s&p|nasdaq|ipo|market cap\w*|price|oil|opec|fed|interest|"
    r"unemployment|debt|budget|trade)\b",
    re.IGNORECASE,
)
CATEGORY_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("energy", re.compile(r"\b(oil|opec|gas|lng|energy|solar|nuclear power|electricity|coal)\b", re.I)),
    ("trade", re.compile(r"\b(tariff\w*|trade|exports?|imports?|wto)\b", re.I)),
    (
        "geopolitics",
        re.compile(
            r"\b(war|invade\w*|invasion|ceasefire|sanction\w*|nato|military|regime|coup|annex\w*|"
            r"president|prime minister|leader)\b",
            re.I,
        ),
    ),
    (
        "finance",
        re.compile(
            r"\b(s&p|nasdaq|dow|stock\w*|shares|ipo|interest rates?|fed|ecb|bonds?|yields?|bitcoin|"
            r"stablecoin|market cap\w*|bank\w*)\b",
            re.I,
        ),
    ),
    ("tech", re.compile(r"\b(ai|agi|chips?|semiconductor\w*|openai|nvidia|software|robot\w*)\b", re.I)),
    ("commodities", re.compile(r"\b(gold|copper|lithium|wheat|coffee|cocoa|commodit\w*)\b", re.I)),
]


@dataclass
class Snapshot:
    ts: datetime
    probability: float
    volume: float | None = None
    liquidity: float | None = None


@dataclass
class Market:
    provider: str
    ref: str  # the provider's id
    question: str
    url: str | None
    probability: float
    volume: float
    liquidity: float | None
    end_date: datetime | None
    status: str = "open"  # open | closed | resolved
    resolved_outcome: str | None = None
    volume_unit: str = "MANA"
    real_money: bool = False
    category: str = "economy"
    slug: str | None = None
    history: list[Snapshot] = field(default_factory=list)

    @property
    def node_id(self) -> str:
        base = slugify(self.slug or self.question)[:60].strip("-") or slugify(self.ref)
        return f"forecast:{self.provider}-{base}"


def clean_question(question: str) -> str:
    """Drop tags such as "[ACX 2026]" or "[Ṁ10k liquidity]"."""
    return re.sub(r"\s+", " ", _BRACKETS.sub(" ", question)).strip()


def category_for(question: str, default: str) -> str:
    for category, rx in CATEGORY_RULES:
        if rx.search(question):
            return category
    return default


def short_title(question: str) -> tuple[str, bool]:
    """At most 12 words. Returns (title, shortened_by_rule)."""
    text = clean_question(question).rstrip("?").strip()
    words = text.split()
    if len(words) <= MAX_TITLE_WORDS:
        return text, False
    return " ".join(words[:MAX_TITLE_WORDS]) + "…", True


def allowed(question: str, now: datetime | None = None) -> bool:
    """Business-relevant, not personal, and not about a year that has already ended."""
    if EXCLUDE.search(question) or not _WORLD_AFFAIRS.search(question):
        return False
    year = (now or datetime.now(UTC)).year
    years = [int(m.group(0)) for m in _YEAR.finditer(question)]
    return not years or max(years) >= year


def upsert(
    conn: psycopg.Connection,
    m: Market,
    places: Places,
    matcher: EntityMatcher,
    now: datetime | None = None,
) -> bool:
    """Insert or update one market and record the current probability. Returns True if new."""
    now = now or datetime.now(UTC)
    title, auto = short_title(m.question)
    regions = [r for r in places.match_text(m.question) if places.country_of(r)]
    place = places.place_for(regions[0]) if regions else None
    point = f"SRID=4326;POINT({place.lon:.6f} {place.lat:.6f})" if place else None
    with conn.cursor() as cur:
        cur.execute(
            "select node_id from forecast where provider = %s and provider_ref = %s", (m.provider, m.ref)
        )
        row = cur.fetchone()
        node_id = row["node_id"] if row else m.node_id
        is_new = row is None
        if is_new:
            cur.execute("select 1 from node where id = %s", (node_id,))
            if cur.fetchone():
                node_id = f"{node_id[:70]}-{slugify(m.ref)[:12]}"
        cur.execute(
            """
            insert into node (id, type, subtype, name, summary, geom, is_sample)
            values (%s, 'forecast', 'binary', %s, %s, case when %s::text is null then null
                    else st_geogfromtext(%s) end, false)
            on conflict (id) do update set name = excluded.name, summary = excluded.summary,
                geom = coalesce(excluded.geom, node.geom), updated_at = now()
            """,
            (node_id, title, m.question, point, point),
        )
        cur.execute(
            """
            insert into forecast (node_id, provider, provider_ref, question, short_title, short_title_auto,
                category, end_date, url, is_real_money, volume_unit, status, resolved_outcome)
            values (%(id)s, %(provider)s, %(ref)s, %(question)s, %(title)s, %(auto)s, %(category)s,
                %(end)s, %(url)s, %(real)s, %(unit)s, %(status)s, %(resolved)s)
            on conflict (node_id) do update set question = excluded.question,
                short_title = case when forecast.short_title_auto then excluded.short_title
                                   else forecast.short_title end,
                end_date = excluded.end_date, url = excluded.url, status = excluded.status,
                resolved_outcome = excluded.resolved_outcome
            """,
            {
                "id": node_id,
                "provider": m.provider,
                "ref": m.ref,
                "question": m.question,
                "title": title,
                "auto": auto,
                "category": m.category,
                "end": m.end_date,
                "url": m.url,
                "real": m.real_money,
                "unit": m.volume_unit,
                "status": m.status,
                "resolved": m.resolved_outcome,
            },
        )
        snaps = list(m.history) if is_new else []
        snaps.append(
            Snapshot(now.replace(minute=0, second=0, microsecond=0), m.probability, m.volume, m.liquidity)
        )
        cur.executemany(
            "insert into forecast_snapshot (forecast_id, ts, probability, volume, liquidity) "
            "values (%s, %s, %s, %s, %s) on conflict (forecast_id, ts) do update set "
            "probability = excluded.probability, volume = excluded.volume, liquidity = excluded.liquidity",
            [(node_id, s.ts, min(max(s.probability, 0), 1), s.volume, s.liquidity) for s in snaps],
        )
        targets = list(dict.fromkeys((regions[:2] if regions else []) + matcher.match(m.question)))
        if targets:
            cur.execute(
                "insert into edge (src, dst, type) select %s, n.id, 'about' from node n where n.id = any(%s) "
                "on conflict do nothing",
                (node_id, targets),
            )
    return is_new


def downsample(points: list[tuple[datetime, float]], now: datetime) -> list[Snapshot]:
    """Daily points for 30 days, hourly for the last 72 hours (like the sample data)."""
    points = sorted(p for p in points if now - p[0] <= timedelta(days=30))
    out: dict[datetime, float] = {}
    for ts, prob in points:
        if now - ts <= timedelta(hours=72):
            key = ts.replace(minute=0, second=0, microsecond=0)
        else:
            key = ts.replace(hour=0, minute=0, second=0, microsecond=0)
        out[key] = prob  # the last value in each bucket
    return [Snapshot(ts, p) for ts, p in sorted(out.items())]


def to_json(m: Market) -> str:
    return json.dumps(m.__dict__, default=str)

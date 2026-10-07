"""Rules-based first pass: is a news item about business, and which sectors?

GDELT tags every article with themes (ECON_INFLATION, ENV_OIL…). Feeds give
only a headline. Both go through the same rules so a draft story gets a
sector guess, an event type and a relevance score before any AI looks at it.
These are guesses: AI analysis (or nothing) replaces them, and the app shows
unanalysed stories as drafts.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field

# Theme prefix → (weight, sectors, event type). Longest matching prefix wins.
THEMES: dict[str, tuple[float, tuple[str, ...], str | None]] = {
    # Finance and macro
    "ECON_CENTRALBANK": (3, ("finance",), "policy-decision"),
    "WB_1235_CENTRAL_BANKS": (2, ("finance",), "policy-decision"),
    "ECON_INTEREST_RATE": (3, ("finance", "real-estate"), "policy-decision"),
    "ECON_INFLATION": (3, ("finance", "consumer"), "economic-data"),
    "WB_442_INFLATION": (2, ("finance",), "economic-data"),
    "ECON_STOCKMARKET": (2, ("finance",), "market-shift"),
    "ECON_CURRENCY_EXCHANGE_RATE": (3, ("finance", "logistics-trade"), "market-shift"),
    "ECON_CURRENCY_RESERVES": (3, ("finance",), "economic-data"),
    "ECON_WORLDCURRENCIES": (0.5, ("finance",), None),
    "ECON_DEBT": (2, ("finance",), "economic-data"),
    "ECON_SOVEREIGN_DEBT": (3, ("finance",), "economic-data"),
    "ECON_BUDGET_DEFICIT": (2, ("finance",), "policy"),
    "ECON_TAXATION": (1.5, ("finance",), "policy"),
    "ECON_SUBSIDIES": (2, (), "policy"),
    "ECON_BANKRUPTCY": (3, ("finance",), "company-update"),
    "ECON_IPO": (3, ("finance",), "company-update"),
    "ECON_EARNINGSREPORT": (3, ("finance",), "company-update"),
    "ECON_FOREIGNINVEST": (3, ("finance",), "investment"),
    "ECON_ENTREPRENEURSHIP": (1, (), "investment"),
    "ECON_MOU": (2, (), "investment"),
    "ECON_NATIONALIZE": (3, (), "policy"),
    "ECON_UNEMPLOYMENT": (2, ("consumer",), "economic-data"),
    "UNEMPLOYMENT": (1.5, ("consumer",), "economic-data"),
    "ECON_COST_OF_LIVING": (2, ("consumer",), "economic-data"),
    "ECON_HOUSING_PRICES": (3, ("real-estate",), "price-move"),
    "ECON_REALESTATE": (3, ("real-estate",), None),
    "ECON_BITCOIN": (1, ("finance", "tech"), "market-shift"),
    "WB_318_FINANCIAL_ARCHITECTURE_AND_BANKING": (2, ("finance",), None),
    "WB_1104_MACROECONOMIC_VULNERABILITY_AND_DEBT": (1.5, ("finance",), "economic-data"),
    "WB_2936_GOLD": (1.5, ("finance",), "price-move"),
    "EPU_ECONOMY": (0.5, (), None),
    "TAX_ECON_PRICE": (0.5, ("consumer",), "price-move"),
    # Trade and logistics
    "ECON_FREETRADE": (3, ("logistics-trade",), "trade-flow"),
    "TAX_ECON_FREETRADEAGREEMENTS": (3, ("logistics-trade",), "trade-flow"),
    "ECON_TRADE_DISPUTE": (3, ("logistics-trade",), "trade-flow"),
    "ECON_TRANSPORT_COST": (3, ("logistics-trade",), "price-move"),
    "SANCTIONS": (2.5, ("logistics-trade",), "policy"),
    "BLOCKADE": (2.5, ("logistics-trade",), "disruption"),
    "MARITIME": (1, ("logistics-trade",), None),
    "STRIKE": (2, ("logistics-trade", "manufacturing"), "labour"),
    "ECON_UNIONS": (1.5, ("manufacturing",), "labour"),
    "SHORTAGE": (2, (), "disruption"),
    "INFRASTRUCTURE_BAD_ROADS": (0.5, ("logistics-trade",), None),
    # Energy
    "ENV_OIL": (2.5, ("energy",), None),
    "ECON_OILPRICE": (3, ("energy",), "price-move"),
    "FUELPRICES": (3, ("energy", "consumer"), "price-move"),
    "ECON_GASOLINEPRICE": (3, ("energy", "consumer"), "price-move"),
    "ECON_DIESELPRICE": (3, ("energy", "logistics-trade"), "price-move"),
    "ECON_HEATINGOIL": (2, ("energy",), "price-move"),
    "ECON_NATGASPRICE": (3, ("energy",), "price-move"),
    "ENV_NATURALGAS": (2.5, ("energy",), None),
    "ENV_COAL": (2, ("energy",), None),
    "ENV_SOLAR": (2, ("energy",), "investment"),
    "ENV_WINDPOWER": (2, ("energy",), "investment"),
    "ENV_NUCLEARPOWER": (2, ("energy",), None),
    "ENV_HYDRO": (1.5, ("energy",), None),
    "ENV_BIOFUEL": (2, ("energy", "agri-food"), None),
    "ENV_GEOTHERMAL": (1.5, ("energy",), None),
    "ECON_ELECTRICALGRID": (2.5, ("energy",), None),
    "ECON_ELECTRICALPRICE": (3, ("energy", "consumer"), "price-move"),
    "ECON_ELECTRICALGENERATION": (2.5, ("energy",), None),
    "ECON_ELECTRICALDEMAND": (2.5, ("energy",), None),
    "POWER_OUTAGE": (2.5, ("energy",), "disruption"),
    # Materials, agriculture, health, tech
    "ENV_MINING": (2, ("manufacturing",), None),
    "ENV_METALS": (2, ("manufacturing",), None),
    "WB_1699_METAL_ORE_MINING": (1.5, ("manufacturing",), None),
    "AGRICULTURE": (2, ("agri-food",), None),
    "FOOD_SECURITY": (2, ("agri-food",), None),
    "ECON_FOODPRICES": (3, ("agri-food", "consumer"), "price-move"),
    "WB_435_AGRICULTURE_AND_FOOD_SECURITY": (1.5, ("agri-food",), None),
    "CYBER_ATTACK": (2.5, ("tech",), "disruption"),
    "WB_133_INFORMATION_AND_COMMUNICATION_TECHNOLOGIES": (1, ("tech",), None),
    "TAX_FNCACT_CEO": (1, (), "company-update"),
    # Hazards
    "NATURAL_DISASTER": (1.5, (), "extreme-weather"),
    "NATURAL_DISASTER_EARTHQUAKE": (2, (), "hazard"),
    "NATURAL_DISASTER_DROUGHT": (2.5, ("agri-food",), "extreme-weather"),
    "NATURAL_DISASTER_MONSOON": (2, ("agri-food",), "extreme-weather"),
    "NATURAL_DISASTER_HEATWAVE": (2, ("energy", "agri-food"), "extreme-weather"),
    "MANMADE_DISASTER": (0.5, (), "disruption"),
}

# Headline words. Each sector's words both mark relevance and add the sector.
TITLE_SECTORS: dict[str, str] = {
    "energy": r"oil|crude|brent|wti|opec|gas|lng|fuel|diesel|petrol|gasoline|power|electricity|grid|"
    r"coal|solar|wind farm|renewable|nuclear|refiner\w*|energy|hydrogen|battery|batteries",
    "agri-food": r"wheat|rice|maize|corn|soy\w*|sugar|coffee|cocoa|palm oil|grain\w*|crop\w*|harvest|"
    r"monsoon|fertili[sz]er\w*|food prices?|farm\w*|dairy|fishing|livestock",
    "manufacturing": r"steel|alumin\w*|copper|lithium|nickel|rare earths?|factor(y|ies)|manufactur\w*|"
    r"automaker\w*|car ?makers?|plant|output|industrial|mining|miners?|pmi",
    "logistics-trade": r"tariffs?|exports?|imports?|trade|shipping|freight|container\w*|ports?|canal|"
    r"supply chains?|customs|sanctions?|embargo|logistics|cargo|airline\w*|rail",
    "finance": r"rates?|inflation|central bank|fed|ecb|rbi|boj|bonds?|yields?|stocks?|shares|markets?|"
    r"currency|rupee|yuan|yen|dollar|euro|peso|naira|lira|debt|imf|gdp|recession|banks?|budget|"
    r"deficit|investors?|earnings|profits?|ipo|credit|loans?|tax\w*",
    "tech": r"chips?|semiconductors?|ai|data cent(re|er)s?|software|smartphones?|cyber\w*|telecom\w*|5g|"
    r"cloud|startup\w*|tech",
    "health": r"pharma\w*|drugs?|vaccines?|medicines?|hospital\w*|health ?care|biotech",
    "real-estate": r"housing|property|real estate|mortgages?|home prices|construction|cement",
    "consumer": r"retail\w*|consumers?|prices|spending|sales|demand|e-?commerce|brands?",
}
_TITLE_SECTOR_RES = {
    sector: re.compile(rf"\b(?:{words})\b", re.IGNORECASE) for sector, words in TITLE_SECTORS.items()
}

TITLE_EVENTS: list[tuple[str, re.Pattern[str]]] = [
    ("hazard", re.compile(r"\b(earthquake|quake|tsunami|eruption|volcano)\b", re.I)),
    (
        "extreme-weather",
        re.compile(r"\b(flood\w*|cyclone|typhoon|hurricane|storm|drought|heat ?wave|wildfire)\b", re.I),
    ),
    (
        "policy-decision",
        re.compile(r"\b(rate (cut|hike|decision)|cuts? rates?|raises? rates?|holds? rates?)\b", re.I),
    ),
    (
        "trade-flow",
        re.compile(r"\b(tariffs?|trade (deal|pact|agreement|talks|war)|export ban|import ban|quota)\b", re.I),
    ),
    (
        "disruption",
        re.compile(r"\b(strike|shutdown|outage|blockade|disrupt\w*|shortage|halt\w*|closure)\b", re.I),
    ),
    (
        "price-move",
        re.compile(
            r"\b(prices?|surges?|soars?|jumps?|slumps?|plunges?|falls?|rises?|record high|record low)\b", re.I
        ),
    ),
    (
        "economic-data",
        re.compile(r"\b(gdp|inflation|cpi|pmi|unemployment|jobs report|trade deficit|growth)\b", re.I),
    ),
    (
        "investment",
        re.compile(r"\b(invest\w*|plant|factory|expansion|funding|acquires|acquisition|merger|deal)\b", re.I),
    ),
    ("policy", re.compile(r"\b(policy|bill|law|regulat\w*|ban|subsid\w*|budget|reform)\b", re.I)),
    ("company-update", re.compile(r"\b(earnings|profit|revenue|ceo|ipo|layoffs?|results)\b", re.I)),
]

# Headlines that are almost never business news.
EXCLUDE_TITLE = re.compile(
    r"\b(horoscope|recipe|celebrity|box office|trailer|cricket|football|soccer|nba|nfl|ipl|premier league|"
    r"tennis|golf|olympic\w*|match|wedding|dating|murder\w*|stabb\w*|obituar\w*|lottery|quiz|"
    r"how to watch|live stream|movie|film|album|concert|sports?|selfie|weather forecast|"
    r"convicted|sentenced|arrested|jailed|charged with|accused|rape|kidnap\w*|shooting)\b",
    re.IGNORECASE,
)

RISK_EVENTS = {"hazard", "extreme-weather", "disruption", "conflict", "labour"}

# Headline events strong enough to count without a sector word.
STRONG_TITLE_EVENTS = {"hazard", "extreme-weather", "disruption", "trade-flow", "policy-decision"}


@dataclass
class Classification:
    score: float
    sectors: list[str] = field(default_factory=list)
    event_type: str = "market-shift"
    impact: str = "neutral"
    magnitude: int = 2


def _theme_rule(theme: str) -> tuple[float, tuple[str, ...], str | None] | None:
    best_key = None
    for key in THEMES:
        if theme.startswith(key) and (best_key is None or len(key) > len(best_key)):
            best_key = key
    return THEMES[best_key] if best_key else None


def title_sectors(title: str) -> Counter[str]:
    hits: Counter[str] = Counter()
    for sector, rx in _TITLE_SECTOR_RES.items():
        n = len(rx.findall(title))
        if n:
            hits[sector] += n
    return hits


def title_event(title: str) -> str | None:
    for event, rx in TITLE_EVENTS:
        if rx.search(title):
            return event
    return None


def classify(
    title: str,
    themes: Counter[str] | None = None,
    *,
    default_sectors: tuple[str, ...] = (),
    base_score: float = 0,
) -> Classification:
    """Score and label one item. `themes` counts GDELT theme mentions."""
    if EXCLUDE_TITLE.search(title):
        return Classification(score=0)

    sector_weight: Counter[str] = Counter()
    event_weight: Counter[str] = Counter()
    score = base_score
    for theme, count in (themes or Counter()).items():
        rule = _theme_rule(theme)
        if rule is None:
            continue
        weight, sectors, event = rule
        w = weight * min(count, 3)
        score += w
        for s in sectors:
            sector_weight[s] += w
        if event:
            event_weight[event] += w

    t_sectors = title_sectors(title)
    t_event = title_event(title)
    if not t_sectors and t_event not in STRONG_TITLE_EVENTS:
        # Themes alone aren't enough: the headline itself must be about business.
        return Classification(score=0)
    score += 2 * min(sum(t_sectors.values()), 3)
    for s, n in t_sectors.items():
        sector_weight[s] += 3 * n
    for s in default_sectors:
        sector_weight[s] += 1

    event = t_event or (event_weight.most_common(1)[0][0] if event_weight else "market-shift")
    sectors = [s for s, _ in sector_weight.most_common(3)]
    impact = "risk" if event in RISK_EVENTS else "neutral"
    magnitude = 3 if event in ("hazard", "policy-decision") else 2
    return Classification(
        score=round(score, 1), sectors=sectors, event_type=event, impact=impact, magnitude=magnitude
    )

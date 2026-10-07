"""Where is a news item about? Places from GDELT codes, coordinates or text.

Everything resolves to our region ids (country, state, city) from the
committed gazetteer, so the pipeline needs no network or GIS libraries.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from worldgraph.geo.gazetteer import GAZETTEER_PATH

FIPS_PATH = Path(__file__).resolve().parent / "data" / "fips.json"


@dataclass(frozen=True)
class Place:
    country_id: str
    admin1_id: str | None
    city_id: str | None
    lon: float
    lat: float
    precision: str  # 'country' | 'state' | 'city' | 'point'

    @property
    def region_id(self) -> str:
        """The most specific region we know."""
        return self.city_id or self.admin1_id or self.country_id


# Extra names for matching countries in headlines. Demonyms count: "Indian
# exports" is about India. Ambiguous words (e.g. "Turkey", "Chad", "Jordan",
# "Georgia", "Niger") are matched only with a capital letter, like every name.
COUNTRY_ALIASES: dict[str, list[str]] = {
    "US": [
        "United States",
        "U.S.",
        "US",
        "USA",
        "America",
        "American",
        "Americans",
        "Washington",
        "Wall Street",
    ],
    "GB": ["UK", "U.K.", "Britain", "British", "England", "Scotland", "Wales", "London"],
    "CN": ["Chinese", "Beijing", "PRC"],
    "IN": ["Indian", "Indians", "New Delhi", "Delhi", "Mumbai", "Bharat"],
    "JP": ["Japanese", "Tokyo"],
    "DE": ["German", "Germans", "Berlin", "Frankfurt"],
    "FR": ["French", "Paris"],
    "IT": ["Italian", "Rome", "Milan"],
    "ES": ["Spanish", "Madrid"],
    "RU": ["Russian", "Russians", "Moscow", "Kremlin"],
    "UA": ["Ukrainian", "Kyiv", "Kiev"],
    "BR": ["Brazilian", "Brasilia", "Brasília", "Sao Paulo", "São Paulo"],
    "MX": ["Mexican", "Mexico City"],
    "CA": ["Canadian", "Ottawa", "Toronto"],
    "AU": ["Australian", "Canberra", "Sydney"],
    "KR": ["South Korean", "Korean", "Seoul"],
    "KP": ["North Korean", "Pyongyang"],
    "TW": ["Taiwanese", "Taipei"],
    "SA": ["Saudi", "Riyadh"],
    "AE": ["UAE", "U.A.E.", "Emirati", "Dubai", "Abu Dhabi"],
    "IR": ["Iranian", "Tehran"],
    "IL": ["Israeli", "Tel Aviv"],
    "TR": ["Turkish", "Türkiye", "Ankara", "Istanbul"],
    "EG": ["Egyptian", "Cairo", "Suez"],
    "NG": ["Nigerian", "Lagos", "Abuja"],
    "ZA": ["South African", "Johannesburg", "Pretoria"],
    "KE": ["Kenyan", "Nairobi"],
    "ET": ["Ethiopian", "Addis Ababa"],
    "GH": ["Ghanaian", "Accra"],
    "PK": ["Pakistani", "Islamabad", "Karachi"],
    "BD": ["Bangladeshi", "Dhaka"],
    "LK": ["Sri Lankan", "Colombo"],
    "NP": ["Nepali", "Nepalese", "Kathmandu"],
    "ID": ["Indonesian", "Jakarta"],
    "MY": ["Malaysian", "Kuala Lumpur"],
    "SG": ["Singaporean"],
    "TH": ["Thai", "Bangkok"],
    "VN": ["Vietnamese", "Hanoi", "Ho Chi Minh City", "Viet Nam"],
    "PH": ["Philippine", "Filipino", "Manila"],
    "AR": ["Argentine", "Argentinian", "Buenos Aires"],
    "CL": ["Chilean"],
    "CO": ["Colombian", "Bogota", "Bogotá"],
    "PE": ["Peruvian", "Lima"],
    "VE": ["Venezuelan", "Caracas"],
    "NL": ["Dutch", "Amsterdam", "Rotterdam", "Holland"],
    "BE": ["Belgian", "Brussels"],
    "CH": ["Swiss", "Geneva", "Zurich"],
    "SE": ["Swedish", "Stockholm"],
    "NO": ["Norwegian", "Oslo"],
    "DK": ["Danish", "Copenhagen"],
    "FI": ["Finnish", "Helsinki"],
    "PL": ["Polish", "Warsaw"],
    "GR": ["Greek", "Athens"],
    "PT": ["Portuguese", "Lisbon"],
    "IE": ["Irish", "Dublin"],
    "AT": ["Austrian", "Vienna"],
    "CZ": ["Czech", "Czech Republic", "Prague"],
    "HU": ["Hungarian", "Budapest"],
    "RO": ["Romanian", "Bucharest"],
    "QA": ["Qatari", "Doha"],
    "KW": ["Kuwaiti"],
    "OM": ["Omani", "Muscat"],
    "IQ": ["Iraqi", "Baghdad"],
    "SY": ["Syrian", "Damascus"],
    "LB": ["Lebanese", "Beirut"],
    "YE": ["Yemeni", "Houthi", "Houthis"],
    "MA": ["Moroccan", "Rabat", "Casablanca"],
    "DZ": ["Algerian", "Algiers"],
    "TN": ["Tunisian"],
    "LY": ["Libyan", "Tripoli"],
    "KZ": ["Kazakh", "Kazakhstani"],
    "CD": ["DR Congo", "DRC", "Democratic Republic of the Congo", "Congolese", "Kinshasa"],
    "CI": ["Ivory Coast", "Ivorian", "Cote d'Ivoire", "Côte d’Ivoire", "Abidjan"],
    "TZ": ["Tanzanian", "Dar es Salaam"],
    "UG": ["Ugandan", "Kampala"],
    "ZM": ["Zambian", "Lusaka"],
    "ZW": ["Zimbabwean", "Harare"],
    "MZ": ["Mozambican", "Maputo"],
    "AO": ["Angolan", "Luanda"],
    "SN": ["Senegalese", "Dakar"],
    "NZ": ["Kiwi", "Wellington", "Auckland"],
    "HK": ["Hong Kong"],
    "MM": ["Burmese", "Myanmar's"],
    "KH": ["Cambodian", "Phnom Penh"],
    "PA": ["Panamanian", "Panama Canal"],
    "CU": ["Cuban", "Havana"],
    "BO": ["Bolivian"],
    "EC": ["Ecuadorian", "Quito"],
    "UY": ["Uruguayan", "Montevideo"],
    "PY": ["Paraguayan"],
    "SD": ["Sudanese", "Khartoum"],
    "SS": ["South Sudan"],
    "SO": ["Somali"],
    "BA": ["Bosnia", "Bosnia and Herzegovina"],
    "DO": ["Dominican Republic"],
    "CF": ["Central African Republic"],
    "GQ": ["Equatorial Guinea"],
    "AG": ["Antigua and Barbuda"],
    "KN": ["Saint Kitts and Nevis"],
    "VC": ["Saint Vincent and the Grenadines"],
    "ST": ["Sao Tome and Principe"],
    "SB": ["Solomon Islands"],
    "SZ": ["Eswatini", "Swaziland"],
    "MK": ["Macedonia"],
    "TL": ["East Timor"],
    "PS": ["Palestinian", "Gaza", "West Bank"],
}

# Names that are also everyday words or are ambiguous across countries.
_NEVER_MATCH = {"Victoria", "Kingston", "Hamilton", "Georgetown", "Male", "Malé", "Santiago", "Of"}

_EARTH_KM = 6371.0


def _km(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * _EARTH_KM * math.asin(min(1.0, math.sqrt(a)))


class Places:
    def __init__(self, gazetteer: list[dict[str, Any]], fips: dict[str, Any]) -> None:
        self.rows = {r["id"]: r for r in gazetteer}
        self.fips_country: dict[str, str] = fips["country"]
        self.fips_adm1: dict[str, str] = fips["adm1"]
        self.by_iso2 = {r["iso2"]: r["id"] for r in gazetteer if r["subtype"] == "country"}
        self.states_by_country: dict[str, list[dict[str, Any]]] = {}
        for r in gazetteer:
            if r["subtype"] == "state":
                self.states_by_country.setdefault(r["parent"], []).append(r)
        self._points = [r for r in gazetteer if r["subtype"] in ("state", "city")]
        self._matcher, self._names = self._build_matcher(gazetteer)

    # -- lookups -----------------------------------------------------------

    def country_of(self, region_id: str) -> str | None:
        row = self.rows.get(region_id)
        while row is not None and row["subtype"] != "country":
            row = self.rows.get(row.get("parent", ""))
        return row["id"] if row else None

    def admin1_of(self, region_id: str) -> str | None:
        row = self.rows.get(region_id)
        while row is not None and row["subtype"] not in ("state", "country"):
            row = self.rows.get(row.get("parent", ""))
        return row["id"] if row and row["subtype"] == "state" else None

    def place_for(self, region_id: str) -> Place | None:
        row = self.rows.get(region_id)
        country = self.country_of(region_id)
        if row is None or country is None:
            return None
        return Place(
            country_id=country,
            admin1_id=self.admin1_of(region_id),
            city_id=region_id if row["subtype"] == "city" else None,
            lon=row["lon"],
            lat=row["lat"],
            precision=row["subtype"],
        )

    def nearest_state(self, country_id: str, lon: float, lat: float, max_km: float = 800) -> str | None:
        best, best_km = None, max_km
        for row in self.states_by_country.get(country_id, []):
            km = _km(lon, lat, row["lon"], row["lat"])
            if km < best_km:
                best, best_km = row["id"], km
        return best

    def nearest_country(self, lon: float, lat: float, max_km: float = 400) -> str | None:
        """For coordinates without a country (e.g. an offshore earthquake)."""
        best, best_km = None, max_km
        for row in self._points:
            km = _km(lon, lat, row["lon"], row["lat"])
            if km < best_km:
                best, best_km = row["id"], km
        return self.country_of(best) if best else None

    # -- GDELT -------------------------------------------------------------

    def from_gdelt(
        self, loc_type: str, country_fips: str, adm1: str, lat: float | None, lon: float | None
    ) -> Place | None:
        """One GDELT location: type 1 country, 2 US state, 3 US city, 4 world city, 5 world state."""
        country = self.fips_country.get(country_fips)
        if country is None:
            return None
        crow = self.rows[country]
        if loc_type == "1":
            return Place(country, None, None, crow["lon"], crow["lat"], "country")
        admin1 = self.fips_adm1.get(adm1) if adm1 and not adm1.endswith("00") else None
        if admin1 is not None and self.rows[admin1]["parent"] != country:
            admin1 = None  # stale code pointing across a border
        if admin1 is None and lat is not None and lon is not None:
            admin1 = self.nearest_state(country, lon, lat)
        if loc_type in ("3", "4") and lat is not None and lon is not None:
            return Place(country, admin1, None, lon, lat, "city")
        if admin1 is not None:
            srow = self.rows[admin1]
            return Place(country, admin1, None, srow["lon"], srow["lat"], "state")
        return Place(country, None, None, crow["lon"], crow["lat"], "country")

    # -- text --------------------------------------------------------------

    def _build_matcher(self, gazetteer: list[dict[str, Any]]) -> tuple[re.Pattern[str], dict[str, str]]:
        names: dict[str, str] = {}
        for r in gazetteer:
            if r["subtype"] == "country" and "." not in r["name"]:
                names.setdefault(r["name"], r["id"])
        # Cities next (more precise than a country alias such as "Mumbai").
        cities = sorted(
            (r for r in gazetteer if r["subtype"] == "city"), key=lambda r: -(r.get("population") or 0)
        )
        for r in cities:
            names.setdefault(r["name"].split(",")[0].strip(), r["id"])
        for iso2, aliases in COUNTRY_ALIASES.items():
            region = self.by_iso2.get(iso2)
            if region:
                for alias in aliases:
                    names.setdefault(alias, region)
        for bad in _NEVER_MATCH:
            names.pop(bad, None)
        # Longest names first so "South Sudan" wins over "Sudan".
        alternatives = sorted(names, key=len, reverse=True)
        body = "|".join(re.escape(n) for n in alternatives)
        pattern = re.compile(rf"(?<![\w.])(?:{body})(?:'s|’s)?(?![\w])")
        return pattern, names

    def match_text(self, text: str) -> list[str]:
        """Region ids named in the text, in order of first mention, without repeats."""
        found: list[str] = []
        for m in self._matcher.finditer(text):
            name = re.sub(r"(?:'s|’s)$", "", m.group(0))
            region = self._names.get(name)
            if region and region not in found:
                found.append(region)
        return found

    def place_from_text(
        self, text: str, default_country: str | None = None
    ) -> tuple[Place | None, list[str]]:
        """The first place named in the text (else the default), plus every country named."""
        regions = self.match_text(text)
        countries: list[str] = []
        for region in regions:
            country = self.country_of(region)
            if country and country not in countries:
                countries.append(country)
        if regions:
            return self.place_for(regions[0]), countries
        if default_country and default_country in self.rows:
            return self.place_for(default_country), [default_country]
        return None, countries


@lru_cache
def load_places() -> Places:
    gazetteer = json.loads(GAZETTEER_PATH.read_text(encoding="utf-8"))
    fips = json.loads(FIPS_PATH.read_text(encoding="utf-8"))
    return Places(gazetteer, fips)

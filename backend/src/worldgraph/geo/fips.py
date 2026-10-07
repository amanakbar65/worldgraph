"""Build the FIPS 10-4 → region lookup the news pipeline uses for GDELT.

GDELT tags places with FIPS 10-4 codes (country 'IN', state 'IN09'; US
states as 'USCA'), not ISO codes. Natural Earth carries both, so we map them
once and commit the result (pipeline/data/fips.json) so the pipeline needs
no download.

Run with `uv run wg geo fips` (after `wg geo gazetteer` has cached Natural Earth).
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from worldgraph.geo.gazetteer import CACHE_DIR, GAZETTEER_PATH, _features, download

FIPS_PATH = Path(__file__).resolve().parents[1] / "pipeline" / "data" / "fips.json"

_ISO_3166_2 = re.compile(r"^[A-Z]{2}-[A-Z0-9]{1,3}$")

# Countries whose FIPS code Natural Earth leaves blank, plus territories
# GDELT codes separately.
COUNTRY_OVERRIDES = {
    "NO": "region:no",  # Norway
    "IS": "region:il",  # Israel (FIPS 'IS'; Iceland is 'IC')
    "OD": "region:ss",  # South Sudan
    "WE": "region:ps",  # West Bank
    "GZ": "region:ps",  # Gaza Strip
    "RB": "region:rs",  # Serbia (GDELT's code)
}


def _state_id(p: dict[str, Any]) -> str:
    """The same id rule as gazetteer.build_states."""
    iso2 = (p.get("iso_a2") or "").upper()
    code = (p.get("iso_3166_2") or "").upper()
    if _ISO_3166_2.match(code) and code.startswith(iso2 + "-"):
        return f"region:{code.lower()}"
    return f"region:{iso2.lower()}-ne{p['ne_id']}"


def build_fips(cache_dir: Path = CACHE_DIR, out: Path = FIPS_PATH) -> dict[str, int]:
    paths = download(cache_dir)
    known = {row["id"] for row in json.loads(GAZETTEER_PATH.read_text(encoding="utf-8"))}

    countries: dict[str, str] = {}
    for feature in _features(paths["countries"]):
        p = feature["properties"]
        fips, iso2 = p.get("FIPS_10"), p.get("ISO_A2_EH")
        if not fips or fips == "-99" or not iso2 or iso2 == "-99":
            continue
        region_id = f"region:{iso2.lower()}"
        if region_id in known:
            # Prefer the sovereign entry when two features share a code.
            countries.setdefault(fips, region_id)
    for fips, region_id in COUNTRY_OVERRIDES.items():
        if region_id in known:
            countries[fips] = region_id

    iso_to_fips: dict[str, str] = {}
    for fips, region_id in countries.items():
        iso_to_fips.setdefault(region_id.split(":")[1].upper(), fips)

    # GDELT's state codes follow GeoNames (country FIPS + GeoNames admin-1
    # number), which mostly matches FIPS 10-4. Try GeoNames first, then
    # Natural Earth's own FIPS fields; on a tie the larger shape wins.
    adm1: dict[str, tuple[int, float, str]] = {}
    for feature in _features(paths["states"]):
        p = feature["properties"]
        state_id = _state_id(p)
        iso2 = (p.get("iso_a2") or "").upper()
        if state_id not in known or iso2 not in iso_to_fips:
            continue
        area = float(p.get("area_sqkm") or 0)
        codes: list[str | None] = []
        if iso2 == "US" and p.get("postal"):
            codes.append("US" + p["postal"].upper())  # GDELT writes US states as USCA
        gn = p.get("gn_a1_code") or ""
        if "." in gn:
            codes.append(iso_to_fips[iso2] + gn.split(".", 1)[1])
        codes += [p.get("fips"), *(p.get("fips_alt") or "").split("|")]
        for rank, code in enumerate(codes):
            if not code or len(code) < 3:
                continue
            code = code.upper()
            best = adm1.get(code)
            if best is None or (rank, -area) < (best[0], -best[1]):
                adm1[code] = (rank, area, state_id)

    data = {
        "source": "Natural Earth (public domain): FIPS_10, gn_a1_code, fips, fips_alt, postal",
        "country": dict(sorted(countries.items())),
        "adm1": {code: state for code, (_, _, state) in sorted(adm1.items())},
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=0) + "\n", encoding="utf-8")
    return {"countries": len(countries), "states": len(data["adm1"])}

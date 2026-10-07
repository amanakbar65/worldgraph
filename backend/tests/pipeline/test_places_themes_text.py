"""Places, relevance rules and text helpers (no network, no database)."""

from __future__ import annotations

import re
from collections import Counter

from worldgraph.pipeline.places import load_places
from worldgraph.pipeline.text import clean_title, first_sentence, limit_words, story_id
from worldgraph.pipeline.themes import classify


def test_gdelt_codes_map_to_our_regions():
    p = load_places()
    gj = p.from_gdelt("4", "IN", "IN09", 23.02, 72.57)  # Ahmedabad, Gujarat (GeoNames code)
    assert gj and gj.country_id == "region:in" and gj.admin1_id == "region:in-gj" and gj.precision == "city"
    ca = p.from_gdelt("2", "US", "USCA", 37.0, -120.0)
    assert ca and ca.admin1_id == "region:us-ca"
    # FIPS differs from ISO: AS is Australia, AU is Austria, IS is Israel.
    assert p.from_gdelt("1", "AS", "AS", None, None).country_id == "region:au"
    assert p.from_gdelt("1", "AU", "AU", None, None).country_id == "region:at"
    assert p.from_gdelt("1", "IS", "IS", None, None).country_id == "region:il"
    assert p.from_gdelt("1", "OS", "OS", None, None) is None  # oceans: no country


def test_unknown_state_code_falls_back_to_nearest_state():
    p = load_places()
    place = p.from_gdelt("4", "IN", "IN00", 19.07, 72.88)  # Mumbai, no state code
    assert place and place.admin1_id == "region:in-mh"


def test_headline_places():
    p = load_places()
    assert p.match_text("South Sudan oil exports resume") == ["region:ss"]
    place, countries = p.place_from_text("Indian rice exporters cheer as Jakarta lifts curbs")
    assert countries == ["region:in", "region:id"]
    assert place and place.country_id == "region:in"
    mumbai, _ = p.place_from_text("Mumbai port congestion eases")
    assert mumbai and mumbai.city_id and mumbai.admin1_id == "region:in-mh"
    none, _ = p.place_from_text("Prices rise again", default_country="region:gb")
    assert none and none.country_id == "region:gb"
    # Everyday words that are also place names are not matched.
    assert p.match_text("Male workers strike at Victoria plant") == []


def test_nearest_country_for_offshore_points():
    p = load_places()
    assert p.nearest_country(121.8, 23.9) == "region:tw"
    assert p.nearest_country(-150.0, -40.0) is None  # the middle of the Pacific


def test_relevance_rules():
    oil = classify("Oil prices jump as OPEC extends output cuts", Counter({"ENV_OIL": 3, "ECON_OILPRICE": 2}))
    assert oil.score >= 7 and oil.sectors[0] == "energy" and oil.event_type == "price-move"
    # Themes alone never make an item business news: the headline must say so.
    weather = classify("Sunny and dry for now, one wet day this weekend", Counter({"NATURAL_DISASTER": 3}))
    assert weather.score == 0
    assert (
        classify("Premier League: transfer market prices soar", Counter({"ECON_STOCKMARKET": 3})).score == 0
    )
    assert classify("Factory owner arrested over tax fraud").score == 0
    storm = classify("Cyclone forces ports to close along the coast", Counter({"NATURAL_DISASTER": 2}))
    assert storm.event_type == "extreme-weather" and storm.impact == "risk"


def test_text_helpers():
    assert clean_title("Rupee hits record low against dollar - Reuters", "reuters.com") == (
        "Rupee hits record low against dollar"
    )
    assert clean_title("Short - title") == "Short - title"  # never strip down to nothing
    long = "First sentence here. Second sentence that must go. " + "x " * 400
    assert first_sentence(long) == "First sentence here."
    assert len(first_sentence("word " * 200) or "") <= 300
    assert first_sentence("See https://example.com/a for more") == "See for more"
    assert limit_words("one two three four", 2) == "one two…"
    sid = story_id("Oil prices jump as OPEC extends output cuts today", "https://x.test/1")
    assert re.fullmatch(r"story:[a-z0-9][a-z0-9.-]*", sid) and sid.startswith("story:oil-prices-jump")
    assert story_id("Oil prices", "a") != story_id("Oil prices", "b")

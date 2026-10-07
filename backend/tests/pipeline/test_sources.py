"""Source parsers on small hand-made inputs (no network)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from worldgraph.pipeline.places import load_places
from worldgraph.pipeline.sources import gdelt, hazards, rss

NOW = datetime(2026, 10, 7, 12, 0, tzinfo=UTC)


def gkg_row(url: str, title: str, themes: str, locations: str, source: str = "example.com") -> str:
    cols = [""] * 27
    cols[0] = "20261007120000-1"
    cols[gdelt.C_DATE] = "20261007120000"
    cols[gdelt.C_COLLECTION] = "1"
    cols[gdelt.C_SOURCE] = source
    cols[gdelt.C_URL] = url
    cols[gdelt.C_THEMES] = themes
    cols[gdelt.C_LOCATIONS] = locations
    cols[gdelt.C_ORGS] = "Opec,10;Saudi Aramco,40"
    cols[gdelt.C_TONE] = "-2.5,1,3.5,4,20,1,300"
    cols[gdelt.C_EXTRAS] = f"<PAGE_TITLE>{title}</PAGE_TITLE>"
    return "\t".join(cols)


def test_gdelt_rows():
    places = load_places()
    rows = [
        gkg_row(
            "https://news.example.com/oil",
            "Oil prices jump as Saudi Arabia extends output cuts | Example News",
            "ENV_OIL,10;ENV_OIL,50;ECON_OILPRICE,20",
            "1#Saudi Arabia#SA#SA##25#45#SA#30;4#Riyadh, Ar Riyad, Saudi Arabia#SA#SA10##24.64#46.77#-3#80",
        ),
        gkg_row("https://news.example.com/oil", "Duplicate URL is ignored entirely", "ENV_OIL,1", ""),
        gkg_row("https://news.example.com/sport", "Cricket: India win the series", "ECON_STOCKMARKET,1", ""),
        gkg_row(
            "http://www.syndicated.example/news/279357348/rupee-falls",
            "Rupee falls to record low as oil prices climb",
            "ECON_CURRENCY_EXCHANGE_RATE,5;ECON_OILPRICE,9",
            "1#India#IN#IN##20#77#IN#5",
        ),
    ]
    items = gdelt.parse_rows(rows, places)
    assert [i.url for i in items] == [
        "https://news.example.com/oil",
        "http://www.syndicated.example/news/279357348/rupee-falls",
    ]
    oil = items[0]
    assert oil.title == "Oil prices jump as Saudi Arabia extends output cuts"
    assert oil.place and oil.place.country_id == "region:sa" and oil.place.precision == "city"
    assert oil.orgs == ["Opec", "Saudi Aramco"] and oil.tone == -2.5
    assert items[1].source_name == "bignewsnetwork.com"  # one syndication network counts once


def test_gdelt_catch_up_window():
    assert gdelt.timestamps_to_fetch(None, "20261007121500") == ["20261007121500"]
    assert gdelt.timestamps_to_fetch("20261007120000", "20261007121500") == ["20261007121500"]
    assert gdelt.timestamps_to_fetch("20261007121500", "20261007121500") == []
    # Far behind: only the newest few files, oldest first.
    assert gdelt.timestamps_to_fetch("20261001000000", "20261007121500", max_files=2) == [
        "20261007120000",
        "20261007121500",
    ]


def rfc822(t: datetime) -> str:
    return t.strftime("%a, %d %b %Y %H:%M:%S GMT")


FEED = f"""<?xml version="1.0"?>
<rss version="2.0"><channel><title>Example</title>
<item><title>RBI raises repo rate by 25 basis points to curb inflation</title>
<link>https://example.org/rbi</link>
<pubDate>{rfc822(NOW - timedelta(hours=2))}</pubDate>
<description>&lt;p&gt;The central bank lifted rates. It also raised its inflation forecast.&lt;/p&gt;
</description></item>
<item><title>Tender notice for printing of annual report pages</title>
<link>https://example.org/tender</link>
<pubDate>{rfc822(NOW - timedelta(hours=2))}</pubDate></item>
<item><title>Old news about steel exports from last week</title>
<link>https://example.org/old</link>
<pubDate>{rfc822(NOW - timedelta(days=5))}</pubDate></item>
</channel></rss>""".encode()


def test_feed_items():
    places = load_places()
    feed = rss.Feed(
        "test", "Example Bank", "https://example.org/rss", "region:in", ("finance",), official=True
    )
    items = rss.parse_feed(feed, FEED, places, now=NOW)
    assert [i.url for i in items] == ["https://example.org/rbi"]  # routine notice and old item dropped
    item = items[0]
    assert item.snippet == "The central bank lifted rates."
    assert item.place and item.place.country_id == "region:in"
    assert "finance" in item.cls.sectors
    seen = {rss.url_key("https://example.org/rbi")}
    assert rss.parse_feed(feed, FEED, places, now=NOW, seen=seen) == []


def test_usgs_thresholds():
    def quake(mag, place, lon, lat, alert=None, hours=1):
        return {
            "id": f"us{mag}",
            "properties": {
                "mag": mag,
                "place": place,
                "alert": alert,
                "sig": 500,
                "tsunami": 0,
                "time": int((NOW - timedelta(hours=hours)).timestamp() * 1000),
                "url": f"https://earthquake.usgs.gov/earthquakes/eventpage/us{mag}",
            },
            "geometry": {"coordinates": [lon, lat, 10]},
        }

    data = {
        "features": [
            quake(6.4, "20 km E of Hualien City, Taiwan", 121.8, 23.9),
            quake(4.9, "Small quake near Tokyo, Japan", 139.7, 35.7),
            quake(5.6, "Off the coast", 139.7, 35.7, alert="yellow"),
            quake(6.1, "South Pacific Ocean", -150.0, -40.0),  # far from anyone
            quake(7.0, "Old event, Chile", -71.0, -30.0, hours=100),
        ]
    }
    items = hazards.parse_usgs(data, load_places(), now=NOW)
    assert [(i.place.country_id, i.magnitude) for i in items] == [("region:tw", 2), ("region:jp", 3)]
    assert items[0].hazard and items[0].title.startswith("M6.4 earthquake")


GDACS = b"""<?xml version="1.0"?>
<rss xmlns:gdacs="http://www.gdacs.org" xmlns:geo="http://www.w3.org/2003/01/geo/wgs84_pos#"><channel>
<item><title>Orange alert</title>
<description>The cyclone affects these countries: Philippines.</description>
<link>https://www.gdacs.org/report.aspx?eventtype=TC&amp;eventid=1</link>
<pubDate>Wed, 07 Oct 2026 09:00:00 GMT</pubDate>
<gdacs:iscurrent>true</gdacs:iscurrent>
<gdacs:eventtype>TC</gdacs:eventtype><gdacs:alertlevel>Orange</gdacs:alertlevel>
<gdacs:eventname>RAGASA</gdacs:eventname><gdacs:country>Philippines</gdacs:country>
<geo:Point><geo:lat>14.6</geo:lat><geo:long>121.0</geo:long></geo:Point></item>
<item><title>Green alert</title><description>Minor flood.</description>
<link>https://www.gdacs.org/report.aspx?eventtype=FL&amp;eventid=2</link>
<pubDate>Wed, 07 Oct 2026 09:00:00 GMT</pubDate>
<gdacs:iscurrent>true</gdacs:iscurrent>
<gdacs:eventtype>FL</gdacs:eventtype><gdacs:alertlevel>Green</gdacs:alertlevel>
<geo:Point><geo:lat>14.6</geo:lat><geo:long>121.0</geo:long></geo:Point></item>
</channel></rss>"""


def test_gdacs_orange_and_red_only():
    items = hazards.parse_gdacs(GDACS, load_places(), now=NOW)
    assert len(items) == 1
    item = items[0]
    assert item.title == "Orange alert: tropical cyclone Ragasa in Philippines"
    assert (
        item.place.country_id == "region:ph"
        and item.magnitude == 3
        and item.cls.event_type == "extreme-weather"
    )

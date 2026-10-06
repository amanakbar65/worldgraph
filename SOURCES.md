# Data sources

Each source used by WorldGraph has a row here before it is integrated: what we use it for, its terms, rate limits, attribution and whether a key is needed. The app shows each source's attribution wherever its data appears.

**Status key**
- ✅ **Checked**: terms were read on the date shown, and the summary below reflects them.
- ⏳ **To verify before use**: noted from the brief or from memory. These must be read and confirmed before the integration is built.
- ⛔ **Excluded**: not to be used.

Last updated: 6 Oct 2026.

## In use now

| Source | Used for | Terms (summary) | Limits | Attribution | Key | Status |
| --- | --- | --- | --- | --- | --- | --- |
| [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/) | Country, state and city names, codes and positions (the gazetteer); later, map borders, including the India "point of view" edition | Public domain. Any use, including commercial, with no permission needed. | None (files downloaded from the project's GitHub repo) | Not required. We credit it in the app anyway. | No | ✅ 6 Oct 2026 |
| [Supabase](https://supabase.com/pricing) (hosting, not data) | Postgres database | Free plan: 500 MB database and 2 projects; pauses after 7 days without activity | See terms | n/a | Account (created) | ✅ 6 Oct 2026 |

## Planned

| Source | Used for | Terms (summary) | Limits | Attribution | Key | Status |
| --- | --- | --- | --- | --- | --- | --- |
| [OpenFreeMap](https://openfreemap.org) | Basemap tiles (Phase 1) | Free public instance with no registration or keys; commercial use allowed. Provided as-is and may change. | No view or request limits stated | "© OpenMapTiles, © OpenStreetMap contributors" | No | ✅ 6 Oct 2026 (summary of the site) |
| [GDELT 2.0](https://www.gdeltproject.org/about.html#termsofuse) | Live events and news signals: Events, Mentions and GKG files every 15 min (Phase 2) | Believed to be free for any use with citation | To check | Cite GDELT | No | ⏳ |
| Publisher RSS feeds (about 10, chosen with you) | Headlines and links (Phase 2) | Each feed's own terms. We store only the headline, URL, date and a one-sentence snippet. | Per feed | Publisher name plus a link | No | ⏳ per feed |
| PIB, RBI and SEBI press releases (India); Fed and ECB (central banks) | Official announcements (Phase 2) | Government sites; check reuse terms per site | Per site | Source name plus a link | No | ⏳ |
| [USGS earthquakes](https://earthquake.usgs.gov/earthquakes/feed/) | Hazards (Phase 2) | US government data, believed public domain | To check | "USGS" | No | ⏳ |
| [GDACS](https://www.gdacs.org) | Disaster alerts (Phase 2 or 3) | To check | To check | To check | No | ⏳ |
| [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov) | Active fires (Phase 3) | Open data; free MAP_KEY | Per-key limits | "NASA FIRMS" | **Yes (free)** | ⏳ |
| [Wikidata](https://www.wikidata.org) | Entity IDs and relationships (Phase 3) | Data is CC0 | API etiquette and rate limits | Not required; we credit it | No | ⏳ |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | Ports, plants and industrial zones (Phase 3) | ODbL: attribution plus share-alike for derived databases | Overpass API fair use | "© OpenStreetMap contributors" | No | ⏳ (share-alike needs care) |
| [geoBoundaries](https://www.geoboundaries.org) | Extra admin boundaries if Natural Earth isn't enough | Per-country licences (mostly CC BY 4.0) | n/a | Per dataset | No | ⏳ |
| [World Bank](https://datacatalog.worldbank.org/public-licenses) indicators and Pink Sheet | Economy KPIs and commodity prices (Phase 3) | CC BY 4.0 (most datasets) | To check | "World Bank" | No | ⏳ |
| [IMF data](https://www.imf.org/en/About/copyright-and-terms) | Economy KPIs (Phase 3) | To check | To check | "IMF" | No | ⏳ |
| [FRED](https://fred.stlouisfed.org/docs/api/terms_of_use.html) | US and global series (Phase 3) | Free API key; some series are third-party copyrighted | Per-key limits | "FRED, Federal Reserve Bank of St. Louis" | **Yes (free)** | ⏳ |
| [data.gov.in](https://data.gov.in) | Indian state-level KPIs (Phase 3) | Government Open Data Licence – India | Per-key limits | Per dataset | **Yes (free)** | ⏳ |
| [UN Comtrade](https://comtradeplus.un.org) | Trade flows by product and country (Phase 3) | Free tier with a subscription key | Daily call limits on the free tier | "UN Comtrade" | **Yes (free)** | ⏳ |

## Forecast providers

These follow the brief's prediction-market rules: information only, one provider interface, a feature flag per provider, real-money providers off by default, gated by the viewer's country and failing closed.

| Provider | Money? | Used for | Terms / notes | Key | Default | Status |
| --- | --- | --- | --- | --- | --- | --- |
| [Manifold](https://manifold.markets) | Play money only (real-money mode ended 28 Mar 2025) | Phase 2 live forecasts | Public read API; check display and commercial terms | No | **On** | ✅ play-money status (6 Oct 2026); ⏳ terms |
| [Polymarket](https://docs.polymarket.com/) | **Real money** | Adapter built in Phase 2 against sample responses from its docs | Blocked in India by MeitY order (21 May 2026). Never linked or shown where restricted; never accessed via VPN, proxy or mirror. Display and commercial terms to read before any use. | No | **Off** | ✅ India block (6 Oct 2026); ⏳ terms |
| [Metaculus](https://www.metaculus.com) | No money | Possible extra provider | Every API call needs a token from a free account; check terms for commercial display | **Yes (free account)** | Off | ✅ token requirement (6 Oct 2026); ⏳ terms |
| Kalshi | **Real money** | Not planned | Reported in 2026 to be next in line for an Indian block | n/a | Off | n/a |

## Excluded

| Source | Why |
| --- | --- |
| ACLED | ⛔ Commercial use needs a paid licence, and use with AI systems is restricted ([EULA](https://acleddata.com/eula)). Revisit only if licensed. |
| World Monitor (code) | ⛔ AGPL licence. We may study its ideas but must not copy its code. |

## Rules that apply to every source

- Never store or show full article text. Keep only the headline, URL, source, date, extracted facts and at most a one-sentence snippet, and always link to the original.
- No profiles of private individuals. Person nodes are limited to public figures and officials.
- Sample data (Phases 0–1) is invented. It's flagged `is_sample` in the database, labelled "Sample data" in the app, and its evidence never links anywhere.

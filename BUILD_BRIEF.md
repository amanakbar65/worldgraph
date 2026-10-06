# WorldGraph — Build Brief for Claude Code

## What we're building

Build WorldGraph (working name): a visual, real-time world-knowledge app that shows entrepreneurs and businesses what is changing, why, what is likely to happen next, and what it means for them.

- Home is a 3D globe. Users zoom into any country, state or city to see what is happening there.
- Every event is linked into a knowledge graph of places, companies, commodities, sectors, policies and infrastructure.
- Cascades show how one event leads to others, step by step, with evidence for every link.
- Crowd forecasts (prediction-market odds such as Polymarket's) show what people expect to happen next, next to what has already happened.
- Every insight ends in a business answer: what happened, why it matters to you, what you could do.
- It feels visual, calm and fast: little text, no clutter, useful at a glance.

This brief is the source of truth for the project. Read all of it before planning. If anything here is wrong or outdated, tell me and propose a fix.

## Who it's for

The primary users are founders, SME owners, traders, importers and exporters, investors and consultants. They need to see what is changing in their markets, supply chains and regions, and act before competitors do. Curious general users are welcome, but every design decision favours the business user.

Jobs the app must do well:

1. "Show me what's changing that affects my business: risks and opportunities."
2. "Explain why this happened and what it will likely cause next."
3. "Tell me how likely the big upcoming decisions are (rate moves, elections, tariffs, trade deals) and what each outcome would mean for me."
4. "Find opportunities in a region or sector: new policies, demand shifts, supply gaps, tenders."
5. "Give me a two-minute visual brief every morning."
6. "Help me compare regions before I expand into them or source from them."

Geographic depth for the MVP: India at state and major-city level, the rest of the world at country level. Design the data model so other regions can be deepened later without rework.

## Product principles

These rules override any feature detail below.

1. **Visual first.** Show, don't tell. Carry meaning with colour, size, position, icons and motion. Text is the last resort.
2. **Three taps to depth.** Glance: an icon and a headline of 12 words or fewer. Tap: a card with a one-line "so what" and three chips. Tap again: the cascade, the graph and the sources. Never show a paragraph by default.
3. **Every insight answers three questions.** What happened. Why it matters to you. What you could do.
4. **Facts, inferences and forecasts stay visibly separate.** Facts come from sources. Cascades are inferences and show their type and confidence. Forecasts are crowd odds and show their source, volume and last update. Never present an inference or a forecast as a fact.
5. **Calm, not alarmist.** Neutral wording. Opportunities are shown as prominently as risks.
6. **Zero friction.** Works without sign-up; sign-up is only for saving a business profile, watchlists and alerts. Search is everywhere (Ctrl/Cmd+K). Keyboard shortcuts on desktop, thumb-friendly controls on mobile.
7. **Fast and smooth.** Load progressively. Globe and graph interactions stay smooth on a mid-range phone. Loading, empty and error states are designed, not left blank.
8. **Mobile and desktop are both first-class.** Bottom sheets on mobile, side panels on desktop.

## Screens and features

The globe, the cascade view and My Business carry the product; every other screen supports them.

### 1. Globe (home)

- Full-screen dark 3D globe. Events show as points or hex heat: colour = impact type, size = importance, a soft pulse = new in the last hour.
- Arcs between countries show cross-border cascades.
- Forecasts layer (toggle): upcoming decisions appear as rings whose fill shows the probability. Rings that moved sharply in the last 24 hours glow.
- Minimal controls: search, sector lens chips (Energy, Agri and Food, Manufacturing, Logistics and Trade, Finance, Tech, Health, Real Estate, Consumer) and a time slider (24 h, 7 d, 30 d) with replay.
- A small "Top 5 now" stack of cards, including the biggest odds moves: icon plus headline.
- Zooming past country level moves smoothly into a detailed 2D map.

### 2. Region view (country, state, city)

- Sub-regions shaded by activity and impact.
- Region panel: name; four KPI tiles with sparklines (for example inflation, fuel price, exchange rate, power demand, whatever data exists for that region); a "sector pulse" strip with one tile per sector, coloured risk, opportunity or neutral with an up or down arrow; top stories as icon cards; a mini local graph.
- "Upcoming decisions" strip: dated events for this region (elections, central-bank meetings, policy votes, trade deals), each with a probability gauge and its 24-hour change.
- Buttons: Cascades, Graph, Forecasts, Ask about this region, Compare.
- Compare: pick two or three regions and see their KPIs and sector pulse side by side.

### 3. Story card and cascade view

- Story card: headline (12 words max), one-line "so what" (20 words max), chips for sector, region, time horizon (now, weeks, months) and confidence.
- "What the crowd expects next": when a related forecast exists, the card shows it with its probability and 24-hour change.
- Cascade view: a left-to-right flow. Causes on the left, the story in the middle, first- and second-order effects on the right.
- Nodes are small cards. Each link carries a 2 to 4 word mechanism label, such as "raises input costs" or "cuts supply".
- Line style shows the link type: solid = reported, dashed = inferred, dotted = projected. Thickness or opacity shows confidence.
- Scenario branches: when the next step depends on an uncertain decision, the flow splits into "If YES (62%)" and "If NO (38%)" using the forecast's current odds. Each branch shows its own projected effects.
- Tapping a link shows its evidence: source name, date, a one-sentence snippet and a link to the original.

### 4. Knowledge graph (Obsidian-style)

- Global graph: force-directed. Nodes coloured by type (region, company, commodity, sector, policy, infrastructure, story, forecast) and sized by number of connections. Forecast nodes get their own shape.
- Hovering a node highlights its neighbours and dims everything else. Clicking opens its entity page.
- Filters: type, sector, region, time range, minimum confidence. Search jumps straight to a node.
- Local graph: the neighbourhood of the current entity, with a depth slider (1 to 3). Shown on entity pages and in panels.
- Time-lapse: replay how the graph grew over a chosen period, like Obsidian's graph animation.

### 5. Entity pages (like Obsidian notes)

- Every node has a page: title and type icon, one-line summary, key-fact chips, a mini timeline of related stories, "Linked from" (backlinks) and a local graph.
- "Forecasts" panel: related questions with probability, a sparkline of the probability history and the resolution date.
- "Impact on you" appears when the entity touches the user's business.
- Private notes: users can write notes on any page and use [[Entity Name]] links. Those links become edges in their personal graph.

### 6. My Business

- Two-minute onboarding with chips and search, no long forms: industry, locations, key inputs and commodities, supplier countries, customer markets, competitors, keywords.
- Each answer becomes a node in a private "My Business" graph, linked to world nodes (commodities, countries, ports, sectors).
- When a cascade reaches one of these nodes, it appears in an "Affects you" feed: risk or opportunity, time horizon, confidence, and up to three short suggested actions.
- Forecast watchlist: the app suggests forecasts linked to the user's nodes. Alerts fire when one crosses a threshold the user sets or moves 10+ points in a day.
- Visual: the user's business as a small graph in the centre, with live signals flowing in.

### 7. Opportunities

- Cards for opportunity signals by region and sector: new policies, incentives and subsidies, government tenders, demand spikes, supply gaps, price moves.
- Each card: what, where, why now, who it suits, confidence, sources, and the related forecast's odds when one exists.
- An "opportunity radar": signals plotted by momentum on one axis and relevance to the user on the other.

### 8. Forecasts view

- Upcoming decisions as a clean list of probability bars, filtered by sector and region and sorted by relevance to the user.
- Each row: the question in 12 words or fewer, probability, 24-hour change, volume, end date.
- Tapping opens the detail: probability history chart, volume and liquidity, resolution date and rule, linked entities, and the "If YES / If NO" cascade.
- A short, permanent note on this view: crowd forecasts are estimates and can be wrong.

### 9. Ask and daily brief

- Ask: one input box ("How does X affect Y?"). The answer is visual: a mini cascade, three short bullets, any relevant forecast odds and sources. It answers only from stored stories, forecasts and the graph, and says "not enough evidence" when that is true.
- Daily brief: six swipeable cards covering top risks, top opportunities, biggest movers, odds that moved, one cascade to watch and one region spotlight. In-app first; email later.

## Visual design system

One visual language runs across the globe, cards, graph and cascades, and meaning never depends on colour alone.

- **Theme:** dark by default, with a near-black space background behind the globe. Light theme supported.
- **Impact colours (colour-blind safe):** risk = amber/orange, opportunity = teal/blue, neutral = slate grey. Always pair the colour with an icon or arrow (▲ ▼). Never use red versus green.
- **Forecast style:** forecasts never look like facts. Give them their own hue (for example violet), a "crowd" icon and a distinct shape. Show probability as a ring or bar with a large percentage, and the 24-hour change in points (▲ 8). Fade low-liquidity markets and tag them "thin market".
- **Entity-type colours:** one fixed hue per node type, used identically on the globe, in the graph and on chips.
- **Type:** one font family (for example Inter), at most three text sizes per screen, numbers large and prominent.
- **Text limits:** headline 12 words, "so what" 20 words, each suggested action 8 words. Anything longer goes behind a "More" tap.
- **Icons:** one icon set (lucide) for sectors, entity types and event types.
- **Motion:** smooth camera flights and subtle pulses only. Respect the reduced-motion setting.
- **States:** skeleton loaders instead of spinners; friendly empty states that suggest a next tap.
- **Accessibility:** WCAG AA contrast, full keyboard navigation, screen-reader labels on every control.

## Data sources (free for the MVP)

Use only free sources for the MVP. Before integrating each one, verify its current terms, rate limits and attribution rules, record them in `SOURCES.md`, and show attributions in the app.

| Need | Sources |
| --- | --- |
| Live events and news signals | [GDELT 2.0](https://www.gdeltproject.org/) (Events, Mentions, GKG; updates every 15 minutes) and curated publisher RSS feeds |
| Official announcements (India) | PIB, RBI, SEBI and ministry press releases (RSS where available) |
| Hazards | USGS earthquakes, NASA FIRMS fires, GDACS disaster alerts |
| Entities and relationships | Wikidata (stable IDs; located in, owned by, subsidiary of, industry, products) |
| Borders and admin areas | Natural Earth, geoBoundaries |
| Infrastructure | OpenStreetMap (ports, power plants, industrial zones) |
| Economy and prices | World Bank indicators and commodity prices (Pink Sheet), IMF, FRED, data.gov.in |
| Trade flows | UN Comtrade (product by country flows) |
| Crowd forecasts | [Polymarket](https://docs.polymarket.com/) public market data, read-only (Gamma API for events and markets, CLOB API for prices and price history; no key needed). Evaluate Metaculus (forecasting, no money) and Manifold (play money) as extra or fallback providers. |

Rules:

- Do not use ACLED. Commercial use needs a paid licence and its use with AI systems is restricted ([ACLED EULA](https://acleddata.com/eula)). Revisit only if we license it.
- Never store or display full article text. Keep only headline, URL, source, date, extracted facts and at most a one-sentence evidence snippet. Always link out to the original.
- No profiles of private individuals. Person nodes are limited to public figures and officials.

### Prediction-market rules (legally sensitive, follow exactly)

India's Promotion and Regulation of Online Gaming Act, 2025 treats real-money prediction markets as banned online money games, and it also bans advertising that directly or indirectly promotes them. Polymarket was blocked in India in 2026, and Kalshi was expected to follow. I will get legal advice before any public launch. Until then:

- Show probabilities as information only. No trading, wallets, deposits, referral or affiliate links, and no "bet" or "trade" calls to action anywhere.
- Every forecast source sits behind one provider interface and its own feature flag. Real-money sources are off by default.
- Gate real-money sources by user region. Where they are restricted (including India), hide them or fall back to non-money sources.
- Never link out to a platform that is blocked for that user. Where linking is restricted, attribution is plain text.
- Never route around a block: no VPNs, proxies or mirrors. If a provider is unreachable from my machine, develop against sample responses built from its API docs.
- Read each provider's terms of use for display and commercial use before integrating, and record the result in `SOURCES.md`.
- Hide markets below a minimum volume and liquidity threshold. Show volume and last-updated time with every probability.
- Skip sports, entertainment and celebrity markets. Keep only economy, finance, policy, politics, geopolitics, trade, tech, commodities and energy.

## Knowledge graph model

Model everything as nodes and typed edges, with a stable ID on every node: its Wikidata QID when one exists, otherwise an internal ID.

**Node types**

- Region: country, state, district, city (with geometry)
- Organization: company, government body, association
- Person: public figures and officials only
- Commodity or product (with HS code where possible)
- Sector
- Infrastructure: port, plant, chokepoint, pipeline, industrial zone
- Policy or regulation
- Indicator: a time series attached to a region or commodity
- Story: a cluster of articles about one real-world event
- Forecast: a prediction-market or forecasting question, with outcomes, probability history, volume, liquidity, end date, resolution rule and source
- UserEntity: private nodes from a user's My Business profile or notes

**Edge types**

- Structural: located_in, part_of, owns, subsidiary_of, produces, exports_to and imports_from (with value and year), depends_on, member_of, competes_with
- Mention: story to entity
- Forecast: forecast about entity, forecast relates_to story
- Causal: story to story, carrying link_type, mechanism (2 to 4 words), direction (up or down), expected lag, confidence (0 to 1), evidence (source URL plus one-sentence snippet), method, model version and timestamp

**Causal link types**

| Type | Meaning | Line style |
| --- | --- | --- |
| Reported | A source explicitly says A caused B | Solid |
| Inferred | The model proposes a link between two existing stories | Dashed |
| Projected | A possible future impact, found by following dependency edges from an event (for example, a port disruption reaching the importers that rely on that port) | Dotted |
| Conditional | A projected impact that happens only if a forecast resolves a certain way (for example "if the tariff passes"). It carries the forecast ID, the outcome and that outcome's current probability | Dotted, labelled with the outcome and its odds |

## Data pipeline

Two jobs feed one database. The news pipeline runs every 15 minutes and turns raw signals into scored, linked stories. The forecast sync runs every 5 to 15 minutes. LLM calls happen only after clustering and a relevance gate, which keeps costs low.

**News pipeline**

1. **Ingest** new items from every source into raw tables. Make it idempotent and resumable.
2. **Cluster** articles into Stories using multilingual embeddings plus time and location windows.
3. **Gate** for business relevance: cheap rules first (keywords, categories, source weight), then a small LLM call. Only relevant stories continue.
4. **Extract** with an LLM into validated JSON (Pydantic): headline, one-line so-what, event type, locations, entities, sectors, impact (risk or opportunity, direction, magnitude 1 to 5, horizon) and confidence.
5. **Link** entities to Wikidata IDs (Wikidata search plus LLM disambiguation). Geocode with GDELT's location fields first, then a fallback geocoder within its rate limits.
6. **Infer cascades.** For each new story, find candidate related stories from the past 30 days (shared entities, regions, sectors) and ask the LLM whether a causal link is plausible. Write causal edges with evidence and confidence. Then follow dependency edges to add projected impacts.
7. **Score** importance (mention volume, source diversity, magnitude, novelty) and pre-aggregate by region, sector and time for fast map rendering.
8. **Match** new impacts to each user's My Business graph to produce "Affects you" items and alerts.

**Forecast sync**

1. **Pull** active questions from each enabled provider, filtered to the allowed categories above.
2. **Snapshot** probabilities, volume and liquidity into a time series. This step needs no LLM.
3. **Link** new questions only to graph entities and stories (provider tags plus one LLM matching call).
4. **Detect moves**, for example 10+ points in 24 hours above the liquidity threshold, and create "odds moved" signals.
5. **Feed** current odds into story cards, conditional cascade branches, the opportunity radar and forecast alerts.

**Cost control**

- Batch LLM requests and cache results. Never re-process an unchanged story or forecast.
- A configurable daily spend cap. Log tokens and cost per run.
- Keep model names in config. Use a small, fast model (for example Claude Haiku 4.5) for gating, extraction and forecast linking, and a stronger one (for example Claude Sonnet 5.5) for cascade reasoning and Ask.

## Tech stack

Python for the backend and data pipeline, Postgres for storage, Next.js for the frontend. Propose changes in your plan only if you have strong reasons.

Architecture at a glance: free data sources and forecast providers → Python jobs (news pipeline and forecast sync) → PostgreSQL knowledge graph → FastAPI → Next.js web app. Every screen reads from one database. The LLM is called only by the pipeline jobs and by Ask, which keeps costs predictable.

**Backend and pipeline**

- Python 3.12, FastAPI, Pydantic, httpx, polars or pandas
- A scheduler for the recurring jobs (APScheduler or a simple worker)
- sentence-transformers for free, local, multilingual embeddings
- H3 hexagons for spatial aggregation at each zoom level
- One `ForecastProvider` interface with a small adapter per source (Polymarket first), each with its own feature flag and allowed-regions setting

**Database**

- PostgreSQL with PostGIS (maps) and pgvector (similarity search). Store the graph as node and edge tables queried recursively.
- Add a graph database only if we outgrow this.
- Prefer a hosted Postgres with a free tier (for example Supabase) so I don't have to install Postgres on Windows. Ask me before creating any account.

**Frontend**

- Next.js (React, TypeScript), Tailwind CSS, shadcn/ui, lucide icons
- Globe and map: check current library support and recommend one of these in your plan:
    - A: MapLibre GL's globe projection with deck.gl layers, for one seamless zoom from globe to street level
    - B: react-globe.gl (globe.gl + Three.js) for the globe, handing off to deck.gl + MapLibre GL for detail
- Free basemap tiles that need no API key
- Graph view: react-force-graph (2D first, 3D toggle later). Switch to Sigma.js + graphology if performance needs it.
- Cascade view: React Flow with automatic left-to-right layout (elkjs or dagre)
- Charts, sparklines and probability gauges: one lightweight charting library

**Repo**

- Monorepo with `/backend` and `/frontend`, plus a root README with run steps, `.env.example`, `CLAUDE.md`, `PROGRESS.md` and `SOURCES.md`

**Reference, not code to copy:** [World Monitor](https://www.worldmonitor.app/) is an open-source dashboard in a similar space. Study its ideas, but don't copy its code: it is AGPL-licensed, which would force our code to be open-sourced too.

## Build phases

Build in six phases and stop after each one for my review. Phase 1 runs entirely on seed data, so I can judge the look and feel before any live data exists.

- **Phase 0: Plan and scaffold.** Ask me your questions, write `PLAN.md`, then set up the repo, Git, `CLAUDE.md` (project conventions) and `PROGRESS.md` (a running log). Create a realistic seed dataset across India and the world: about 200 stories with their entities and links, plus about 30 forecasts with probability histories.
- **Phase 1: Visual shell on seed data.** Globe with the forecasts layer, zoom, region panel with upcoming decisions, story card, cascade view with If YES / If NO branches, graph view, entity page and forecasts view. I should be able to click through the whole experience.
- **Phase 2: Live data v1.** The news pipeline (GDELT, about 10 RSS feeds and USGS, through clustering and gated LLM extraction, into the database and API) and the forecast sync. Build the Polymarket adapter behind its flag (off by default) and enable one non-money provider so live forecasts show either way. Switch the frontend to real data.
- **Phase 3: Knowledge graph and cascades.** Wikidata linking; structural edges (trade flows for top commodities, ports, company ownership); causal inference; projected and conditional impacts; forecast-to-entity linking; the full graph view and entity pages.
- **Phase 4: Business layer.** My Business onboarding, the "Affects you" feed, the forecast watchlist and alerts, Opportunities, Ask with citations, the daily brief and region compare. A single-user mode is fine until Phase 5 adds accounts.
- **Phase 5: Polish and launch prep.** Performance, mobile polish, accounts and login, region gating checked against the legal advice I get, export any view as an image, deployment options (ask me before anything paid) and basic analytics.

**Definition of done for every phase**

- Backend and frontend each start with one command.
- No console errors, and tests pass for parsers and core logic.
- `PROGRESS.md` is updated.
- You give me a 3 to 5 step "how to try it" guide.

## How to work with me

I'm a beginner: I'm learning Python and I use VS Code on Windows. Keep every step small, explained and runnable.

- Before writing code for a phase, show me the plan and wait for my OK.
- Explain briefly, in plain English, what you are doing and why. Explain any new tool before installing it.
- Give me exact PowerShell commands to run, and tell me what I should see.
- Work in small, working steps. Commit to Git after each one with a clear message.
- Never commit secrets. Use a `.env` file, give me `.env.example`, and tell me where to get each key.
- Ask me before anything that costs money (paid APIs, hosting, upgrades) and before big architecture changes. The LLM API is the main cost from Phase 2, so estimate it for me before switching it on.
- Keep `CLAUDE.md` short (well under 200 lines): project conventions plus pointers to `BUILD_BRIEF.md` (the spec) and `PROGRESS.md` (the log).
- Prefer simple, popular, well-documented libraries. Don't over-engineer.
- Keep `PROGRESS.md` current so a new session can pick up where the last one stopped.
- If something in this brief is wrong, outdated or unwise, say so and propose a better option instead of silently working around it.

## Out of scope for the MVP

These wait until the core product works:

- Native mobile apps (the web app must still work well in mobile browsers)
- Paid data feeds
- Social features, comments and public sharing
- Real-time websockets (polling every minute is fine)
- A multi-language interface (English first; ingestion is already multilingual)
- Any trading, betting, wallet or deposit feature, and any referral links to prediction markets

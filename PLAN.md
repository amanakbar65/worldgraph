# WorldGraph — Plan (v2)

**Status:** building the complete app (6 Oct 2026). `BUILD_BRIEF.md` is the original brief and is kept word for word. Where this plan differs from it, this plan wins.

## The owner's direction (6 Oct 2026)

- Claude builds the whole thing. The brief is a strong starting point, not a rulebook. Keep its core idea, screens and principles, and drop restrictions that don't help.
- Make it sleek, professional, simple, accurate and convenient to use.
- **One app, two ways to run it**, like Family Ledger:
  1. **Test link (now):** a private claude.ai Artifact. It reads live data through the owner's Supabase connector. The AI (headlines, "why it matters", actions, cascades, Ask) runs on the owner's own Claude account, **only while the app is open**. There is no API bill.
  2. **Website (later):** Netlify. It's fully built and documented, but **not deployed until the owner says so**. There, the AI runs on the Claude API with a **$2/day cap**.
- **Global app:** anyone, anywhere, sees the same information.
  - Every country drills down to states or provinces, then major cities.
  - Numbers follow the viewer's locale, and money stays in its own currency.
- **Live news every 15 minutes** from a GitHub Actions job. The repo is public, so the minutes are free.

## Architecture

```
Free sources (GDELT, RSS, USGS, GDACS) + Manifold forecasts
        │  every 15 min: GitHub Actions runs the Python pipeline (no AI)
        ▼
Supabase Postgres (PostGIS, pgvector, pg_trgm)
  tables: node / edge / story / causal_link / forecast / indicator …
  schema `api`: SQL functions that return ready-made JSON for every screen
        │
        ├── Test link: Artifact page → claude.use("mcp") → Supabase connector → select api.<fn>(…)
        │              AI: claude.use("sample") on the owner's account → api.save_analysis(…)
        └── Website:   Netlify Function /api/rpc → select api.<fn>(…)  (deployed later)
                       AI: Netlify Function /api/ask + pipeline job, Claude API, $2/day cap
```

- **The query layer lives in Postgres** (`api.*` functions returning JSON). Both ways of running the app call the same functions, so the logic exists once and is tested once with pytest against a real PostGIS database.
- **The frontend is a static single-page app** (Vite + React + TypeScript). The same build runs as an Artifact and on Netlify. A data adapter picks the transport (connector or HTTP), and an AI adapter picks the engine (`sample` or the API).
- **The pipeline is Python on GitHub Actions** (every 15 minutes), plus a production-only AI job with a spend cap.
- **Built-in sample data** (about 200 stories, about 30 forecasts) is clearly labelled. It makes the app complete before live data flows. Once live data exists, sample data is hidden by default and can be switched on in Settings.

## Changes from the brief, and why

| Brief | Now | Why |
| --- | --- | --- |
| Next.js frontend | Vite + React SPA | A static bundle runs both as an Artifact and on Netlify. No server rendering is needed. |
| FastAPI server | Postgres `api.*` functions + a thin Netlify function | No server to host; one query layer for both ways of running. Python stays for the pipeline and tooling. |
| India at state level, the world at country level | Every country to states/provinces and cities | The owner asked for a global app; Natural Earth and GDELT cover the whole world. |
| Beginner workflow, stopping after each phase | Claude builds end to end | The owner's direction. |
| Phases 0–5 with reviews | One complete build, then a test link | The owner's direction. |
| OpenFreeMap basemap | Our own vector layers (Natural Earth countries, states, cities, coastlines). OpenFreeMap streets are added on the website at high zoom. | Artifacts can't load map tiles from other sites, and our own layers give a calmer, consistent look. |
| Polymarket first | Manifold (play money) on everywhere; Polymarket adapter built, off by default, never shown in India | Legal: real-money markets are blocked or banned in some countries (India: MeitY block, 21 May 2026). |

Kept from the brief:
- the product principles (visual first, three taps to depth, three questions per insight, facts/inferences/forecasts kept apart, calm wording)
- every screen
- the knowledge-graph model, including the four causal link types
- the colour rules (amber risk, teal opportunity, slate neutral, violet forecasts; never red against green)
- no full article text
- no private individuals
- prediction markets as information only

India's official borders are shown to viewers in India, detected from the timezone or the site's geo header, with a switch in Settings.

## Screens (all built)

1. **Globe:**
   - event points and hex heat
   - pulses for items under an hour old
   - cross-border cascade arcs
   - forecast rings (fill = probability, glow = big 24-hour move)
   - sector lens chips
   - 24 h / 7 d / 30 d with replay
   - Top 5 now
   - smooth zoom into regions
2. **Region panel:**
   - breadcrumb
   - 4 KPI tiles with sparklines
   - sector pulse
   - top stories
   - upcoming decisions
   - mini local graph
   - actions: Cascades, Graph, Forecasts, Ask, Compare
3. **Story card and cascade view:**
   - links are solid (reported), dashed (inferred) or dotted (projected and conditional)
   - If YES / If NO branches
   - an evidence popover
4. **Knowledge graph:** global and local, with filters, hover focus, search-to-node and a time-lapse.
5. **Entity pages:**
   - facts
   - timeline
   - backlinks
   - forecasts
   - local graph
   - "impact on you"
   - private notes with [[links]]
6. **My Business:**
   - a two-minute chip onboarding
   - a private business graph
   - an "Affects you" feed
   - a forecast watchlist with alerts
7. **Opportunities:** cards plus a momentum × relevance radar.
8. **Forecasts view:** probability bars, detail with history, and If YES / If NO effects.
9. **Ask** (answers from stored data only, with citations) and a six-card **Daily brief**.

Also: Ctrl/Cmd+K search, a keyboard-friendly list view of everything on the globe, bottom sheets on mobile and side panels on desktop, dark and light themes, and reduced-motion support.

## Where user data lives

- **Test link:** the Artifact's private per-person store (`db` capability, `data/users/<id>/…`). It holds the business profile, watchlist, notes and last visit.
- **Website:**
  - Before sign-in, the browser stores this data.
  - With sign-in (Supabase Auth, email link), it moves to Supabase tables protected by row-level security.

## AI

- One set of prompts and output schemas in `prompts/`, used by both engines.
- **Analysis** turns a story cluster into:
  - a headline (≤12 words)
  - a so-what (≤20 words)
  - impact, direction, magnitude, horizon and confidence
  - sectors and entities
  - up to 3 actions (≤8 words each)
- **Cascades:** for a new story, candidate stories from the last 30 days that share entities, regions or sectors are proposed. The model judges plausibility and wording; links are stored with type, mechanism, confidence and evidence.
- **Ask:** retrieval from stored stories, forecasts and the graph, then an answer of 3 bullets plus a mini cascade with citations. It says "Not enough evidence" when that's true.
- **Test link:** analysis runs when the app opens, on the newest important stories (in batches, with a visible "Analysing 12 new stories…" status), and results are saved.
- **Website:** a pipeline job does the same with the Claude API (Claude Opus 5.5 at low effort; the model is a setting, `WG_AI_MODEL`). Every call is logged with its cost; analysis stops at 75% of the daily cap (US$2), leaving the rest for Ask. Stories the AI judges not to be business news are marked "skipped" and hidden.

## Data sources

See `SOURCES.md`. Each source's terms are checked before it's integrated and its attribution is shown in the app.

## Build order

1. Foundation:
   - this plan
   - the switch to Vite
   - the `api.*` contract and SQL functions
   - the sample dataset
   - map assets (Natural Earth TopoJSON with India's view)
2. Screens: globe and regions, stories and cascades, graph and entities, forecasts.
3. Business layer: My Business, Affects you, watchlist, Opportunities, Ask, Brief, Compare.
4. Live pipeline: GDELT, RSS, USGS, GDACS, Manifold; Polymarket adapter (off); GitHub Actions every 15 minutes; production AI job with the cap.
5. Website mode: Netlify functions, `netlify.toml` and a deploy guide (not deployed).
6. Quality: Playwright end-to-end tests, adversarial reviews, accessibility and performance passes. Then publish the test link.

## What the owner needs to do

- **Make the GitHub repo public:** worldgraph → Settings → General → Danger Zone → Change visibility.
- **When the pipeline is ready, add one secret** (`DATABASE_URL`) to GitHub. Claude will give exact steps.
- **Open the test link** and allow it to use the Supabase connector and Claude when asked.

## Owner decision: sample data (22 Oct 2026)
- **Now (testing):** the app runs on live news by default. The Settings → Sample data switch stays, off by default (change the default from `auto` to `off`), so a demo can turn it on.
- **At the commercial launch:** remove sample data and everything that exists only for it: the seed loader and sample clock (pg_cron `wg-sample-clock`), the sample snapshot mode, the Settings switch, the sample labels and the `is_sample` filters. The app then runs on live data only. Tests keep their own fixtures.

## Roadmap to a complete product (owner decisions, 22–23 Oct 2026)

Sources: `docs/KNOWLEDGE_GRAPH_UPGRADE.md` (the spec, word for word), `docs/knowledge-graph-inventory.md` (what exists today) and `docs/COMMERCIAL.md` (services, data sources, storage, AI clock, costs, plans).

**Owner decisions:**
1. The personal graph lives in per-viewer storage.
2. Keep 90 days of history now, with permanent storage at launch (tiered: Postgres plus an R2 archive).
3. Everything goes to the test link first. The public launch happens only when the owner says the app is complete.
4. Add the influence graph on top of Phase C.
5. The app is AI-native: a scheduled AI "clock" keeps extracting, checking and summarising knowledge.
6. Cause and effect gets the most attention.
7. The audience is learners, analysts, business people and investors, as a one-stop place to learn and extract information.
8. Use free data enrichment now; paid sources are costed for launch.
9. Build "How X connects to Y" as a process, change tracking, trust at a glance, learning trails and starter tours.
10. Replace the hexagon heat map with something sleek.
11. New sections are welcome.
12. Nothing half done: each phase is complete, simple and connected before the next starts.

**Status:** Phase A approved and under way. A0–A2 (database, pipeline and API) are built; their screens, A3–A5 and the rest follow. Each phase ends with the build, tests, steps to try it, an update to this plan and a stop for the owner's review.

**Rules for every phase:**
- Migrations are additive and come with a down file; a test runs up, then down, then up.
- Every feature sits behind a flag.
- Personal data stays in the per-viewer store. The world graph changes only through the pipeline.
- No new paid service without the owner's yes.
- AI goes through the reserve-then-settle budget and prompt cache.
- Colour is never used alone.
- Data logic is tested.
- Website deploys happen only on purpose (`[deploy]`).

**Order:**

| # | Phase | What it delivers | Rough size |
|---|---|---|---|
| 1 | **A. Structure and trust** | Typed properties, named relations, sources on everything, history and "as of", schema map, trust at a glance, new heat map | 35–45 L |
| 2 | **K. Knowledge engine** | AI clock (needs a Claude API key), free data enrichment (Wikidata, GLEIF, BACI, WDI, EDGAR, PortWatch, ports, UCDP, sanctions, EIA, USDA), tiered permanent storage | 40–55 L |
| 3 | **C. Cause and effect** | Influence graph, "How X connects to Y" as a process, cascade upgrades, loops, what-if, guided stories | 35–45 L |
| 4 | **B. Lenses** | Focus mode, table, timeline, globe link, canvas, saved lenses, semantic zoom with a GPU renderer | 50–65 L |
| 5 | **T. Track and learn** | Change tracking, alerts and digests, learning trails, starter tours, Learn hub, audience modes | 30–40 L |
| 6 | **D. AI helpers** | Add from documents, Ask the graph with highlights, insights, suggested links, summaries and mind maps | 35–45 L |
| 7 | **S. New sections** | Markets, Countries, Supply chains, Risk radar, Investor lens, Calendar | 40–55 L |
| 8 | **E. Convenience** | Command palette commands, time slider, quick capture, import and export, performance, accessibility (also kept up throughout) | 25–35 L |
| 9 | **L. Launch kit** | Accounts, plans and payments, email, analytics, monitoring, legal pages, domain, Supabase Pro and archive, paid feeds, public website | 30–40 L |

These sizes are rough token estimates for the build agents.

### Phase K: knowledge engine (outline; needs the owner's Claude API key)
- **K1. AI clock:** the scheduled jobs in `docs/COMMERCIAL.md` §4:
  - sort every story with Haiku;
  - Sonnet batch analysis of the most important stories;
  - nightly upkeep of entities and links, with citations;
  - weekly re-checks;
  - daily and weekly digests.

  Every output carries provenance (A3) and stays within the daily cap. The clock pauses itself at the cap, and its health shows in Settings.
- **K2. Data enrichment (free sources):** Wikidata and GLEIF ownership; BACI trade flows; WDI and Pink Sheet; EDGAR subsidiaries and revenue by region; PortWatch chokepoint flows and the World Port Index; UCDP; official sanctions lists; EIA and USDA. Each source:
  - gets a SOURCES.md row first;
  - fills typed properties and named relations (A1, A2);
  - carries its own source and confidence.
- **K3. Permanent storage:** hot, knowledge and archive tiers (`docs/COMMERCIAL.md` §3). Older raw rows go to Parquet on R2 when the owner turns it on, with the 90-day hot window. Aggregates (influence graph, indicators) are kept for ever.
- **Done when:** the graph has thousands of real companies, ownership links and trade flows, more than half of the important stories have cause-and-effect analysis, and the AI spend report stays under the cap.

### Phase C: cause and effect (outline; the main focus)
- **C0. Influence graph:**
  - Roll story-level cause and effect up to lasting links between things, for example crude oil → shipping costs ▲, seen 37 times in 90 days, last seen 2 days ago, with a strength trend.
  - New stories strengthen or weaken these links over time. The totals survive when stories are pruned.
- **C1. "How X connects to Y":** pick any two things to see the strongest chains between them. They play as a step-by-step process (each step: mechanism, evidence, time lag, confidence), and can be saved as a trail.
- **C2. Cascade upgrades:**
  - Live cascades fed by the AI clock.
  - "What's new in this cascade since your last visit".
  - Influence links behind each story.
  - Polarity and delay shown.
  - The minimum-confidence filter.
- **C3. Feedback loops:** detected on the influence graph, as chips (reinforcing or balancing). Tapping a chip highlights the loop.
- **C4. What-if:** shocks spread with sign and strength, fading at each step, up to 4 steps. Labelled "Scenario, not a forecast", and feeds "Affects you".
- **C5. Guided stories:** step-by-step focus views with a one-line caption each, shared as read-only links.

### Phase B: lenses (outline)
- **B1. Focus mode:** tap to re-centre, back and forward, relation and direction filters, pinning, under 300 ms.
- **B2. Semantic zoom:** networkx Louvain clusters at 2–3 levels (BSD licence), a sigma.js GPU renderer (MIT) with layout in a web worker, and cached cluster labels.
- **B3. Table lens:** TanStack Table plus Virtual, with filters shared with the graph.
- **B4. Canvas boards:** React Flow; cards are live references; drawing a line creates a personal link.
- **B5. Timeline lens**, linked to all lenses.
- **B6. Globe link:** "Show on globe", and a globe region filters the graph.
- **B7. Saved lenses:** a sidebar; read-only share links carry the lens in the URL.

### Phase T: track and learn (outline)
- **T1. Change tracking:**
  - "What changed" in the graph: new, stronger, weaker and broken links. Shown as a daily strip and a weekly digest.
  - Alerts on watched items, delivered by email at launch.
  - An "as of" comparison of two dates.
- **T2. Learning trails:** focus mode keeps a breadcrumb trail; save it, add a note to each step, share it read-only, and turn it into a guided story.
- **T3. Starter tours:** about 8 curated tours, for example "How a Brazilian drought reaches your coffee", "Why the Red Sea matters to Europe", "Oil → inflation → interest rates".
- **T4. Learn hub:**
  - Plain-language explainers for each relation type, loop and indicator.
  - A glossary.
  - "Explain like I'm new" on any panel (AI, cached).
- **T5. Audience modes:** Learner, Analyst, Business and Investor. Each changes defaults (explanations, depth, panels and starting screens), with the same data underneath.

### Phase D: AI helpers (outline)
- **D1.** Add from documents, through a per-viewer review queue.
- **D2.** Ask the graph: answers cite nodes, links and sources, and highlight them in the current lens.
- **D3.** Insights: gaps, contradictions, stale items, weakly linked clusters.
- **D4.** Suggested links, hidden unless "Suggestions" is on.
- **D5.** Summaries and mind maps, cached by a hash of the content.

### Phase S: new sections (outline; free data first, licensed prices at launch)
- **S1. Markets:**
  - Commodity, currency and index tiles linked to graph nodes. "Why it moved" pulls in the cascade stories.
  - Free monthly Pink Sheet data now; licensed live prices at launch.
- **S2. Countries:** a profile per country: macro dashboard (WDI and IMF), trade partners (BACI), exposure, risks, forecasts and what changed.
- **S3. Supply chains:** chokepoints, ports and trade flows by product, with a "who depends on this?" ranking and a globe heat view.
- **S4. Risk radar:** conflict (UCDP), sanctions, disasters (GDACS, USGS) and policy changes, mapped to exposure.
- **S5. Investor lens:** company exposure (EDGAR revenue by region, subsidiaries, sector links), with what-if on holdings. Information only, never advice.
- **S6. Calendar:** scheduled policy and economic events (central bank meetings, releases) linked to forecasts and cascades.

### Phase E: convenience (outline; kept up throughout)
- **E1.** Command palette: properties and commands.
- **E2.** Time slider using A4.
- **E3.** Quick capture (voice through the browser's speech recognition).
- **E4.** Obsidian import; export to Markdown, CSV, JSON and GraphML.
- **E5.** Performance: 10k visible nodes.
- **E6.** A list or table version of every lens, plus keyboard moves between nodes.
- **E7.** Flag a problem.

### Phase L: launch kit (outline; built and switched off until the owner launches)
- **Accounts:** Supabase Auth with email links. Personal data moves from per-viewer storage into tables protected by row-level security, with export and delete.
- **Plans and payments:** Paddle, with Free, Pro, Team and Learner plans, usage metering and limits, and a billing page.
- **Services:** Resend email (sign-in, alerts, digests), PostHog, Sentry, Better Stack heartbeat and status page.
- **Legal:** Termly privacy policy, terms and cookies.
- **Domain:** worldgraph.com on Cloudflare.
- **Storage and feeds:** Supabase Pro, the R2 archive, Twelve Data and NewsAPI.ai adapters.
- **Settings:** a launch checklist in `docs/LAUNCH.md`, and every switch in one admin-only Settings page.

### Phase A: structure and trust (full detail)

**A0. Groundwork**
- **Status (28 Oct): done** (migration 0021, `backend/src/worldgraph/schema/`, `frontend/src/lib/flags.ts`). All five flags are on (the website isn't launched). `wg db down 0021` undoes 0021 and 0022 with their down files in `db/migrations/down/`. To try: `uv run wg schema sql` prints the registry upserts; `uv run wg seed check` validates the sample properties; `select api.meta('{}') -> 'flags'`.
- **Feature flags:**
  - New table `app_flag(key, enabled, note, updated_at)`. `api.meta` returns `flags`; the client reads them with `useFlag(key)`. SQL functions that serve flagged data check `api._flag(key)`.
  - Phase A flags: `kg.properties`, `kg.relations`, `kg.provenance`, `kg.history`, `kg.schema_map`.
  - Defaults: on for the test link; on the website, on only after the owner approves the phase (see question 3).
- **Reversible migrations:**
  - Phase A adds 0021–0025, each with a down file.
  - New pytest `test_migrations_reversible` (up → down → up, with the seed loading after each step).
- **Single source for the schema:** `backend/src/worldgraph/schema/types.yaml` defines node types, their properties and relation types. `wg schema sql` writes the registry inserts into the migration, `wg seed check` validates sample data against the YAML, and a test checks that the YAML matches the database.

**A1. Node types with properties (migration 0021)**
- **Status (28 Oct): database and API done; screens next.** `node_type` holds the 11 types; `node.properties` is checked by a trigger (wrong kinds, unknown choices, broken entity references, missing required values). Backfill: no live node has `props.facts`, so values come from what the graph already states (organisation sector and headquarters, commodity HS code, infrastructure kind, place and operator, policy scope, indicator unit, frequency and source); the curated YAML adds headquarters cities, a crude-oil benchmark and policy issuers, all from the existing summaries. `docs/kg-review.md` (`wg kg review`) lists what is left. API: `api.entity` → `properties`; `api.graph` / `api.local_graph` → `where` (one type; `local_graph` also takes `types`); new `api.schema()`. To try: `select api.entity('{"id":"infra:jebel-ali-port"}') -> 'properties'`; `select api.graph('{"types":["organization"],"where":[{"prop":"sector","op":"eq","value":"sector:energy"}],"sample":true}')`.
- **Type table:** `node_type(key, label, plural, icon, tone, properties jsonb, description)`.
  - `properties` is a list of `{key, label, kind: text|number|date|choice|url|place|entity, required, choices?, unit?, entity_types?}`.
  - It is seeded with the 11 existing types. Their labels, icons and tones move out of the TypeScript maps, which stay only as an offline fallback.
  - `node.type` gets a foreign key to `node_type` (replacing the CHECK constraint, which the down file restores).
- **Starting properties (all optional for now, so existing rows stay valid):**
  - Organisation: sector, headquarters (place), size (choice), founded (date), website (url), ticker.
  - Commodity: unit, benchmark, HS code.
  - Policy: issuer (entity), effective date, status (proposed / in force / expired), scope (place).
  - Infrastructure: kind (port, canal, strait, pipeline, plant, mine…), capacity plus unit, operator (entity), place.
  - Indicator: unit, frequency, source.
  - Person (public figures only): role, organisation (entity).
  - Region, sector, story and forecast keep their existing side tables. Those values appear as read-only derived properties, not copies.
- **Node columns and backfill:**
  - New `node.properties jsonb` (the spec's `properties`); `aliases` already exists.
  - It is backfilled from `props.facts` wherever a fact label matches a property. Unmatched facts stay as notes and go on a review list (`docs/kg-review.md`).
- **Validation:**
  - `api._property_problems(type, properties)` returns a list of problems. A trigger rejects wrong kinds, unknown choices, broken entity references and missing required fields.
  - Unknown keys are allowed but listed in the review list (strict mode can come later).
- **API:**
  - `api.entity` returns `properties: [{key, label, kind, value, display}]`.
  - `api.graph` and `api.local_graph` accept `where: [{prop, op, value}]` when one type is selected.
  - New `api.schema()` returns both registries with counts.
- **UI:**
  - The entity page shows properties as key-fact chips: icon plus value. Entity values are tappable chips; places open the map.
  - The graph filters gain a "Properties" section when exactly one type is selected (chips for choices, ranges for numbers and dates).
- **Done when:** properties validate against their type in the database, appear on entity pages and filter the graph. Tests cover each property kind, required fields and bad values.

**A2. Named relations (migration 0022)**
- **Status (28 Oct): database and API done; screens next.** `relation_type` holds the 14 edge types plus supplies, operates, regulates and the causal `drives`; a trigger checks the endpoint types of new links (the pipeline writes only allowed ones). Five curated links became `operates` (DP World, Adani Ports, BHP and the two canal authorities "run" their assets). Causal links carry `relation`, `polarity` (backfilled; a trigger sets it for every new link, so `api.save_analysis` and the pipeline need no change, and fills it in when AI analysis gives a draft cause its direction), `strength` and `delayed`. API: `api.entity` → `connections` (grouped, read from the entity's side; `backlinks` is deprecated and goes next release); graph links and cascade links carry `relation`, `polarity`, `strength`, `delayed`; graph functions take `relations` and `direction`. To try: `select api.entity('{"id":"org:dp-world"}') -> 'connections'`; `select api.local_graph('{"id":"infra:jebel-ali-port","depth":1,"direction":"in","relations":["operates"]}')`.
- **Relation table:** `relation_type(key, label, inverse_label, causal, symmetric, src_types[], dst_types[], description)`.
  - Seeded with the 14 existing edge types, with readable pairs: owns / owned by, part of / includes, depends on / needed by, member of / has member, competes with (symmetric), related to (symmetric)…
  - Plus new types: supplies / supplied by, operates / operated by, regulates / regulated by.
  - Plus the causal family: `drives`, with polarity.
- **Edges:** `edge.type` gets a foreign key to `relation_type`; the API calls it `relation`. A trigger checks the allowed source and target types. Existing rows that break the rules go on the review list instead of failing.
- **Causal links:** `causal_link` gains the following, and the mechanism text stays as the display label:
  - `relation` (default `drives`);
  - `polarity` (+1 / −1, backfilled from the cause story's direction compared with the link's direction; left empty when unknown);
  - `strength` (0–1; empty means "use confidence");
  - `delayed`, worked out from `lag_days > 0`.
- **Mapping:**
  - Existing edge types map one to one, so no free-text labels need guessing.
  - The `relates_to` edges (26 in the sample data) and any rule breaks go on the owner's review list.
- **API:**
  - `api.entity` returns `connections` grouped by relation. Each group reads naturally from this side: "Owned by", "Supplies"…, with a direction (out or in) and counts.
  - Graph links carry `relation`, `polarity` and `strength`. Graph functions accept `relations[]` and `direction`.
- **UI:**
  - Entity pages group links by relation, replacing "Linked from".
  - The graph gets a Relations filter (chips with icons).
  - Link cards name the relation. Causal links show ▲ or ▼ for polarity, paired with the existing line styles.
- **Done when:** every edge and causal link has a relation type, entity pages group by relation, and links can be filtered by relation. Tests cover the endpoint rules and the polarity backfill.

**A3. Sources on everything (migration 0023)**
- **Evidence:** `evidence` gains nullable `edge_id` and `node_id`. Exactly one target is required. This reuses the table rather than adding a new one.
- **Provenance columns:** `node` and `edge` gain `source_id` (references `source`), `confidence`, `kind` (reported / inferred / projected / conditional / user / ai_suggested), `created_by` and `updated_at`. `causal_link` gains `created_by` and `updated_at`.
- **Backfill:**
  - Gazetteer regions and their part_of links: Natural Earth.
  - Curated entities: a new source "WorldGraph curated".
  - Mentions and about links: the story's own articles.
  - AI links: `created_by = ai:<model>`.
  - Sample data: the sample source.
- **Rule:** after the backfill `source_id` is NOT NULL, and every new row needs a source and a creator, so the database itself enforces "can't be saved without it".
- **API:** new `api.provenance({target: node|edge|link, id})` returns:
  - sources (name, url, snippet, date);
  - confidence and link kind;
  - "added by" in plain words, for example "News pipeline · AI analysis · 22 Oct";
  - created and updated times.
- **UI:**
  - A "Why is this here?" sheet, built from the existing evidence parts. It opens from a node panel's info button, from a tapped graph link (links become tappable and keyboard-reachable through the list view), from entity-page connections, from the cascade (as today) and from globe arc cards.
  - A subtle "?" badge marks items with no source or confidence below 0.5.
  - One minimum-confidence setting, kept in the navigation state, applies to the graph, cascade and globe. It replaces the globe's fixed 0.5 floor.
- **Done when:** tapping any node or link shows its provenance, the database refuses new rows without it, and the confidence filter works in every lens.

**A4. History and "as of" dates (migration 0024)**
- **Change log:**
  - Columns: `history.change_log(id, at, entity: node|edge|causal_link, entity_id, op: snapshot|insert|update|delete, before, after, actor)`.
  - It is append-only: update and delete raise errors, and no role has those rights.
  - Triggers on node, edge and causal_link record inserts, deletes and meaningful updates; they skip housekeeping columns such as scores and `updated_at`.
  - The actor comes from `wg.actor`, which the pipeline sets, for example `pipeline:news`.
- **Baseline:** enabling history writes one `snapshot` row per existing row, so history starts on that date and the API says so for earlier dates.
- **Two kinds of time:**
  - When WorldGraph knew something: the change log.
  - When it was true in the world: `valid_from` and `valid_to` on links.
  - `api.graph_as_of({at, …same filters as api.graph})` and `api.local_graph_as_of` rebuild the state at that date. The graph query is refactored to read through `_g_nodes(at)` and `_g_edges(at)`, so live and as-of results share one code path.
- **Storage:** see question 2. Proposal: keep 90 days, and log `mentions` links per story rather than per row.
- **Undo:**
  - Personal edits (notes, user entities and links) keep a per-viewer change list with undo and redo (last 50).
  - World-graph corrections go through the pipeline: `wg history revert <change_id>` for the owner.
- **Done when:** pytest replays a scripted sequence of changes and `as_of(t)` equals the graph at `t`, including valid dates; the log refuses updates and deletes; and personal undo and redo are tested.

**A5. Schema map (migration 0025)**
- `api.schema()` returns type bubbles (counts, property definitions) and relation links: counts per source type, relation and target type.
- **UI:** a third graph view next to Graph and List: "Schema". Type bubbles are sized by count with icons, and links are labelled with counts.
  - Tapping a type opens the list filtered to that type for now, and the table lens after B3.
  - Tapping a relation filters the graph to it.
- **Done when:** it matches the live schema and counts, and each type opens its list or table.


**A6. Trust at a glance (added by the owner)**
- Line thickness shows strength and transparency shows confidence on every graph, cascade and globe link, alongside the existing solid, dashed and dotted styles.
- Unsourced or weak items get a "?" badge.
- One legend explains all of this.
- **Done when:** the same link looks the same in every view, and tests cover the mapping from confidence and strength to visual weight.

**A7. Sleek heat map (added by the owner)**
- Replace the hexagon tiles (`features/globe/layers.ts`, `model.ts binEvents`) with two layers:
  - **Zoomed out:** countries shaded by activity, coloured by the net balance of risk and opportunity (amber or teal), with ▲ or ▼ on hover. It shares the region data the globe already loads.
  - **Zoomed in:** a smooth, soft glow of event density (a GPU heat layer) that fades out where the event points take over.
- It respects the calm setting, the theme and both border views.
- **Done when:** there are no hexagons, it is readable in dark and light at every zoom, and phone screenshots are reviewed.

**How to try Phase A:** Settings → Sample data On. Then:
- open `#entity=` on a curated company and check its property chips and grouped links;
- tap any graph link and open "Why is this here?";
- use Graph → Schema;
- run the as-of tests.

**Rough size:** 30–45 L tokens. Order: A0 and A1/A2 database work (one agent, because migrations run in order), then A3 and A4 database work, then the screens split by area.



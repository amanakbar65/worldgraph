export const meta = {
  name: 'worldgraph-content-api',
  description: 'Author sample storylines and indicators, implement the api.* SQL functions, build map assets and the UI kit, each in an isolated worktree',
  phases: [{ title: 'Build', detail: '11 agents in parallel worktrees' }],
}

const COMMON = `
You are building part of WorldGraph, a visual world-knowledge web app for businesses: a 3D globe, a knowledge graph, cause-and-effect cascades and crowd forecasts. The owner wants it sleek, professional, simple, accurate and convenient.

Your working directory is an isolated git worktree of the repository (a copy of /home/user/worldgraph at its current commit). First read CLAUDE.md and PLAN.md, then the files named in your task.

Environment
- Python backend: \`cd backend && uv sync\`, then \`uv run ...\`.
- PostgreSQL 16 with PostGIS and pgvector runs at postgresql://wg:wg@localhost:5432/postgres (role wg is a superuser). If a connection is refused, run \`pg_ctlcluster 16 main start\`. Backend tests: \`cd backend && TEST_DATABASE_URL=postgresql://wg:wg@localhost:5432/postgres uv run pytest -q\`. Each test session creates and drops its own temporary database, so parallel agents don't collide.
- Frontend: node_modules is NOT in your worktree. Before any npm or npx command, run \`ln -sfn /home/user/worldgraph/frontend/node_modules frontend/node_modules\`. Never run npm install (the folder is shared).
- Network: full internet access is available (package registries, GitHub, data sources).
- Other agents are working in parallel in their own worktrees on other files. Create or edit ONLY the files your task gives you. Don't edit shared files (frontend/src/api/contract.ts, migrations 0001-0003, tests/conftest.py, tests/contract.py, seed/models.py, seed/build.py, seed/load.py) unless your task says so. If you think a shared file needs a change, say so in "concerns" instead.

Finishing
1. Run the checks your task names and make them pass.
2. Commit in your worktree: \`git add -A && git commit -m "<Area>: <what changed>"\` (plain message, no trailers).
3. Reply with the structured report: branch (git rev-parse --abbrev-ref HEAD), commit (short hash), files changed, a short summary, the checks you ran with their results, and any concerns.
`

const STORY_RULES = `
Task type: SAMPLE STORYLINES (content).
Read backend/src/worldgraph/seed/README.md (format, honesty rules, writing rules) and the complete example backend/src/worldgraph/seed/storylines/red-sea-shipping.yaml. Look ids up in backend/src/worldgraph/seed/gazetteer.json (regions: country region:xx, state region:xx-yy, city region:xx-yy.slug) and backend/src/worldgraph/seed/entities/*.yaml (sectors, commodities, infrastructure, organizations, policies, region:eu).

Write ONE new file per storyline: backend/src/worldgraph/seed/storylines/<storyline-id>.yaml. Write only those files.

Targets for your set of 5 storylines together:
- about 40 stories: about 30 events and 10 projected impacts. Each storyline has 6-10 stories.
- 6 forecasts in total, at least one per storyline that has a natural upcoming decision. At least 2 of them have a move of 10 or more points within the last day (moves: [{days_ago: 0.3-0.9, delta: ±0.10-0.18}]). One is a "thin market" (volume under 5000 or liquidity under 1000).
- Links: each storyline has at least 6 links mixing reported, inferred and projected. Every storyline with a forecast has one conditional pair: a YES link and a NO link from the same event to two different projected stories. Where it fits naturally, add 1-2 links to stories in red-sea-shipping.yaml (for example story:asia-europe-rates-jump or story:suez-revenue-falls). Never link to ids that don't exist in your worktree. Eleven storylines already exist (red-sea-shipping, fed-rate-path, japan-yen-boj, china-property-stimulus, nigeria-fx-reform, egypt-currency-suez, opec-output, europe-gas-storage, ai-datacenter-power, south-asia-heatwave, gulf-green-hydrogen-solar): read them for tone, and link to their stories where a real mechanism connects them.
- Opportunities about as often as risks. Use neutral sparingly.
- Geography: be specific. Use state and city ids where they exist (India, US, China, Brazil, Germany, Japan, Indonesia, Mexico, Australia and Nigeria all have states). Cover several countries per storyline, so the globe shows cross-border cascades.
- age_hours spread across 0-720, with exactly one or two events under 1 hour old across your whole set.
- Invented companies: only inside a storyline (entities: with sample: true). Prefix the id with the storyline slug (org:<storyline-id>-<name>) so it can't collide with other agents' ids. Give them plausible, clearly fictional names. Never make news about real companies or people.
- Headlines must be 3-12 words and so_what 5-20 words (one sentence ending with a full stop). Actions must be 2-8 words, imperative and practical for a business owner. Mechanisms must be 2-4 lowercase words. No dates or years anywhere in text.
- Write like a calm, sharp business editor: specific, neutral, never alarmist.

Check: \`cd backend && uv run wg seed check\` must print "Sample data is valid." Also run \`uv run pytest -q tests/test_seed.py\` with TEST_DATABASE_URL set as above.
In your summary, report the counts of stories (events and projected), forecasts and links you added.
`

const SQL_RULES = `
Task type: SQL API FUNCTIONS (Postgres).
Every screen calls api.<name>(args jsonb) returns jsonb. The exact response shapes are the zod schemas in frontend/src/api/contract.ts (read the whole file, including the RpcArgs interface and the rules at the top). They are also exported as JSON Schema in contracts/<name>.json. Read migrations 0001_init.sql, 0002_api_foundation.sql, 0003_sample_clock.sql and 0007_sample_clock_v2.sql (number 0007 is taken; the sample now has about 230 stories, 236 causal links, 31 forecasts and 163 KPI series) in backend/src/worldgraph/db/migrations/. Use the helpers they provide: api._use_sample, api._viewer_country, api._provider_visible, api._window, api._text_array, api._region_ref, api._entity_ref, api._prob_at, api._sparkline, and the views api.story_card (StorySummary json in column "card") and api.forecast_card (ForecastSummary json in "card", plus columns thin, hidden, change_24h, region_id…).
Also read backend/src/worldgraph/seed/ (the sample data your functions will serve) and tests/conftest.py and tests/contract.py.

Rules
- Put all your functions in ONE new migration file (name given below). Use \`create or replace function api.<name>(args jsonb) returns jsonb language sql|plpgsql stable set search_path = public, extensions as $$ ... $$;\` (volatile for writes). If you need private helpers, name them api._<prefix>_<name> using your group prefix (given below) so they can't collide with other groups.
- Every contract key is always present: "no value" is null, and empty lists are [] (never null). Round floats sensibly (probabilities 3 decimals, coordinates 4).
- Sample rule: include rows with is_sample = true only when api._use_sample(args) is true. Live rows are always included.
- Forecast visibility: a forecast is shown only if api._provider_visible(provider, api._viewer_country(args)) is true, the card's "hidden" is false, its status is 'open', and the sample rule allows it. This fails closed for real-money providers.
- Unknown ids: \`raise exception 'Not found: %', id\` (the message must start with "Not found").
- Times are relative to now(). The test fixture shifts sample data so the newest sample story is about 20 minutes old.
- Never build SQL strings from arguments (no EXECUTE with argument text). Read arguments with ->>, ->, jsonb_array_elements_text and so on, and validate limits with least/greatest.
- Performance: each call should take well under 200 ms on the seeded test database. Use the indexes in 0001 and 0002; add indexes in your migration if you need them.
- Tests: write backend/tests/api/test_<group>.py (also create backend/tests/api/__init__.py, empty). Use the fixture \`sdb\` (a connection to a migrated database with the sample data loaded and the clock shifted) and \`from tests.contract import call, check\`. For EVERY function: (1) the contract check passes for typical arguments and for edge cases (sample=false, which gives no sample rows, so lists may be empty; filters; limits); (2) semantic tests (ordering, windows, visibility, not-found errors, limits); (3) a timing test (< 500 ms). Also test that a real-money provider is hidden: insert a temporary forecast with provider 'polymarket' enabled and check it's hidden when the viewer country is null or 'IN' and shown for 'US' (do it inside the test's transaction; the fixture rolls back).
- Checks: \`cd backend && TEST_DATABASE_URL=postgresql://wg:wg@localhost:5432/postgres uv run pytest -q\` (all tests, not just yours) and \`uv run ruff check . && uv run ruff format --check .\`.
`

const tasks = [
  {
    label: 'storylines:finance-macro',
    prompt: STORY_RULES + `
Your 5 storylines (ids in brackets). Write them as rich, connected arcs:
1. [fed-rate-path] The US Federal Reserve's next decision and the dollar. US rates → stronger or weaker dollar → emerging-market currencies (Turkey, India, Brazil, Indonesia) → importers' costs and dollar-debt borrowers. Include US housing or real estate. Forecast: "Will the Fed cut rates at its next meeting?" with YES/NO branches.
2. [japan-yen-boj] Bank of Japan rate-hike odds, yen moves, carry-trade unwinding hitting emerging-market assets, and Japanese exporters (an invented carmaker or electronics firm). Opportunity: cheaper Japanese machinery for importers. Forecast on a BOJ hike.
3. [china-property-stimulus] China property slowdown and stimulus: PBOC loan prime rate cut odds, steel demand, iron ore prices → Western Australia (Port Hedland) miners and Brazil. Opportunity: stimulus lifts construction machinery demand. Use Chinese provinces (cn-gd, cn-js, cn-zj…).
4. [nigeria-fx-reform] Naira moves, fuel subsidy effects, the Central Bank of Nigeria's rate path, Lagos consumer prices. Opportunity: local manufacturing replaces imports, and remittance flows. Use Nigerian states (ng-la, ng-kn, ng-fc…).
5. [egypt-currency-suez] The Egyptian pound, reserves, IMF programme reviews and Suez income. Link from story:suez-revenue-falls (in red-sea-shipping.yaml) to one of your events. Opportunity: tourism and Gulf investment inflows.`,
  },
  {
    label: 'storylines:energy-climate',
    prompt: STORY_RULES + `
Your 5 storylines:
1. [opec-output] An OPEC+ output decision (forecast: "Will OPEC+ extend its output cuts at the next meeting?"), Brent moves, Saudi official selling prices, Indian refiners (an invented refiner in Gujarat), airlines' jet-fuel costs, and trucking diesel costs. Opportunity: US shale and Brazilian offshore exports.
2. [europe-gas-storage] EU gas storage levels, Norwegian field maintenance, Qatari LNG (Ras Laffan) and German energy-heavy industry (chemicals in Rhineland-Palatinate, de-rp). Forecast on EU storage reaching a target. Opportunity: LNG traders and heat-pump installers.
3. [ai-datacenter-power] AI data-centre power demand: Northern Virginia (us-va), Texas (us-tx) and Ireland grid limits, Johor (Malaysia, my-01) build-out, Mumbai (in-mh) and Chennai (in-tn) data-centre parks. Mostly opportunities: transformers, cooling, industrial land, and gas turbines. Risk: grid connection delays and electricity price rises.
4. [south-asia-heatwave] A heatwave across North India (in-up, in-dl, in-rj) and Pakistan → record power demand, coal logistics via Paradip port, crop stress, and labour productivity. Opportunity: air conditioners and coolers, solar rooftop installers.
5. [gulf-green-hydrogen-solar] Green hydrogen and solar tenders in Saudi Arabia, the UAE and Oman; India's solar module manufacturing push (in-gj, in-rj) and domestic-content rules; module price declines. Mostly opportunities. Forecast on a large tender award or a module import-duty decision.`,
  },
  {
    label: 'storylines:agri-food',
    prompt: STORY_RULES + `
Your 5 storylines:
1. [brazil-coffee-frost] Frost in Minas Gerais (br-mg) coffee areas → arabica prices, Vietnam robusta (Central Highlands provinces), roasters in the US and Germany (invented), Colombian growers' opportunity. Forecast on arabica reaching a new high within a few months.
2. [west-africa-cocoa] Cocoa crop stress in Côte d'Ivoire and Ghana (Tema and Abidjan ports), EU deforestation-rule compliance costs, European chocolate makers (invented), and Ecuador's opportunity.
3. [india-monsoon-rice] A weak monsoon in parts of India (in-mh, in-ka, in-ap) → kharif output, food inflation, an RBI rate decision (forecast: "Will the RBI cut the repo rate at its next review?"), rice export curbs (a forecast or event), and rice importers in Senegal and the Philippines. Opportunity: Thai and Vietnamese rice exporters.
4. [palm-oil-levy] Indonesia's palm oil export levy and biodiesel blending → palm prices; Malaysian exporters' opportunity; edible-oil importers in India, Pakistan and Egypt; FMCG margins. Forecast on a levy change.
5. [black-sea-wheat] Russian wheat harvest size and export quotas, Bosporus grain shipping, Egypt's import tenders and bread subsidy, and the Australian and Argentine exporter opportunity. Keep conflict wording minimal and factual: focus on harvests, quotas and freight.`,
  },
  {
    label: 'storylines:industry-tech',
    prompt: STORY_RULES + `
Your 5 storylines:
1. [taiwan-quake-chips] An earthquake near Hsinchu (a hazard event) → fab inspections, a pause in advanced-chip output, a memory price spike, and automakers in Germany, Japan and Mexico facing chip shortages. Opportunity: fabs in Japan (Kumamoto, jp-43) and the US (us-az). Describe real companies only via background facts; any affected company in an event must be invented.
2. [rare-earth-controls] China tightens rare-earth and magnet export licensing → EV motor and wind-turbine makers in Japan and Germany, critical-mineral projects in Australia (au-wa) and the US, and India's critical-minerals push. Forecast: "Will China add new rare-earth items to its export controls?"
3. [us-auto-tariffs] US tariffs on imported cars and parts (forecast on a tariff decision), German parts suppliers (de-by, de-bw), Japanese makers, Mexican plants in Nuevo León (mx-nle) and Guanajuato (mx-gua), and a USMCA review. Include opportunities for US-based suppliers.
4. [mexico-nearshoring] Nearshoring into Monterrey and Saltillo industrial parks, power-grid limits in Nuevo León, the IMMEX programme, industrial real estate demand, and logistics to Texas (us-tx). Mostly opportunities, with grid and water risks.
5. [eu-cbam-steel] The EU carbon border tax's cost to steel and aluminium exporters in India (in-or, in-jh, in-cg), Turkey and Ukraine. Green steel projects in Sweden and Spain (opportunity). Indian and Turkish mills explore low-carbon lines. Forecast on the EU delaying or simplifying the next phase.`,
  },
  {
    label: 'storylines:trade-health-consumer',
    prompt: STORY_RULES + `
Your 5 storylines:
1. [us-india-trade-deal] US–India trade deal talks (forecast: "Will the US and India announce a trade deal within three months?"), tariff exposure for textiles from Tiruppur (in-tn) and Surat (in-gj), gems and jewellery, and electronics exports. Competition from Bangladesh and Vietnam. Conditional YES/NO branches for Indian apparel exporters.
2. [india-eu-fta] India–EU free trade agreement progress: autos, wine and spirits, textiles, pharmaceuticals and services. Opportunities for EU machinery and Indian apparel. Forecast on the deal being concluded.
3. [pharma-api-supply] Chinese active-ingredient (API) price swings, a US FDA import alert on an invented Indian plant (in-tg or in-gj), India's production incentives for APIs, and generic drug shortages in the US and Europe. Opportunity for Indian API makers in Telangana and Gujarat.
4. [panama-canal-drought] Low Gatun Lake levels → draft limits (forecast on lifting draft restrictions), US Gulf grain and LNG exports, shifts to US East Coast ports (Savannah, us-ga), and Asian buyers. Opportunity: West Coast ports and rail.
5. [vietnam-electronics-boom] Vietnam electronics exports, a big invented component-maker investment in Bac Ninh, power shortages in northern Vietnam, and opportunities for component suppliers and industrial land. Forecast: "Will Vietnam's export growth top 10% this year?" (rephrase without the year).`,
  },
  {
    label: 'indicators',
    prompt: `
Task type: KPI INDICATORS (content).
Read backend/src/worldgraph/seed/README.md (the "Indicators" section and the honesty rules), backend/src/worldgraph/seed/models.py (the Indicator model: id indicator:<slug>; name at most 24 characters; subject; unit; frequency daily|weekly|monthly|quarterly; higher_is better|worse|neutral; points 6-120; start; end; volatility; decimals), and backend/src/worldgraph/seed/build.py (indicator_points shows how series are generated).

Write ONE file: backend/src/worldgraph/seed/entities/indicators.yaml, with about 90 series. These are sample series, so their names say what they measure, but their values are illustrative. Keep levels plausible for 2025-2026 so the app feels real.

Countries: up to 4 KPIs each, chosen from inflation (% y/y, higher_is worse), policy rate (%, neutral), currency per USD (units like "INR per USD"; higher_is worse for the local currency, which means weaker), fuel price (local currency per litre, worse), power demand (GW, neutral), manufacturing PMI (index, better).
- 4 KPIs each: us, in, cn, jp, de, gb, br, mx, ng, eg, tr, id, vn, au, sa, kr, za
- 2-3 KPIs each: ae, my, th, ph, pk, bd, cl, ci, gh, ar, co, fr, it, es, nl, ca, ru, tw, sg, ir (inflation and currency only for ir)
- 1-2 each for the EU bloc (region:eu): euro-area inflation and the ECB rate
- state-level: in-mh, in-gj, in-tn, in-ka, in-up (peak power demand GW; for in-mh and in-gj also industrial power price); us-tx and us-va (power demand); cn-gd (export growth %)
Commodities (subject commodity:<id>): crude-oil (USD/bbl), natural-gas (two series: TTF EUR/MWh and JKM USD/MMBtu), coal (USD/t), iron-ore (USD/t), steel (USD/t), aluminium (USD/t), copper (USD/t), lithium (USD/t carbonate), nickel (USD/t), rare-earths (an NdPr oxide price, USD/kg), wheat (USD/bu), rice (Thai 5% USD/t), maize (USD/bu), soybeans (USD/bu), palm-oil (MYR/t), sugar (USc/lb), coffee (arabica USc/lb), cocoa (USD/t), cotton (USc/lb), fertilisers (urea USD/t), gold (USD/oz), semiconductors (a memory spot price index), solar-modules (USD/W).
Sector series: subject sector:logistics-trade: a container freight index (USD per FEU, Shanghai–Rotterdam, weekly) and a dry bulk index.
Daily series use 60-90 points; weekly 52; monthly 18-24; quarterly 8-12. Make trends consistent with the sample storylines' themes: freight up (Red Sea), arabica up (Brazil frost), cocoa high, rice up (weak monsoon), naira and Egyptian pound weaker, gold firm, module prices down, and so on.

Every subject must exist: check region ids against backend/src/worldgraph/seed/gazetteer.json and the others against entities/*.yaml.
Check: \`cd backend && uv run wg seed check\` must pass, and so must \`TEST_DATABASE_URL=postgresql://wg:wg@localhost:5432/postgres uv run pytest -q tests/test_seed.py\`.`,
  },
  {
    label: 'sql:map-region-brief',
    prompt: SQL_RULES + `
Your group: prefix "a", migration file backend/src/worldgraph/db/migrations/0004_api_map_region.sql, tests backend/tests/api/test_map_region.py.
Functions:
- api.meta(args): MetaResponse.
  - data.live_stories / sample_stories count event stories (kind='event').
  - forecasts counts visible open forecasts.
  - entities counts nodes other than story and forecast.
  - last_ingest_at is max(first_seen) of live stories (null if none).
  - showing_sample = api._use_sample('{}') (true while there is no live data).
  - sectors: the 9 sector nodes in this fixed order: energy, agri-food, manufacturing, logistics-trade, finance, tech, health, real-estate, consumer. Use the id without the "sector:" prefix, the name, and props->>'icon'.
  - sources: rows of the source table, plus one entry per provider that is enabled and visible to the viewer (id = provider id, attribution, homepage).
- api.globe(args {window, sectors?, sample?}): GlobeResponse.
  - events: event stories with first_seen within the window and a location, filtered by sectors (overlap) and the sample rule. Ordered by importance desc, at most 1500.
  - arcs: causal links of type reported or inferred whose two stories are in the event set or (for the source) any event within 30 days, with known countries that differ (src_country <> dst_country). Use the story locations. impact = the destination story's impact.
  - forecasts: visible open forecasts with a location (no window or sector filter), cards ordered by |change_24h| desc nulls last.
  - countries: per country_id of the event set: count, risk, opportunity, neutral and score = (opportunity − risk) / count, rounded to 3.
- api.top(args {window, sectors?, sample?}): TopResponse.
  - stories: 5 events in the window, ranked by importance + 25 × exp(−age_hours / 24).
  - movers: up to 3 visible open forecasts that aren't thin, with |change_24h| ≥ 0.03, by |change_24h| desc.
- api.region(args {id, window, sample?}): RegionResponse for a region node of any level (bloc, country, state, city).
  - breadcrumb: ancestors from the country down to the parent (empty for countries and blocs).
  - kpis: indicator series whose subject is the region, at most 4, ordered by a fixed preference (inflation, policy rate, currency, fuel, power, PMI, others by name). If there are none and the region is a state or city, use the country's KPIs and set kpi_scope to the country id. If there are still none, return [] with kpi_scope null. Each Kpi has latest, previous (point before), change, as_of, at most 60 last points in series and is_sample from the node.
  - Stories "in" a region: for a country, s.country_id = id; for a state, s.admin1_id = id; for a city, s.primary_region = id; for a bloc, the country is a member (member_of edges).
  - sector_pulse: all 9 sectors in the fixed order. count = stories in the window with that sector. impact is the dominant impact weighted by importance (neutral when count is 0). score = (opportunity importance − risk importance) / total importance, rounded to 3. direction is 'up' if count > count in the previous window of the same length, 'down' if lower, null if equal.
  - stories: top 10 events in the window by importance.
  - decisions: visible open forecasts whose about edges point at the region, its country (for states and cities) or its member countries (for blocs). Order by end_date asc, at most 8.
  - children: for a country, ALL its states (zero counts included) with counts in the window. For a state, its cities. For a bloc, its member countries. For a city, []. Score is as in globe.
  - graph: a depth-1 local graph (nodes and links per GraphData). Include the region, at most 12 child regions, and the top 25 stories in it by importance, plus forecasts and entities linked to the region by edges. Degree is computed within the returned graph; created_at is first_seen for stories and node.created_at otherwise.
- api.compare(args {ids: 2-3 region ids, window?}): CompareResponse with region ref, kpis (same rule as region), sector_pulse and counts in the window. Raise an error for fewer than 2 or more than 3 ids, or an unknown id (Not found).
- api.brief(args {profile?, sample?}): BriefResponse.
  - Six cards in this exact order: top_risks, top_opportunities, biggest_movers, odds_moved, cascade_to_watch, region_spotlight.
  - Use the last 24 hours, falling back to 7 days when 24 hours has fewer than 3 stories.
  - top_risks and top_opportunities: 3 events of that impact by importance. If a profile is given, boost stories that mention any profile node or are located in profile regions (×1.5).
  - biggest_movers: 3 events with the most sources in the window.
  - odds_moved: 3 visible forecasts by |change_24h|.
  - cascade_to_watch: the event from the last 7 days with the most outgoing causal links (focus card), plus that count.
  - region_spotlight: the country with the most stories in the window, with 3 top stories and score.
  - Profile shape is in contract.ts (Profile).`,
  },
  {
    label: 'sql:story-graph-search',
    prompt: SQL_RULES + `
Your group: prefix "b", migration file backend/src/worldgraph/db/migrations/0005_api_story_graph.sql, tests backend/tests/api/test_story_graph.py.
Functions:
- api.story(args {id}): StoryResponse for a story node (event or projected).
  - Story = its card plus actions, last_seen, mention_count, sources and entities. sources: articles with source_name, title, url and published_at, newest first, at most 12. entities: nodes the story mentions (mentions edges), sectors excluded, ordered region > organization > commodity > infrastructure > policy > others, at most 16.
  - forecasts: up to 3 visible open forecasts. First those with a relates_to edge to this story; then forecasts whose about edges point at entities the story mentions or at its country.
  - causes / effects: counts of incoming and outgoing causal links whose forecast (for conditional links) is visible.
- api.cascade(args {id, depth?}): CascadeResponse. Depth defaults to 2 and is capped at 3.
  - Walk causal links backward (causes: depth −1, −2, …) and forward (effects: +1, +2, …) from the focus story (depth 0), at most 60 nodes, keeping the shortest depth per node.
  - links: every causal link between returned nodes, with evidence (all rows) as Evidence objects.
  - Conditional links whose forecast is not visible to the viewer must be dropped, and their projected stories omitted unless reachable another way.
  - branches: one per visible forecast used by conditional links in the result. Give the forecast card and outcomes [{outcome: "YES", probability: p, story_ids}, {outcome: "NO", probability: 1 − p, story_ids}], rounded to 3.
  - Apply the sample rule only to non-focus nodes: if the focus itself is a sample story, sample nodes are allowed.
- api.entity(args {id}): EntityResponse for any node type except story (raise Not found for stories and unknown ids).
  - facts: up to 8 {label, value} strings built from the node and its edges: Type and subtype, Located in (name), Part of (parent region name), Country, Population (formatted with thousands separators), ISO code, HS code, Sectors (names), Members (count for blocs), Produced in (top producer names for commodities), Owner (from owns edges). Only include facts that exist.
  - timeline: events about the entity, newest first, at most 20. For regions, use the country/state/city rule (country_id / admin1_id / primary_region). For others, use stories with a mentions edge to it.
  - backlinks: nodes with an edge pointing TO this entity, excluding stories (those are the timeline) and part_of children of regions beyond 30. Give {id, type, name, edge_type}, ordered by type then name, at most 60.
  - forecasts: visible open forecasts with an about edge to it, each with history (≤ 120 evenly downsampled points {ts, p}).
  - indicators: KPIs whose subject is the entity (Kpi shape: latest, previous, change, as_of, series ≤ 60, source_name, is_sample).
  - graph: a depth-1 local graph (at most 60 nodes, prioritising stories by importance).
- api.graph(args {types?, sectors?, regions?, window?, min_confidence?, limit?, sample?}): GraphResponse, the global graph.
  - limit defaults to 400, maximum 1500. window defaults to 30d ('all' allowed).
  - Seed nodes: event stories in the window (sample rule), filtered by sectors and regions (country_id or admin1_id in the given ids, or member countries of a given bloc).
  - Add the entities they mention (except sectors, unless 'sector' is in types), projected stories linked from them, and visible forecasts with relates_to or about edges to included nodes.
  - Links: mentions, about, relates_to and structural edges (located_in, part_of, owns, produces, member_of, competes_with, depends_on, in_sector, exports_to, imports_from) among included nodes, plus causal links with confidence ≥ min_confidence (default 0). causal = true for causal links, and confidence is set for those.
  - types filters node types (dropping links to removed nodes). Degree is computed within the result. truncated = true when the limit cut anything.
  - created_at: first_seen for events, node.created_at otherwise. That powers the time-lapse.
- api.local_graph(args {id, depth: 1-3, limit?}): LocalGraphResponse.
  - Breadth-first over edges (both directions) and causal links, from the focus, up to depth. limit defaults to 150, maximum 400.
  - Don't expand more than 12 child regions per region (part_of edges into a region), and don't expand sector nodes (they connect everything).
  - Prioritise by depth, then story importance, then degree. focus is the id; truncated is set.
- api.search(args {q, types?, limit?}): SearchResponse.
  - Case-insensitive match on node name and aliases: exact (score 1) > prefix (0.8) > trigram similarity (≥ 0.25; score = similarity × 0.7).
  - Boost countries +0.15, states +0.05, events by recency (+0.1 if under 24 hours old), forecasts +0.05.
  - Exclude sample stories and forecasts unless api._use_sample(args); exclude forecasts not visible.
  - limit defaults to 12, maximum 50; q must be 1-80 characters (return empty results for a blank q).
  - context examples: "Country · Southern Asia", "State · India", "City · Gujarat, India", "Story · India · risk", "Forecast · 62%", "Commodity · HS 2709", "Company · Denmark", "Port · India", "Policy", "Sector". Use the subtype (port, chokepoint, central-bank and so on) in a readable form.`,
  },
  {
    label: 'sql:forecasts-business-ai',
    prompt: SQL_RULES + `
Your group: prefix "c", migration file backend/src/worldgraph/db/migrations/0006_api_forecasts_business.sql, tests backend/tests/api/test_forecasts_business.py.
Functions:
- api.forecasts(args {sectors?, regions?, categories?, sort?, include_thin?, profile?, sample?}): ForecastsResponse.
  - Visible open forecasts, at most 100.
  - categories filters forecast.category.
  - regions: forecasts with about edges to the region, its country, its states, or member countries of a bloc.
  - sectors: forecasts with about edges to sector:<id> OR whose category maps to the sector. Mapping: economy→finance; finance→finance; trade→logistics-trade; energy→energy; commodities→agri-food, manufacturing, energy; tech→tech; policy, politics and geopolitics→none.
  - include_thin defaults to true.
  - sort: 'relevance' (default) = 0.5 × profile match (if a profile is given: about edges to profile nodes, regions or sectors) + 0.3 × |change_24h| × 5 (capped at 1) + 0.2 × log volume scale. 'moved' = |change_24h| desc. 'ending' = end_date asc. 'volume' = volume desc.
- api.forecast(args {id}): ForecastResponse. Raise Not found when unknown or not visible to the viewer.
  - history: all snapshots downsampled evenly to ≤ 240 points {ts, p, volume}, keeping the first and last.
  - outcomes and resolution_rule.
  - entities: about edges, as EntityRef.
  - stories: up to 8 related stories, from relates_to edges first, then events mentioning the about-entities, by importance.
  - branches: group conditional causal links with forecast_id = id by outcome. Give probability (YES = p, NO = 1 − p, rounded to 3) and effects = destination story cards extended with mechanism, confidence and from_story. Order YES first.
- api.affects(args {profile, window?, sample?}): AffectsResponse. The "Affects you" feed; window defaults to 7d.
  - Profile nodes: sectors (sector:<id>), locations, inputs, suppliers, markets and competitors (all node ids), plus keywords.
  - Direct matches: events in the window that mention a profile node, or are located in a profile region (country_id, admin1_id or primary_region equal to it, or the country of a profile state or city). Also sector overlap (weak) and keyword ILIKE on headline or so_what. Use the plain || concatenation of '%' with the keyword, as a parameter value, never via dynamic SQL.
  - Downstream matches: stories (events or projected) reachable within 2 causal hops FROM a direct match.
  - relevance (0-1): max over reasons with weights inputs 1.0, locations 0.9, suppliers 0.85, markets 0.8, competitors 0.7, keywords 0.5, sectors 0.35. Multiply by (0.5 + 0.5 × confidence), by 0.85 per hop for downstream, and by the importance factor (0.5 + importance / 200). Clamp to 1.
  - matched: EntityRefs of the profile nodes that matched (sector nodes too).
  - path: story ids from the direct match to this story (just [id] for direct).
  - actions: the story's actions.
  - Order by relevance desc, at most 30, unique stories.
  - suggested_forecasts: up to 6 visible forecasts about profile nodes or their countries, ordered by |change_24h| then volume.
  - An empty profile returns empty lists.
- api.opportunities(args {sectors?, regions?, profile?, window?, sample?}): OpportunitiesResponse; window defaults to 30d.
  - Stories with impact 'opportunity': events in the window plus projected stories linked from those events. Filter by sectors and regions. At most 40.
  - why_now = so_what.
  - suits = up to 3 strings: sector names first, then mentioned organisation or commodity names.
  - forecast = the best related visible forecast (relates_to, or about a mentioned entity or country) or null.
  - momentum = 0.6 × exp(−age_hours / 72) + 0.4 × least(1, source_count / 20). For projected stories, use the source event's age and sources × 0.5.
  - relevance = the profile score (same reasons and weights as affects, direct only), or importance / 100 when there's no profile.
  - Order by relevance × 0.6 + momentum × 0.4 desc.
- api.ask_context(args {q, limit?, sample?}): AskContextResponse. Retrieval for the Ask feature; the model answers only from what this returns.
  - Split q into words of at least 3 letters (lowercase, ignoring common stop words). entities: up to 8 nodes whose name or aliases match a word (exact, prefix or trigram ≥ 0.3), excluding stories.
  - stories: up to limit (default 12, maximum 25) events or projected stories that mention those entities, or are in those regions, or whose headline/so_what match words. Rank by number of matching words + importance / 100. Include sources (≤ 3) and actions.
  - links: causal links among the returned stories plus their direct neighbours' links touching them, at most 20, with evidence.
  - forecasts: up to 6 visible forecasts about the entities or whose short_title or question match words.
- api.pending_analysis(args {limit?}): PendingAnalysisResponse.
  - Stories with analysis_status = 'pending' by importance desc. limit defaults to 12, maximum 30. total_pending = count of all pending.
  - Per item: titles = distinct article titles (≤ 8), snippets = non-null snippets (≤ 5), sources = distinct source names, first_seen, region ref, event_type, sectors, entities (mentions, excluding sectors).
  - candidates: up to 6 earlier 'done' events from the 30 days before first_seen, sharing a mentioned entity, country or sector (in that order of preference), as StorySummary cards.
  - Sample stories are always 'done', so on the seed DB this returns empty items. Your tests must insert pending stories inside the test transaction.
- api.save_analysis(args {engine, model, items}): SaveAnalysisResponse. VOLATILE plpgsql, the only write function.
  - engine must be 'artifact' or 'api'; at most 30 items.
  - For each item, validate everything again in SQL:
    - the story exists
    - headline 1-12 words, so_what 1-20 words (word_count)
    - impact, direction and horizon enums; magnitude 1-5; confidence 0-1
    - sectors: 1-3 valid ids
    - actions: ≤ 3, each 1-8 words
    - links: ≤ 4, each with mechanism 2-4 words, direction, confidence, link_type 'reported' or 'inferred', and evidence ≤ 300 characters
  - Invalid items go to "rejected" with a short reason; other items still save. Use a per-item BEGIN … EXCEPTION block so one bad item doesn't abort the rest.
  - On success:
    - update the story's headline, so_what, event_type, impact, direction, magnitude, horizon, confidence, sectors and actions; set analysis_status 'done', analysed_at now(), analysis_engine and analysis_model
    - add mentions edges for the listed entity ids that exist (skip unknown)
    - insert causal links from item.links[].from (must be an existing event story that is not the same story) to this story, with method 'llm' and model_version = model, skipping duplicates
    - insert one evidence row per link: source_name 'AI analysis (' || engine || ')', snippet = evidence, url = the newest article URL of the destination story, is_sample = the destination node's is_sample. Keep the evidence check constraint (url not null or is_sample) satisfied: if there's no URL and the story isn't a sample, skip the evidence row.
  - Also accept optional args.skipped: an array (at most 30) of {id, reason}. For each that is an existing story with analysis_status 'pending', set analysis_status 'skipped', analysed_at now(), analysis_engine and analysis_model. Unknown or non-pending ids go to rejected.
  - Return saved, skipped (count), rejected and links_saved (contract.ts was just updated: SaveAnalysisResponse has "skipped").
  - The function must never let arguments become SQL text.
- Live data context: migration 0008_pipeline.sql (read it) adds story.props and 768-d embeddings, and the live pipeline (backend/src/worldgraph/pipeline/store.py) writes stories with analysis_status 'pending', so_what null, headline up to 40 words (the source title), impact/event_type/sectors as rules-based guesses, articles with real URLs, and mentions edges to entities, regions and sector:<id> nodes. Pending stories must still appear in your list functions (affects, opportunities, ask_context…) the same way other stories do: the card's "analysed" flag tells the UI they are drafts. Skipped stories (analysis_status 'skipped') must be excluded everywhere except pending_analysis/save_analysis bookkeeping. Note: functions from migrations 0004 and 0005 (already merged) don't exclude 'skipped' yet; don't edit them, just mention it in concerns.
- Performance fix (in your 0006 file): replace the view api.forecast_card (from 0002) with the same columns in the same order, but compute "latest" per forecast with a LATERAL subquery (order by ts desc limit 1, using the primary key) instead of DISTINCT ON over the whole snapshot table, because live forecasts add a snapshot every hour. Keep the output identical; prove it with a test comparing cards before/after on the seed.`,
  },
  {
    label: 'map-assets',
    prompt: `
Task type: MAP ASSETS (Python + frontend loader).
WorldGraph draws its own map layers (no external tiles inside the claude.ai Artifact): country shapes, state/province shapes for every country, and city points. Read CLAUDE.md, PLAN.md (borders: India's official view for viewers in India; the international default for everyone else), backend/src/worldgraph/geo/gazetteer.py (how region ids are made; reuse its logic so shape ids match the gazetteer EXACTLY) and backend/src/worldgraph/seed/gazetteer.json.
Natural Earth files: backend/data/cache/naturalearth/ may be missing in your worktree. Download from https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/<file> into backend/data/cache/naturalearth/ (git-ignored). Files: ne_50m_admin_0_countries.geojson (default worldview), ne_10m_admin_0_countries_ind.geojson (India's point of view, 10m), ne_10m_admin_1_states_provinces.geojson. Natural Earth is public domain.

Build (files you own):
1. backend/src/worldgraph/geo/assets.py: a reproducible builder, plus a CLI command \`wg geo assets\` (add it to backend/src/worldgraph/cli.py next to "gazetteer"; you are the only agent editing cli.py, backend/pyproject.toml and backend/uv.lock). Geometry libraries: add a dependency group "geo" in pyproject (for example shapely and topojson, via \`uv add --group geo ...\`), and run with \`uv run --group geo wg geo assets\`. Outputs go to frontend/public/geo/:
   - countries.json: TopoJSON of all countries (default worldview), property "id" = region id (region:xx, same rule as the gazetteer: ISO_A2_EH lowercased, skipping -99) and "name". Simplify and quantize so it's ≤ 450 KB and still looks good at continent zoom.
   - countries-in.json: the same, built from India's point-of-view file. In this worldview, India's shape includes all territory India claims, and Pakistan's and China's shapes exclude it.
   - admin1-<continent>.json, one per continent (africa, asia, europe, north-america, south-america, oceania): TopoJSON of all states/provinces, property "id" (EXACTLY the gazetteer state id, for example region:in-gj or region:au-ne1234; use the same id rule and the same largest-shape handling, merging split shapes with the same id into one MultiPolygon) and "name", "country" (region:xx). Simplify per continent to ≤ 1.6 MB each, and test that it renders acceptably at country zoom.
   - admin1-asia-in.json: Asia admin-1 in India's worldview:
     - Every state polygon is intersected with its country's polygon from the India-view countries.
     - Indian territory not covered by any Indian state polygon is added to Jammu and Kashmir (region:in-jk) for the part adjacent to the Pakistan-administered "Azad Kashmir" area, and to Ladakh (region:in-la) for the rest (Gilgit-Baltistan, Aksai Chin and Shaksgam).
     - Pakistan's and China's admin-1 shapes are clipped to their India-view country polygons.
     - Document the approach in a docstring.
   - places.json: compact JSON array of cities from the gazetteer: [id, name, lon, lat, parent, population, capital(0/1)]. Use short keys or arrays to stay small.
   - manifest.json: the file names, sizes, a build date and the Natural Earth version you used.
   Commit the generated files: they're static assets of the app.
2. frontend/src/lib/geo.ts: a typed loader using topojson-client (installed):
   - loadCountries(worldview: "default" | "india"): Promise<FeatureCollection>
   - loadAdmin1(country: string, worldview): Promise<FeatureCollection> — picks the right continent file, filters to the country, and caches files in memory
   - loadPlaces(): Promise<Place[]>
   - continentOf(countryId) (built from a small map you generate into frontend/src/lib/geo-continents.json: country id → continent file key)
   Fetch with relative URLs ("geo/countries.json"), because the app is served from a sub-path inside claude.ai. Add frontend/src/lib/geo.test.ts testing the pure helpers (continent lookup, place parsing) with vitest.
Checks:
- \`cd backend && uv run ruff check . && uv run ruff format --check .\`
- the backend tests (TEST_DATABASE_URL as above) still pass
- \`cd frontend && npx tsc -b --noEmit && npx eslint src/lib && npx vitest run src/lib\`
- a script check that EVERY state id in admin1 files exists in the gazetteer and vice versa (report any mismatches), and that India in countries-in.json contains a point in Gilgit (35.92, 74.31) and Aksai Chin (35.2, 79.5), while India in countries.json does not contain the Gilgit point.
Report file sizes.`,
  },
  {
    label: 'ui-kit',
    prompt: `
Task type: UI KIT and DESIGN SYSTEM (frontend).
Before writing any chart, colour or tile code, load the dataviz skill with the Skill tool (skill name "dataviz") and follow it. Read CLAUDE.md, PLAN.md ("Screens" and the design rules), BUILD_BRIEF.md (the "Visual design system" and "Product principles" sections), frontend/src/styles/tokens.css and globals.css (tokens and the 3-size type scale: text-label, text-body, text-figure), frontend/src/api/contract.ts (data shapes), frontend/src/app/* (the shell), frontend/src/components/ui/button.tsx and frontend/src/lib/format.ts. The app is dark-first, calm, sleek and professional: a dark planetarium, with quiet glass panels floating over a full-screen globe. Colour carries meaning only. Use lucide-react icons (installed), Geist and Geist Mono fonts, Tailwind 4 classes from the tokens, and radix-ui primitives (the single "radix-ui" package is installed: import { Tooltip, Popover, Tabs, Switch, Slider, ToggleGroup, Dialog, ScrollArea } from "radix-ui"). Also installed: cmdk, vaul, clsx, tailwind-merge, class-variance-authority.

Build (files you own):
1. Palette validation: validate and if needed adjust ONLY the colour values in frontend/src/styles/tokens.css, for both themes:
   - every text-on-surface pair meets WCAG AA (fg, fg-muted and fg-subtle on bg, surface, surface-2 and glass)
   - the meaning colours (risk, opportunity, neutral, forecast) are at least 3:1 against surfaces and clearly separable for deuteranopia, protanopia and tritanopia
   - the entity-type colours are distinct from each other and from the meaning colours (pay special attention to commodity vs risk, and infrastructure vs forecast)
   Write frontend/src/styles/palette.test.ts: parse the OKLCH values from tokens.css, convert to sRGB, compute WCAG contrast ratios and a simple colour-vision-deficiency separation check, and assert the thresholds. Keep the layout concept comment.
2. frontend/src/lib/icons.ts:
   - sector id → lucide icon component and name
   - entity type → icon
   - event_type → icon (with a sensible default)
   - impact → icon: risk = CircleAlert, opportunity = Sparkles, neutral = Minus
   - forecast → Users ("crowd")
   frontend/src/lib/meaning.ts: impact, entity type and link type → token colour class and CSS variable name, plus readable labels.
   frontend/src/lib/time.ts: relative time ("12 min ago", "3 h ago", "2 d ago", "in 5 d") and the 24 h / 7 d / 30 d labels, with tests.
3. Primitives in frontend/src/components/ui/:
   - chip.tsx (selectable and static)
   - card.tsx
   - tooltip.tsx
   - popover.tsx
   - segmented.tsx (a segmented control built on ToggleGroup)
   - switch.tsx
   - skeleton.tsx
   - scroll-area.tsx
   - kbd.tsx
   - dialog.tsx
   Every interactive one is keyboard accessible with a visible focus ring and an aria label where needed.
4. Domain components in frontend/src/components/ (one file each, named exports, with JSDoc on the props):
   - ImpactBadge: icon + label + ▲/▼ direction, in the impact colour. Never colour alone.
   - EntityChip: type icon + name, in the type colour; clickable (onClick prop).
   - SectorChip
   - ProbabilityRing (SVG):
     - ring fill = probability, large % in the centre, violet forecast colour
     - optional 24-hour change in points (▲ 8 / ▼ 3)
     - a "glow" prop for big movers
     - faded with a "thin market" tag when thin
     - sizes sm, md, lg
     - role="img" with an aria-label such as "62% crowd forecast, up 8 points in 24 hours"
   - ProbabilityBar: a horizontal bar with %, change and thin styling.
   - Sparkline (SVG): area fill, line, emphasised endpoint dot. Optional baseline; scales to its box; aria-hidden with a text alternative prop.
   - ProbabilityHistoryChart: SVG line or step chart of {ts, p}. 0-100% axis with 3 gridlines, end label, hover crosshair showing value and date, keyboard-accessible focus on points. No external chart library.
   - KpiTile: name, big latest value with unit (number formatted by locale), change with ▲/▼ and colour by higher_is (worse-and-up = risk colour, better-and-up = opportunity colour), sparkline, "sample" marker.
   - ConfidenceMeter: 5 small bars plus a % label, and a link-type label for causal links (Reported / Inferred / Projected / Conditional, drawn with a solid, dashed or dotted line swatch).
   - HorizonChip (now / weeks / months)
   - TimeAgo
   - StoryCard: variants compact (icon + headline, the globe Top 5 style) and full (headline, so-what, chips: sector, region, horizon, confidence; optional crowd forecast row; "Sample" tag; actions list).
   - ForecastRow: question, ProbabilityBar, change, volume with its unit, end date and provider attribution as plain text. Show the URL link ONLY when the url is non-null. Never use bet or trade wording.
   - SectionHeader
   - EmptyState and ErrorState: ErrorState takes an Error and, for DataError (frontend/src/api/source.ts), shows the right fix for each kind (connector_missing, not_allowed, unavailable with a Retry button, and so on). Friendly, short copy that suggests a next tap.
   - SampleBadge
   - SourcesList: source name, title, time, and an external link only when a url exists, opening in a new tab with rel="noreferrer". Sample sources show "Sample source" with no link.
5. A design preview screen for QA, frontend/src/features/settings/DesignPreview.tsx (default export), that renders every component with realistic example data in a responsive grid. The settings agent will link it later; you don't edit SettingsPanel.
Rules:
- At most 3 text sizes per component: text-label, text-body, text-figure.
- Numbers are tabular.
- Respect reduced motion (the pulse and glow animations stop).
- Components are presentational (data comes from props) and use the contract types from @/api/contract.
- No hard-coded colours outside tokens.css.
- Mobile-friendly touch targets (≥ 40 px for primary controls).
Checks: \`cd frontend && npx tsc -b --noEmit && npx eslint . && npx vitest run && npx vite build\` (all must pass). Then run the dev server (\`npx vite --port 5199 &\`) and use Playwright (installed: @playwright/test) with the Chromium at /opt/pw-browsers/chromium (pass executablePath) to screenshot DesignPreview in both themes at desktop and phone widths. To render DesignPreview, temporarily point the globe view at it, or add a tiny entry of your own (frontend/preview.html plus frontend/src/preview.tsx is fine and can stay). Look at your screenshots, fix anything that looks off, and report what you checked.`,
  },
]

// Work from interrupted attempts, saved on wip/ branches (see CHECKPOINT.md).
const RESUME = {
  'sql:forecasts-business-ai': `
RESUME FIRST: a previous attempt at this exact task was interrupted by a usage limit. Its unreviewed work (0006_api_forecasts_business.sql and tests/api/test_forecasts_business.py) is on branch wip/sql-forecasts-business-ai. Start with \`git fetch origin wip/sql-forecasts-business-ai && git merge --no-edit FETCH_HEAD\`, then review it critically against the spec below, finish whatever is missing, and make every check pass.
Changes on main since then that affect you:
- Migration 0009_skipped_and_hardening.sql adds a trigger: when a story's analysis_status becomes 'skipped', the story (node) and its live articles are DELETED and their URLs recorded in skipped_url. So save_analysis's "skipped" path should still set analysis_status = 'skipped' (the trigger then removes the story) and count it; tests must assert the story is gone (and its URLs are in skipped_url), not that it has status 'skipped'.
- Supabase refuses function-level SET of extension settings (e.g. \`set pg_trgm.similarity_threshold\`): never use them; use the default % threshold (0.3) or similarity() comparisons.
- 0005's search now uses pg_trgm's default threshold.`,
  'map-assets': `
RESUME FIRST: a previous attempt at this exact task was interrupted by a usage limit. Its unreviewed work (geo/assets.py, geo/assets_check.py, cli.py and pyproject changes, frontend/public/geo/*, frontend/src/lib/geo-continents.json; geo.ts and its test may be missing) is on branch wip/map-assets. Start with \`git fetch origin wip/map-assets && git merge --no-edit FETCH_HEAD\` (resolve any conflict in backend/pyproject.toml / uv.lock / cli.py by keeping BOTH main's additions, e.g. the "pipeline" dependency group and the "wg geo fips" and "wg pipeline" commands, and yours; regenerate uv.lock with \`uv lock\`), then review it critically against the spec below, finish whatever is missing, and make every check pass.`,
}

phase('Build')
const done = (args && args.done) || []
const todo = tasks.filter(t => !done.includes(t.label))
log('Launching ' + todo.length + ' agents in isolated worktrees (skipping ' + done.length + ' already merged)')
const results = await parallel(todo.map(t => () =>
  agent(COMMON + (RESUME[t.label] || '') + t.prompt, {
    label: t.label,
    phase: 'Build',
    isolation: 'worktree',
    schema: {
      type: 'object',
      properties: {
        branch: { type: 'string' },
        commit: { type: 'string' },
        files: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
        checks: { type: 'string' },
        concerns: { type: 'array', items: { type: 'string' } },
      },
      required: ['branch', 'commit', 'files', 'summary', 'checks', 'concerns'],
    },
  }).then(r => r ? { label: t.label, ...r } : { label: t.label, failed: true })
))
return results

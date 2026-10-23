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

## Knowledge graph upgrade (owner request, 22 Oct 2026)

Source: `docs/KNOWLEDGE_GRAPH_UPGRADE.md` (kept word for word). What exists today: `docs/knowledge-graph-inventory.md`.
**Status:** planned; waiting for the owner's approval. Build one phase at a time, and stop after each phase for review (build, tests, how to try it, update this plan).

**Rules for every phase:**
- Migrations are additive and come with a matching `migrations/down/NNNN_name.down.sql`. A test applies up, then down, then up on a scratch database.
- Every feature sits behind a flag.
- Personal data stays in the per-viewer store. The world graph changes only through the pipeline.
- No new paid service without asking. AI goes through the existing reserve-then-settle budget and prompt cache.
- Colour is never used alone.
- Tests cover the data logic.

### Phase A: structure and trust (full detail)

**A0. Groundwork**
- **Feature flags:**
  - New table `app_flag(key, enabled, note, updated_at)`. `api.meta` returns `flags`; the client reads them with `useFlag(key)`. SQL functions that serve flagged data check `api._flag(key)`.
  - Phase A flags: `kg.properties`, `kg.relations`, `kg.provenance`, `kg.history`, `kg.schema_map`.
  - Defaults: on for the test link; on the website, on only after the owner approves the phase (see question 3).
- **Reversible migrations:**
  - Phase A adds 0021–0025, each with a down file.
  - New pytest `test_migrations_reversible` (up → down → up, with the seed loading after each step).
- **Single source for the schema:** `backend/src/worldgraph/schema/types.yaml` defines node types, their properties and relation types. `wg schema sql` writes the registry inserts into the migration, `wg seed check` validates sample data against the YAML, and a test checks that the YAML matches the database.

**A1. Node types with properties (migration 0021)**
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

**How to try Phase A:** Settings → Sample data On. Then:
- open `#entity=` on a curated company and check its property chips and grouped links;
- tap any graph link and open "Why is this here?";
- use Graph → Schema;
- run the as-of tests.

**Rough size:** 30–45 L tokens. Order: A0 and A1/A2 database work (one agent, because migrations run in order), then A3 and A4 database work, then the screens split by area.

### Phase B: lenses (outline)
- **B1. Focus mode:**
  - Tapping a node re-centres it (the panel opens from a button). The graph scope joins back/forward history.
  - Relation and direction filters come from A2. Pinning uses fixed positions.
  - Neighbours are prefetched on hover to stay under 300 ms.
- **B2. Semantic zoom:**
  - A pipeline job computes 2–3 levels of communities with networkx Louvain. That library is BSD-licensed; the usual Leiden package is GPL, so it's avoided.
  - New tables `cluster` and `cluster_member`. Cluster labels come from top members, with an optional cached AI label.
  - Needs a WebGL renderer: sigma.js (MIT), with the layout in a web worker. This also covers E5.
- **B3. Table lens:** TanStack Table plus Virtual (MIT). Filters are shared with the graph. Only fields the user owns can be edited inline.
- **B4. Canvas:**
  - Boards built with React Flow (already used).
  - Cards are live references to nodes. Drawing a line creates a personal link, with a relation picker.
  - Boards are stored per viewer.
- **B5. Timeline:** a zoomable timeline for events and relationship periods. The time range is shared with the other lenses.
- **B6. Globe link:** "Show on globe" for any selection. A globe region selection filters the graph. One shared selection.
- **B7. Saved lenses:** stored per viewer and listed in a sidebar. A read-only share link carries the lens in the URL, so it opens with fresh data and needs no server.

### Phase C: cause and effect (outline)
- **C0. Influence graph** (Claude's suggestion, see question 4):
  - Roll story-level causal links up to the entities they're about, for example crude oil → shipping costs (+), seen 37 times in 90 days, last seen 2 days ago.
  - Keep these totals when stories are pruned, so lasting knowledge builds up.
  - Loops and what-if run on this graph.
- **C1. Feedback loops:**
  - A bounded cycle search (length up to 6) over signed links, precomputed by the pipeline into `causal_loop`. An even number of "−" links means reinforcing; odd means balancing.
  - Loops appear as chips on entity, story and cascade views.
- **C2. What-if:**
  - Spreads sign × strength with a fade at each step, up to 4 steps, reusing the fading from `api.affects`.
  - Results reuse the "Affects you" rendering and are labelled "Scenario, not a forecast".
- **C3. Guided stories:** a sequence of focus views, each with a one-line caption, played step by step or shared as a read-only link.

### Phase D: AI helpers (outline)
- **D1. Add from documents:**
  - Paste text or a PDF (read in the browser with pdf.js). Links are fetched on the website only, because the test link has no network.
  - Matching uses names, aliases and trigrams; free local entity embeddings come from the pipeline.
  - Everything lands in a per-viewer review queue.
- **D2. Ask the graph:** answers cite nodes and links as well as stories; cited items are highlighted in the current lens; "not enough evidence" stays.
- **D3. Insights:** SQL checks for unsourced or low-confidence links, links of opposite sign between the same pair, weakly linked clusters, and items not updated for a set time.
- **D4. Suggested links:** from co-occurrence plus local embeddings, hidden unless "Suggestions" is on. One tap to accept with a relation.
- **D5. Summaries and mind maps:** cached by a hash of the underlying content and regenerated only when it changes.

### Phase E: convenience (outline)
- **E1.** The command palette also searches properties, and gains commands: focus on, open lens, show on globe, add note.
- **E2.** A time slider using A4.
- **E3.** Quick capture: a "+" button anywhere. Voice notes use the browser's free speech recognition and go to the D1 queue.
- **E4.** Import an Obsidian vault (zip, read in the browser) into the personal graph. Export to Markdown, CSV, JSON or GraphML (on the test link through the downloads capability).
- **E5.** Performance: the B2 renderer, virtual lists and on-demand neighbourhoods.
- **E6.** A list or table version of every lens, plus keyboard moves between nodes.
- **E7.** Flag a problem: website flags go through a narrow, rate-limited function; the owner reviews them on the test link.

**Suggested order:** A → C0 → B1, B3 → C1, C2 → B2 (with the renderer switch) → D1–D3 → the rest.

# Progress log

Newest entries first. Each entry says what changed, how it was checked, and what's next, so any new session can pick up from here.

## Current status

- **Done:** the app (globe, stories and cascades, graph and entity pages, forecasts, business view, Ask, brief), the live pipeline on Supabase every 15 minutes, the website (https://worldgraph-kuq2.netlify.app, deploys on `[deploy]` commits) and the claude.ai test link. **Phase A (structure and trust) is built** and waiting for the owner's review.
- **Next:** the owner's Phase A review, then Phase K (the AI clock; needs a Claude API key) per PLAN.md.
- **Waiting on the owner:** the Phase A review; a Claude API key before Phase K; Supabase Pro during Phase K; the domain at Phase L.

## Resume here

See `CHECKPOINT.md` for the live state and resume steps.

## Log

### 30 Oct–1 Nov 2026: Phase A screens (A1–A7), Phase A complete
- Entity pages: key-fact chips from typed properties; links grouped by relation, each with "Why is this here?".
- Graph: relation, property and direction filters; named, tappable links; one minimum confidence shared with the cascade and globe; Graph → Schema view; a "Day to show" (as-of) control with an As-of banner; the trust look (thickness = strength, opacity = confidence, "?" for weak items) with one legend.
- "Why is this here?" sheet (`api.provenance`) from entity pages, graph links, the cascade's evidence and globe arc cards; it names who added an item, its sources, how sure and how it is known.
- Personal undo and redo (last 50, per viewer) for notes, business profile, watchlist and alerts.
- Fixes from the e2e suite: phone sheet taps and Escape, phone sheet reaches full height, globe turns after Home from another screen, status pill follows Sample data, loading regions announced, test-link connector errors, "business day" wording; unused h3-js and deck.gl aggregation layers removed.
- Checks on main: lint, typecheck, 1,268 unit tests, build, full e2e 343 passed (website and test link, desktop and phone). Test link v6 with live news of 1 Nov; website deployed.
- Progress saver: saves every 2 minutes; loss reports show work and tokens saved and lost; token-efficiency rules in the skill.

### 29 Oct 2026: Phase A, part 2 (A3–A5 database, pipeline and API)
- Migration 0023 (sources on everything): `source_id`, `confidence`, `kind`, `created_by` on nodes and edges (NOT NULL source and creator, backfilled: Natural Earth, WorldGraph curated, the story's feed, the forecast's provider, `ai:<model>`, sample), `updated_at` on links, evidence for edges and nodes, `api.provenance`, `weak` on graph, cascade and connection links. The pipeline, the forecast sync, `api.save_analysis` and the seed loader set them.
- Migration 0024 (history and "as of"): append-only `history.change_log` with per-story mentions rows and changed-keys `before`, a baseline snapshot, 90-day retention from the prune job, `wg history show/revert/prune`, `api.graph_as_of` and `api.local_graph_as_of` through views the live graph functions share; links outside their valid dates leave the graph.
- Migration 0025 (schema map): property coverage and each type's biggest relations in `api.schema`; counts follow the graph.
- Checked on a production-scale database (main's 0022 with sample data, live-style news, forecasts and AI analysis, plus 5,000 stories, 32,000 articles and 38,000 edges): 0023 applies in about 2.5 s, 0024 in about 2.5 s (baseline 23,600 rows, 15 MB); live graph timings close to before on a noisy machine (api.graph 0.40–0.57 s against 0.37–0.47 s, local graph 26–46 ms against 28–33 ms); as-of about 1–2 s; up, down and up again with writes at each head.
- Change-log volume: about 4 rows and 2 KB over a pipeline story's life, 8 rows and 4.7 KB when AI analysis rewrites it; at 300–1,000 new stories a day that is 1,300–5,000 rows and 0.7–2.3 MB a day, so 70–210 MB at the 90-day steady state (`history.info.keep_days` can go down to 30 if the free database fills).
- Next: the screens (Why is this here? sheet, ? badges, time slider, schema view), personal undo/redo.

### 28 Oct 2026: Phase A, part 1 (A0–A2 database, pipeline and API)
- Migrations 0021 (feature flags, `node_type`, `node.properties` with a validating trigger and backfill) and 0022 (`relation_type`, edge endpoint rules, causal polarity, strength and delay, and the api: properties, connections, `where`, `relations`, `direction`, `api.schema`). Each has a down file; `wg db down` undoes them.
- One schema source, `backend/src/worldgraph/schema/types.yaml`: `wg schema sql` prints the registry upserts, `wg seed check` validates the sample data against it, tests check the database matches it, and `wg kg review` writes `docs/kg-review.md`.
- Checked on a database built with main's code (0020, sample data, pipeline news, a forecast, AI analysis, 4,600 extra stories and 35,000 links): both migrations apply in under a second, the sample data reloads, the pipeline and `api.save_analysis` write again, and the api answers in 50–160 ms. `test_migrations_reversible` runs up, down and up with live-style writes at each head.
- Next: the screens (property chips, grouped connections, property and relation filters, the schema map), then A3–A5.

### 22 Oct 2026: website live, QA round 4 fixed, test link v3
- Website https://worldgraph-kuq2.netlify.app is live on real data (read-only wg_web login, verified TLS, noindex) and auto-deploys from main.
- QA round 4: all 43 findings fixed (AI budget reserve-then-settle, allow-list gating, India-view names, sample labels everywhere, forecast facts, cascade framing, phone layout, read-only shared data on the test link). Migrations 0015-0020.
- Owner decision: live news by default (Sample data off); sample data is removed at the commercial launch.
- The test link ships a real-news snapshot (`npm run snapshot:live`) and was republished as v3. 1059 frontend and 488 backend tests pass.

### 21-22 Oct 2026: owner requests and the a11y fixes, test link v2
- Ask is a chat thread with follow-ups (history sent to both AI engines and the website function). The globe turns slowly after Home or 30 s idle and stops on any input. The logo is Home on every screen size.
- A11y and design: focus moves into panels and search and back to the opener; the phone status pill sits in the header; graph key and keyboard order; cascade text at least 12 px; 40 px taps; favicon; forecast empty state and ForecastRow wrap; the minute clock catches up.
- Test link republished as version 2: https://claude.ai/artifact/XfUP7NoqKsf471epDNFRJN. 935 frontend tests pass.

### 19 Oct 2026: test link published
- Merged QA fix run 1 (backend + shell): 14 correctness findings fixed, plus `analysed`/`truncated` on api.globe. 850 frontend tests, 451 backend tests pass. Migrations 0010-0013 apply on the next pipeline run.
- Published the test link: https://claude.ai/artifact/XfUP7NoqKsf471epDNFRJN (mcp Supabase execute_sql, sample, db, user).
- Left for next week: the a11y/design, rules, security and polish reviews; finish e2e tests; favicon; ForecastRow wrap; forecasts empty state; globe minute clock.

### 8 Oct 2026: UI kit, test-link plumbing, screens under way

- **UI kit** merged: tokens with a contrast and colour-blindness tested palette (both themes), icons and meaning helpers, primitives, and domain components (story card, forecast row, probability ring and bar, KPI tile, charts, states, sources), all shown in `DesignPreview`.
- **Test link and website plumbing** merged:
  - the AI engines (your Claude account on the test link; the Claude API on the website);
  - on-use analysis of new stories (owner only, at most 3 batches, validated before saving);
  - the connector "needs approval" flow, and deep links in the URL hash;
  - the artifact build (9.1 MB, 51 files) and a sample snapshot;
  - Netlify functions with the US$2/day budget check (not deployed).
- **First frame:** the test link shows the bundled sample after about 0.3 s while the connector starts, with times moved forward to now.
- **Shared fixes:** Button on design tokens, full-strength focus ring, and separate dev-server caches for parallel agents.
- **Supabase:** the `ops` helpers are hardened (fixed search_path, no public execute).
- **README** for the owner, including how to switch on live news.
- **Checks:** 185 frontend tests, lint, types and builds pass.
- **Screens:** being built by 7 agents (see `CHECKPOINT.md`). Interrupted once by a session limit; resumed after the reset.

### 7 Oct 2026: live pipeline, AI job, CI

- **Pipeline** (`backend/src/worldgraph/pipeline/`), run by `wg pipeline run`:
  - GDELT GKG every 15 minutes (HTTPS), with GDELT's FIPS/GeoNames place codes mapped to our regions (`wg geo fips`, 4,994 state codes; 91% of GDELT state mentions map directly, the rest fall back to the nearest big city or state);
  - 22 business and official feeds (BBC, Guardian, DW, CNBC, Nikkei Asia, Straits Times, CNA, SCMP, Dawn, allAfrica, MercoPress, Economic Times, Mint, BusinessLine, Al Jazeera, The National, Africanews, Japan Times, Fed, ECB, RBI, WTO, EIA), with ETags and a seen-list so unchanged feeds cost nothing;
  - USGS earthquakes (M6+ or PAGER alerts) and GDACS orange/red alerts as hazard stories;
  - rules-based relevance (headline must contain business words; sport, crime and celebrity are dropped), sectors, event types and entity matching;
  - multilingual embeddings (paraphrase-multilingual-mpnet-base-v2) and clustering: same story at similarity 0.72, or 0.62 with the same country or entity, or 0.55 with both; new items join live stories from the last 72 hours through pgvector;
  - lone weak GDELT items are dropped; stories arrive as "pending" drafts until AI analysis;
  - Manifold forecasts hourly (business topics, 15+ forecasters, no personal/sport/betting-platform questions, no past years), with a 30-day history backfill; Polymarket adapter built but off;
  - retention: single-source drafts after 36 h, embeddings after 3 days, stories after 14 days unless important.
- **AI job** (`pipeline/analysis.py`): website only, runs when `ANTHROPIC_API_KEY` is set. Claude Opus 5.5 at low effort with structured output, every call logged with its cost in `llm_usage`, stops at 75% of the US$2/day budget (the rest is for Ask). Stories judged not to be business news are marked "skipped".
- **Prompts** (`prompts/`): analysis, Ask and projection prompts with output schemas, shared by the test link (owner's Claude account) and the website.
- **Frontend shared modules:** AI engine interface and output schemas (`src/ai/`), per-viewer storage (`src/platform/storage.ts`: artifact `db`, else localStorage).
- **CI** (`.github/workflows/ci.yml`): backend (PostGIS + pgvector, ruff, pytest) and frontend (lint, types, tests, build). **Live data** (`pipeline.yml`): every 15 minutes, skips politely until `DATABASE_URL` is set.
- **Supabase:** migrations applied through the checksum-verified GitHub fetch; sample data loaded from the `seed-data` branch (11 SQL chunks); pg_cron runs the sample clock every 30 minutes. 0005's search no longer sets a per-function trigram threshold (Supabase refuses it).
- **Checks:** 295 backend tests pass (23 new pipeline tests, no network needed); frontend lint, types, tests and build pass. Live runs against a local database: 344 items → 226 stories in 26 s; incremental runs join existing stories.
- **Sources:** GDELT (any use with citation), USGS (public domain), GDACS (disclaimers; licence to confirm), feeds (fine for the private test link; check terms before a public launch) and Manifold (API integrations allowed; ask before commercial use) recorded in `SOURCES.md`.

### 6–7 Oct 2026: foundation, content and API

- Switched the frontend to Vite + React + TypeScript so one codebase builds both the claude.ai test link and the website.
- API contract (`frontend/src/api/contract.ts`, exported to `contracts/`), schema v2 (regions, analysis state, forecast providers with country gating) and the seed engine.
- Gazetteer from Natural Earth: 237 countries, 4,479 states and provinces, 600 cities.
- 21 storylines of sample data across all sectors and continents, plus 163 KPI series.
- API functions: meta, globe, top, region, compare, brief (0004); story, cascade, entity, graph, local graph, search (0005), each with contract and behaviour tests.

### 6 Oct 2026: Phase 0 started

- Brief saved word for word as `BUILD_BRIEF.md`.
- Questions answered: separate repo, Supabase now, a global audience, sample data across all sectors.
- `PLAN.md` written and approved, with one change: WorldGraph is a **global** app (every country drills to states and cities; everyone sees the same information, except legally gated real-money odds).
- Supabase project `worldgraph` created (free plan, Mumbai `ap-south-1`, ref `xmznnjpflimsjvwftxpa`).
- Repo hygiene files: `.gitignore`, `.gitattributes`, `.editorconfig`, `.env.example`, `CLAUDE.md`, `SOURCES.md` and this log.

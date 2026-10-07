# Progress log

Newest entries first. Each entry says what changed, how it was checked, and what's next, so any new session can pick up from here.

## Current status

- **Done:** data model and API (Postgres functions), sample data (21 storylines, 230 stories, 31 forecasts, 163 KPI series), the live pipeline (news, hazards, forecasts, retention, website AI job), CI and the 15-minute workflow, shared AI prompts. Supabase has the schema (migrations 0001–0005, 0007, 0008), the sample data and a 30-minute sample clock.
- **In progress:** forecast/business/AI SQL functions (0006), map shapes (TopoJSON), the UI kit.
- **Next:** the screens (globe, region, story and cascade, graph and entities, forecasts, My Business, Ask, brief, search, settings), the claude.ai test link, end-to-end tests and a review pass.
- **Waiting on the owner:**
  - add the GitHub secret `DATABASE_URL` (Supabase "Session pooler" URI) to switch on the 15-minute live data;
  - the leftover `worldgraph` branch in `amanakbar65/Others` can be deleted (the integration couldn't).
- **Before a public launch (owner decisions):** feed and Manifold terms for commercial use, the GDACS reuse licence, an Anthropic API key and budget, and the go-ahead to deploy on Netlify.

## Resume here (saved 7 Oct 2026, 22:27 UTC, before a usage-limit pause)

Work in flight when paused, and how to pick it up:

1. **Agents that were running** (workflow run `wf_2e661656-b6f`, script `worldgraph-content-api-wf_e02d89e8-b5a.js` in the session's `workflows/scripts/`):
   - `sql:forecasts-business-ai`: migration 0006 (forecasts, forecast, affects, opportunities, ask_context, pending_analysis, save_analysis with `skipped`, and a faster `api.forecast_card`). Partial work is on branch **`wip/sql-forecasts-business-ai`** (one file, about 1,700 lines, untested).
   - `map-assets`: `wg geo assets` builder, TopoJSON in `frontend/public/geo/`, `frontend/src/lib/geo.ts`. Partial work is on branch **`wip/map-assets`**.
   - `ui-kit`: not started yet.
   - If the run finished, merge its branches (`worktree-wf_2e661656-b6f-*`). If not, relaunch it with `args.done` set to the six storyline/indicator labels plus `sql:map-region-brief` and `sql:story-graph-search`, and tell the two agents to start from their `wip/` branch.
   - Push `main` first: worktrees branch from `origin/main`.
2. **After merging 0006:** run the full backend suite. Its save_analysis tests may expect `analysis_status = 'skipped'`; migration 0009 now deletes skipped stories (by design), so adjust those tests. Apply 0006 to Supabase with `ops.apply_migration` (commit-SHA URL + md5). Check it doesn't use `set pg_trgm.similarity_threshold` (Supabase refuses it).
3. **Then launch the screens build:** script `worldgraph-screens.js` in the same `workflows/scripts/` folder (8 agents: globe, ai-artifact-web, story-cascade, region, forecasts, business, graph-entity, ask-brief-search-settings). Needs the UI kit and map assets merged first.
4. **Then:** QA (Playwright E2E, adversarial review), build the artifact (`npm run build:artifact`), publish the test link, update README and this log.

Supabase state: migrations 0001–0005, 0007–0009 applied; sample data loaded; pg_cron sample clock every 30 minutes.

## Log

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

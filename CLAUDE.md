# WorldGraph — notes for Claude

A visual world-knowledge app for businesses: a globe, a knowledge graph, cascades and crowd forecasts.

- **Start here after any pause:** `CHECKPOINT.md` (live state, what's in flight, how to resume). Keep it current at every milestone.
- **Plan (source of truth):** `PLAN.md`. The original brief, `BUILD_BRIEF.md`, is kept word for word; PLAN.md overrides it where they differ.
- **Log:** `PROGRESS.md`. Read it first; update it after each meaningful step.
- **Data sources and their terms:** `SOURCES.md`. Add a row *before* integrating a source.
- The owner has handed the build to Claude: decide and build. Ask only about money, accounts, deploying, or legal matters.

## Layout

```
backend/                 Python 3.12 (uv): DB migrations, the api.* SQL layer, sample data, pipeline
  src/worldgraph/
    db/migrations/       NNNN_name.sql, applied in order (api.* functions live here too); down/ undoes 0021 on
    schema/              types.yaml: node types, their properties and relation types (the graph schema)
    seed/                sample data: entities/*.yaml, storylines/*.yaml, gazetteer.json, build + load
    geo/                 Natural Earth gazetteer + map assets builder
    pipeline/            live ingest (GDELT, RSS, USGS, GDACS), clustering, forecasts, AI job
    cli.py               the `wg` command
  tests/                 pytest (TEST_DATABASE_URL=postgresql://wg:wg@localhost:5432/postgres)
frontend/                Vite + React + TypeScript SPA (runs as a claude.ai Artifact and on Netlify)
  src/api/               contract.ts (response types), data sources (connector, http, static)
  src/ai/                AI engines (artifact `sample`, http)
  src/features/<screen>/ one folder per screen
  src/components/ui/     shared UI kit
prompts/                 shared AI prompts + JSON output schemas (used by both engines)
frontend/netlify/        Netlify functions (website mode; not deployed until the owner says)
orchestration/           multi-agent build scripts and the progress saver (checkpoint.sh)
.github/workflows/       CI and the 15-minute pipeline
```

## Commands

| What | Command |
| --- | --- |
| Backend tests (local PostGIS) | `cd backend && TEST_DATABASE_URL=postgresql://wg:wg@localhost:5432/postgres uv run pytest` |
| Lint and format Python | `uv run ruff check . && uv run ruff format .` |
| Apply migrations / load sample data | `uv run wg db migrate`, `uv run wg seed load` (uses DATABASE_URL) |
| Undo migrations (0021 on) | `uv run wg db down NNNN` (runs the down files, newest first) |
| Graph schema SQL / review list | `uv run wg schema sql` (paste into a new migration), `uv run wg kg review` → `docs/kg-review.md` |
| Graph history | `uv run wg history show <id>`, `uv run wg history revert <change_id>`, `uv run wg history prune` |
| Check sample data (no DB) | `uv run wg seed check` |
| Frontend dev (with the local RPC middleware) | `cd frontend && npm run dev` |
| Frontend checks | `npm run lint && npm run typecheck && npm test && npm run build` |
| Artifact bundle | `npm run build:artifact` → `frontend/dist-artifact/` |

The local Postgres in the cloud workspace starts with `pg_ctlcluster 16 main start`; the role is `wg/wg`.

## Conventions

- **Node IDs** are permanent and readable: `type:slug`, e.g. `region:in-gj`, `commodity:crude-oil`, `story:red-sea-attacks`. Wikidata QIDs go in `node.qid`, never in the ID.
- **Region IDs:** country `region:<iso2>`; state `region:<iso-3166-2>` (or `region:<iso2>-ne<id>`); city `region:<parent-suffix>.<slug>`. All lowercase.
- **Migrations:** never edit one that has been applied to Supabase (`schema_migrations` there is the record); add a new file. `api.*` functions use `create or replace`, so later migrations can redefine them. From 0021 on, every migration has a down file `db/migrations/down/NNNN_name.down.sql` (restoring any function it redefined) and must pass `test_migrations_reversible`. Merged migrations reach production on the next 15-minute run, so test them on live-style rows (`tests/live_style.py`).
- **Graph schema:** node types, their properties (text, number, date, choice, url, place, entity) and relation types (label and inverse label, endpoint types, causal, symmetric) are defined once in `backend/src/worldgraph/schema/types.yaml`. To change them: edit the YAML, run `uv run wg schema sql` and put its output in a new migration; update `contract.ts` if a shape changes. The database refuses property values that don't fit and new links whose endpoint types the relation doesn't allow; `wg seed check` applies the same rules to the sample data. Region, sector, story and forecast properties are derived from their side tables, never stored.
- **Provenance (0023):** every node and edge needs `source_id` (a `source` row) and `created_by`; causal links `created_by`. Writers name them per row (`pipeline:news`, `pipeline:forecasts`, `ai:<model>`, `curated`, `gazetteer`, `sample`), or declare them for the session with `set_config('wg.actor', …)` / `set_config('wg.source', …)`; the database refuses a row with neither. A new data source gets a `source` row (and a SOURCES.md row) first.
- **History (0024):** live nodes, edges, causal links and mentions are logged in `history.change_log` (append-only; never update or delete it, `history.prune()` does retention). The actor is `wg.actor`: the pipeline sets `pipeline:<job>`, AI analysis `ai:<model>`, the seed loader `seed`; set it in any new writer. Graph functions read `api._g_nodes/_g_stories/_g_edges/_g_links`, never the tables, so "as of" keeps working; they run with `plan_cache_mode = force_custom_plan` and `jit = off` (a plan made for the live graph must not be reused as of a date). Owner corrections: `wg history revert <change_id>`.
- **Feature flags:** `app_flag` rows; SQL checks `api._flag(key)`, the client `useFlag(key)` (`src/lib/flags.ts`; a missing flag is off). New features ship behind one.
- **API contract:** every `api.<fn>(args jsonb) returns jsonb`. The response shapes are in `frontend/src/api/contract.ts` and mirrored by the pytest contract tests. Change both together.
- **Text limits** (enforced in Pydantic or TS and in SQL): headline ≤ 12 words, so-what ≤ 20, each action ≤ 8, mechanism 2–4 words, evidence snippet = one sentence (≤ 300 characters).
- **Facts, inferences and forecasts stay visibly separate.** Causal links always carry type and confidence. Forecasts always show source, volume and last update.
- **Never store full article text.** Store only the headline, URL, source, date and at most a one-sentence snippet. No private individuals.
- **Sample data** has `is_sample = true`, is labelled "Sample data" in the UI and has no evidence URLs. Real company names appear only in true background facts.
- **Prediction markets:** information only. No trading, betting, wallets, referral links or "bet"/"trade" wording. Real-money providers are off by default, gated by viewer country and fail closed. Never link to a platform blocked for that viewer.
- **Design:**
  - Dark by default, plus a light theme. All colours are CSS tokens in `src/styles/tokens.css`.
  - Risk is amber, opportunity is teal, neutral is slate, forecasts are violet with a crowd icon and a ring shape. Colour is always paired with an icon or ▲ ▼; never red against green.
  - Use lucide icons only and at most 3 text sizes per screen. Respect reduced motion. Meet WCAG AA, and give every control an accessible label.
- **Artifact limits:** no network except our own files and capabilities, so no external tiles or fetches. State lives in memory; only bare `#token` anchors survive in the URL.
- **Python:** ruff; type hints; Pydantic at boundaries; psycopg 3 with plain SQL.
- **TypeScript:** strict; no `any` in feature code.
- **Commits:** `Area: what changed`. No Claude credit lines. Never commit secrets.

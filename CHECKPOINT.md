# Checkpoint (read this first after any pause)

The live state of the build: what's done, what's in flight, and exactly how to resume. Updated at every milestone and before any expected pause (usage limits, long agent runs). `PROGRESS.md` is the history; this file is the current state.

**Last updated:** 8 Oct 2026, 04:16 UTC (saved just before a usage-limit pause).

## How to resume (any new session)

1. `cd /home/user/worldgraph && git pull` (or clone `amanakbar65/worldgraph`), then `pg_ctlcluster 16 main start`.
2. Read this file, then `CLAUDE.md`, `PLAN.md`, and the latest `PROGRESS.md` entry.
3. Start the progress saver: `orchestration/checkpoint.sh 600 &` (it pushes agents' unfinished work to `wip/<worktree>` every 10 minutes, and pushes `main` if it is ahead).
4. Look at "In flight" below. For each item: if its agent finished, merge its branch; if not, relaunch the script named there with the `args` shown. The script tells each agent to start from its `wip/` branch.
5. Agent worktrees branch from `origin/main`: **push `main` before launching agents.**
6. Keep the working directory inside the repo while a workflow runs (worktrees fail to start outside a git repo).

## Done

| Area | Where | Notes |
| --- | --- | --- |
| Plan, brief, rules | `PLAN.md`, `BUILD_BRIEF.md`, `CLAUDE.md`, `SOURCES.md` | Global app; terms checked for GDELT, USGS, GDACS, feeds, Manifold |
| Schema and API | migrations 0001–0005, 0007–0009 | 0004 map/region/brief, 0005 story/graph/search, 0009 skipped-story cleanup |
| Sample data | `backend/src/worldgraph/seed/` | 21 storylines, 230 stories, 31 forecasts, 163 KPI series |
| Live pipeline | `backend/src/worldgraph/pipeline/` | GDELT, 22 feeds, USGS, GDACS, clustering, Manifold, retention, website AI job |
| Prompts | `prompts/` | analysis, ask, projection (+ schemas), shared by both AI engines |
| Frontend foundation | `frontend/src/{api,app,state,platform,ai}` | Contract, data sources, shell, AI interface, per-viewer storage |
| CI and live-data job | `.github/workflows/` | CI green; live data waits for the `DATABASE_URL` secret |
| Supabase | project `xmznnjpflimsjvwftxpa` | Migrations 0001–0005, 0007–0009; sample data; pg_cron sample clock every 30 min |

## In flight

Run `wf_828b324a-939` of `orchestration/worldgraph-content-api.js`. Three tasks remain:
- **map-assets:** DONE and merged into main (commit 1bb3b0d). It added `wg geo assets`, `frontend/public/geo/*` (8.4 MB, which must be included in the artifact's files) and `frontend/src/lib/geo.ts`.
- **sql:forecasts-business-ai** (worktree `-1`): was still running. Latest snapshot is on branch **`wip/wf_828b324a-939-1`** (8 files, about 3,800 lines; 0006 SQL and tests, untested). The older snapshot is `wip/sql-forecasts-business-ai`.
- **ui-kit** (worktree `-3`): had just started. Latest snapshot is on branch **`wip/wf_828b324a-939-3`**.

To resume after the pause:
1. Check `.claude/worktrees/wf_828b324a-939-*`: if an agent committed a finished result on its `worktree-…` branch, merge it.
2. Otherwise, in `orchestration/worldgraph-content-api.js`:
   - point the `RESUME` notes at `wip/wf_828b324a-939-1` (SQL) and add one for ui-kit pointing at `wip/wf_828b324a-939-3`;
   - relaunch with `{"done": [...the 8 labels below..., "map-assets"]}`.
   - The 8 labels: storylines:finance-macro, storylines:energy-climate, storylines:agri-food, storylines:industry-tech, storylines:trade-health-consumer, indicators, sql:map-region-brief, sql:story-graph-search.
3. Push main first, and restart the progress saver: `orchestration/checkpoint.sh 600 &`.
4. Map-assets concern: `tsconfig.app.json` keeps tsbuildinfo inside the shared `node_modules`, so `tsc -b` can falsely say "up to date". Use `tsc -b --force` (or move tsBuildInfoFile).

After all three are merged:
- run all checks: backend pytest with `TEST_DATABASE_URL` plus ruff; frontend lint, typecheck, test, build;
- fix the 0006 skipped tests if needed (0009 deletes skipped stories);
- apply 0006 to Supabase with `ops.apply_migration` (commit-SHA URL + md5; no per-function SET of extension settings);
- launch the screens build.

## Next

1. **Screens** (`orchestration/worldgraph-screens.js`, 8 agents): globe, ai-artifact-web (AI engines, on-use analysis, test-link build, snapshot, Netlify functions, deep links), story-cascade, region, forecasts, business, graph-entity, ask-brief-search-settings. Needs the UI kit and map assets merged first.
2. **QA:**
   - Playwright end-to-end tests on the dev server and the artifact build;
   - an adversarial review workflow (correctness, accessibility, design rules, legal rules such as no betting wording and the real-money gating);
   - fixes.
3. **Publish the test link:**
   - `npm run build:artifact`;
   - publish with the Artifact tool, with capabilities mcp (Supabase execute_sql), sample, db and user (load the artifact-capabilities skill first);
   - give the owner the link.
4. README for the owner, final `PROGRESS.md` entry.

## Waiting on the owner

- GitHub secret `DATABASE_URL` (Supabase → Connect → Session pooler URI) to switch on live data every 15 minutes.
- Optional cleanup: the old `worldgraph` branch in `amanakbar65/Others`.
- Before a public launch:
  - feed terms for commercial use;
  - Manifold commercial use;
  - GDACS licence;
  - an Anthropic API key and budget;
  - the go-ahead to deploy on Netlify.

## Gotchas learned

- Workflow concurrency is 2 (4 CPUs). Agents hit usage limits mid-run, so keep `checkpoint.sh` running and keep this file current.
- Supabase refuses function-level `SET` of extension settings (`pg_trgm.similarity_threshold`).
- `ops.run_remote_sql` only runs files from this repo's raw GitHub URLs with a matching md5; push first, use commit-SHA URLs.
- The GDELT links in `lastupdate.txt` are plain HTTP; the proxy only allows HTTPS (rewrite to https://data.gdeltproject.org).

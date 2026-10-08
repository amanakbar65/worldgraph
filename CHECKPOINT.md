# Checkpoint (read this first after any pause)

The live state of the build: what's done, what's in flight, and exactly how to resume. Updated at every milestone and before any expected pause (usage limits, long agent runs). `PROGRESS.md` is the history; this file is the current state.

**Last updated:** 8 Oct 2026, 09:35 UTC.

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

Done since the last pause:
- 0006 (forecasts, forecast, affects, opportunities, ask_context, pending_analysis, save_analysis with skipped, faster forecast_card) is merged: 142 tests, 440 backend tests in total, all passing. It is applied to Supabase.
- Map assets are merged.
- Supabase now has migrations 0001–0009.

Running now (launched 09:35 UTC; the progress saver pushes worktrees to `wip/<worktree>` every 10 minutes):
1. **ui-kit**, via `orchestration/worldgraph-content-api.js`. It resumes from `wip/wf_828b324a-939-3`. Args: `{"done": [the 8 earlier labels, "map-assets", "sql:forecasts-business-ai"]}`.
2. **ai-artifact-web** (the screens agent that doesn't need the UI kit), via `orchestration/worldgraph-screens.js`. Args: `{"done": ["globe", "story-cascade", "region", "forecasts", "business", "graph-entity", "ask-brief-search-settings"]}`.

If interrupted:
- check `git worktree list`;
- snapshot or merge what's finished;
- relaunch the same script, adding resume branches. The screens script takes `args.resume = {label: "wip/<worktree>"}`; the content script needs its `RESUME` map edited.

When both are merged, launch `orchestration/worldgraph-screens.js` with `{"done": ["ai-artifact-web"]}` for the other 7 screens.

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

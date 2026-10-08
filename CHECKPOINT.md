# Checkpoint (read this first after any pause)

The live state of the build: what's done, what's in flight, and exactly how to resume. Updated at every milestone and before any expected pause (usage limits, long agent runs). `PROGRESS.md` is the history; this file is the current state.

**Last updated:** 8 Oct 2026, 15:00 UTC (saved ahead of a usage limit).

## How to resume (any new session)

1. `cd /home/user/worldgraph && git pull` (or clone `amanakbar65/worldgraph`), then `pg_ctlcluster 16 main start`.
2. Read this file, then `CLAUDE.md`, `PLAN.md`, and the latest `PROGRESS.md` entry.
3. Start the progress saver: `orchestration/checkpoint.sh 600 &` (it pushes agents' unfinished work to `wip/<worktree>` every 10 minutes, and pushes `main` if it is ahead).
4. Look at "In flight" below. For each item: if its agent finished, merge its branch; if not, relaunch the script named there with the `args` shown. The script tells each agent to start from its `wip/` branch.
5. Agent worktrees branch from `origin/main`: **push `main` before launching agents.**
6. **`cd /home/user/worldgraph` before launching any workflow.** After a restart the shell starts in `/home/user`, and every agent then fails instantly with "not in a git repository".

## Done

| Area | Where | Notes |
| --- | --- | --- |
| Plan, brief, rules | `PLAN.md`, `BUILD_BRIEF.md`, `CLAUDE.md`, `SOURCES.md` | Global app; terms checked for GDELT, USGS, GDACS, feeds, Manifold |
| Schema and API | migrations 0001–0005, 0007–0009 | 0004 map/region/brief, 0005 story/graph/search, 0009 skipped-story cleanup |
| Sample data | `backend/src/worldgraph/seed/` | 21 storylines, 230 stories, 31 forecasts, 163 KPI series |
| Live pipeline | `backend/src/worldgraph/pipeline/` | GDELT, 22 feeds, USGS, GDACS, clustering, Manifold, retention, website AI job |
| Prompts | `prompts/` | analysis, ask, projection (+ schemas), shared by both AI engines |
| Frontend foundation | `frontend/src/{api,app,state,platform,ai}` | Contract, data sources, shell, AI interface, per-viewer storage |
| UI kit | `frontend/src/components/**`, `lib/{icons,meaning,time,links}.ts`, `styles/tokens.css` | Palette tested for contrast and colour blindness in both themes; `DesignPreview` (and `frontend/preview.html`) shows every component |
| Map assets | `frontend/public/geo/*`, `src/lib/geo.ts` | Natural Earth TopoJSON with India's official view |
| Test link and website plumbing | `src/ai/engines.ts`, `analysis-runner.ts`, `scripts/artifact-page.mjs`, `public/snapshot/`, `netlify/functions/`, `netlify.toml` | AI engines, on-use analysis, connector approval, deep links, snapshot, artifact build (9 MB, 51 files), Netlify functions (not deployed) |
| CI and live-data job | `.github/workflows/` | CI green; live data waits for the `DATABASE_URL` secret |
| Supabase | project `xmznnjpflimsjvwftxpa` | Migrations 0001–0005, 0007–0009; sample data; pg_cron sample clock every 30 min |

## In flight

**Screens:** run `wf_3516be8d-024` (`orchestration/worldgraph-screens.js`, args `{"done": ["ai-artifact-web"]}`), launched 14:24 UTC. Two agents run at a time, in the script's order: globe, story-cascade, region, forecasts, business, graph-entity, ask-brief-search-settings.

State at 15:00 UTC (each worktree is saved to its `wip/` branch every 10 minutes):

| Label | Worktree → saved to | State |
| --- | --- | --- |
| globe | `wf_3516be8d-024-1` → `wip/wf_3516be8d-024-1` | 1 WIP commit (MapLibre globe, deck.gl layers, controls, Top 5, list view) plus edits |
| story-cascade | `wf_3516be8d-024-2` → `wip/wf_3516be8d-024-2` | 3 commits (data shaping and dagre layout; story card, cascade, evidence, AI projections; render tests), likely finishing |
| region, forecasts, business, graph-entity, ask-brief-search-settings | not started | |

**If interrupted** (e.g. a usage limit):
1. `cd /home/user/worldgraph` first (worktrees fail outside the repo), then `git fetch origin` and `git worktree list`.
2. For each agent, read its report in `/root/.claude/projects/-home-user/<session>/subagents/workflows/wf_3516be8d-024/journal.jsonl`, or look at its commits. If it finished, run the checks in its worktree and `git merge --no-edit worktree-wf_3516be8d-024-<n>`.
3. Relaunch the unfinished ones: `orchestration/worldgraph-screens.js` with `args.done` = "ai-artifact-web" plus every merged label, and `args.resume` = `{"globe": "wip/wf_3516be8d-024-1", "story-cascade": "wip/wf_3516be8d-024-2"}` for whichever of those isn't merged. Labels with no worktree yet just start fresh.
4. Restart the progress saver: `orchestration/checkpoint.sh 600` in the background (it stops after 2 hours).
5. Push `main` before launching (worktrees branch from `origin/main`).

When all 7 are merged: run the frontend checks, then QA (below).

## Next

1. **QA:** `orchestration/worldgraph-qa.js` (no args): an e2e test author plus 5 reviewers (correctness, accessibility and design, product and legal rules, artifact and security, polish). Each finding is reproduced before it's reported. Triage the findings by area, then run `orchestration/worldgraph-qa-fix.js` with `args.groups = [{label, owns: [paths], findings: [...]}]`, with areas that don't overlap.
2. **Known follow-ups (from agent reports):**
   - Done: the test link's first frame now comes from the snapshot (react-query placeholders), and snapshot times move forward by the snapshot's age when it loads.
   - Website (later): raise the Netlify function timeout above 25 s for AI; set `DATABASE_CA_CERT` so TLS is verified.
3. **Publish the test link:**
   - `npm run build:artifact`; the file list is in `dist-artifact/artifact-files.json`;
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
- Dev servers in agent worktrees: `vite.config.ts` now allows the real node_modules path (fonts) and uses a per-checkout `.vite-cache`.
- `ops.run_remote_sql` only runs files from this repo's raw GitHub URLs with a matching md5; push first, use commit-SHA URLs.
- The GDELT links in `lastupdate.txt` are plain HTTP; the proxy only allows HTTPS (rewrite to https://data.gdeltproject.org).

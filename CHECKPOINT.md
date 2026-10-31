# Checkpoint (read this first after any pause)

The live state of the build: what's done, what's in flight, and exactly how to resume. Updated at every milestone and before any expected pause (usage limits, long agent runs). `PROGRESS.md` is the history; this file is the current state.

**31 Oct 07:55 UTC:** screens 2a and 2b stopped at the 30 Oct 5-hour limit with ~95% done (wip/agent-a665d35d841e3dd79: 8 bug fixes, deps removed, Why-is-this-here sheet and ? badges; wip/agent-aacad09091540c302: as-of day and personal undo/redo with unit tests). Relaunched FRESH (new worktrees, each merges its old wip first) to finish: desktop arc-card entry, e2e specs, screenshot reviews, checks. Then merge both, republish the test link, update PLAN/PROGRESS, `[deploy]` the website once (end of Phase A) and stop for review.
**30 Oct ~05:30 UTC:** screens part 1 MERGED (492cc84; lint, typecheck, 1,167 unit tests and build green). Production checked: 0023–0025 applied 29 Oct 14:30, no node or edge without a source, change log ~50–120 rows an hour, DB 178 MB. **In flight (fresh agents, worktrees agent-<id>, saved to wip/agent-<id>):** (2a) Why-is-this-here sheet from every entry point, "?" badges, the 8 e2e bugs, dep cleanup, contract comment, screenshot review of part 1 screens; (2b) as-of date control and banner in the graph (nav hash), personal undo/redo (last 50). If interrupted: relaunch FRESH with the same brief plus `git fetch origin wip/agent-<id> && git merge FETCH_HEAD`. **Then:** merge both, `wg kg review` on production, live snapshot, `npm run build:artifact`, republish the test link, one `[deploy]` commit, update PLAN/PROGRESS, stop for the owner's Phase A review.
**29 Oct:** MERGED: e2e suite (370f34a, 350 tests; 8 app bugs listed in orchestration/qa-notes/phase-a-screens-2-bugs.md) and Phase A part 2 (0023 provenance, 0024 history and as-of, 0025 schema map; 2991382), which apply to production on the next run. Still running: screens part 1. Next: screens part 2 = Why-is-this-here, weak badges, as-of view, personal undo, the 8 bugs. Owner 30 Oct: the owner tests mainly on the test link (desktop), so republish it at every merge (`node frontend/scripts/artifact-publish-plan.mjs`, then `--record`); the website gets one `[deploy]` at the end of each phase. Test link v5 (30 Oct 05:40) = screens part 1 + live snapshot. Owner 30 Oct: be token-aware wherever it's free, but never at the cost of quality, accuracy or effort. Token rule from 29 Oct: restart interrupted agents FRESH (a short brief plus the wip branch) instead of resuming long transcripts; resuming re-reads the whole history at session start. **In flight 28 Oct (Agent tool, worktrees agent-<id>, saved to wip/agent-<id>):** backend part 2 (A3 provenance 0023, A4 history and as-of 0024, A5 0025); screens part 1 (entity properties and connections, relation and property filters, polarity on links, trust visuals in the graph and cascade, shared minConfidence, schema view); e2e finisher. **Then:** screens part 2 (the Why-is-this-here sheet, weak badges, as-of, personal undo); remove the unused deps; republish; `[deploy]` the website; stop for review. **28 Oct:** Phase A part 1 (A0–A2, migrations 0021–0022) is MERGED (a40184e) and applies to production on the next pipeline run; verify `schema_migrations` has 0021 and 0022, then run `wg kg review` against production. Globe A6/A7 and minConfidence are MERGED (activity shading plus a GPU glow; HeatmapLayer didn't work on the globe, so a ScatterplotLayer glow extension is used). To do: remove the unused deps h3-js and @deck.gl/aggregation-layers AFTER the e2e branch merges; the graph and cascade should adopt `trustVisual` and the shared `minConfidence` (screens step); fix the stale comment at contract.ts ~263 (hex). **Resumed 28 Oct on the owner's approval:** the three agents (Phase A backend part 1, globe A6/A7, e2e) were resumed with SendMessage from their transcripts and worktrees.
**Last updated:** 23 Oct 2026. **Phase A approved by the owner (23 Oct)** and in progress. The roadmap (phases A, K, C, B, T, D, S, E, L) is in PLAN.md; services, costs and data are in docs/COMMERCIAL.md. **In flight (Agent tool, worktrees `agent-<id>`, saved to `wip/agent-<id>`):** (1) Phase A backend part 1 (A0 flags and schema YAML, A1 node types and properties in migration 0021, A2 relations in 0022); (2) globe A7 heat map (hex bins replaced by country activity fill plus a HeatmapLayer glow), A6 trust visuals on arcs, shared minConfidence in nav; (3) the e2e finisher (`wip/agent-a77a20ba8b48c074c`). **Next:** backend part 2 (A3 provenance 0023, A4 history and as-of 0024, A5 api.schema 0025), then the screens (entity page properties and connections, the 'Why is this here?' sheet, graph filters and tappable links, schema view, trust visuals on graph and cascade, personal undo/redo). Merge, then republish the test link (and `[deploy]` the website once). Then stop for the owner's review. Owner decisions 23 Oct: worldgraph.com is a premium name (~₹4.7 lakh), so the domain waits (rename or a cheap alternative at Phase L); the repo should be private (the owner flips it; the pipeline schedule or host must change first, see below). Owner to-dos: a Claude API key before Phase K; Supabase Pro during Phase K.

**Website deploys only on purpose:** put `[deploy]` in the message of a commit that changes served files (netlify.toml ignore rule). Each deploy costs 15 Netlify credits; the free plan has 300 a month and the site pauses at the cap; about 14 deploys were used by 23 Oct. Website: https://worldgraph-kuq2.netlify.app (auto-builds from main).

## How to resume (any new session)

1. `cd /home/user/worldgraph && git pull` (or clone `amanakbar65/worldgraph`), then `pg_ctlcluster 16 main start`.
2. Read this file, then `CLAUDE.md`, `PLAN.md`, and the latest `PROGRESS.md` entry.
3. Run `orchestration/status.sh`; if the saver is STOPPED, start it: `setsid nohup .claude/skills/progress-saver/checkpoint.sh 120 12 >/dev/null 2>&1 </dev/null &`. The saver, status and loss report now live in the reusable skill `.claude/skills/progress-saver/`.
   **After any usage limit or restart, first tell the owner how much was retained vs lost:** `python3 .claude/skills/progress-saver/loss-report.py <run dir>` for each interrupted workflow run (per agent and total, in %), then record it in the "Loss log" below.
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

## Website (Netlify), 22 Oct
The owner approved deploying. Project `worldgraph-kuq2` (site id `7ab098b6-0af0-4e4e-bed4-e7b608301c41`), https://worldgraph-kuq2.netlify.app. Team login is required on previews only; production is open.
Migration 0014 (role `wg_web_reader`) is applied. The auto-mode classifier blocked me from generating the password and from uploading the repo with the Netlify CLI, so **the owner does 3 steps:**
(B) In the Supabase SQL editor: `create role wg_web login password '...' in role wg_web_reader;`
(C) In Netlify, the env var `DATABASE_URL` (secret) = the transaction pooler URI with user `wg_web.xmznnjpflimsjvwftxpa`.
(A) Link the GitHub repo in Netlify, which auto-deploys `main`.
Then verify: `curl -s https://worldgraph-kuq2.netlify.app/api/rpc` with the meta call. AI stays off until `ANTHROPIC_API_KEY` is set (with the $2/day cap, `WG_AI_DAILY_BUDGET_USD`).

## In flight

Nothing is running. Main has all 8 screens plus QA fix run 1 (850 frontend + 451 backend tests pass). Live data comes in every 15 minutes (2,578 live stories on 19 Oct). Migrations 0010-0013 are applied by the next pipeline run (`wg db migrate`). Check with `select version from schema_migrations order by version desc limit 4`.

**To republish the test link:** `cd frontend && npm run build:artifact`, then use the Artifact tool with url https://claude.ai/artifact/XfUP7NoqKsf471epDNFRJN, file `dist-artifact/index.html`, `root` dist-artifact, and every path in `dist-artifact/artifact-files.json` as `files`. Omit capabilities to keep them.

**QA left (next week):** rerun `orchestration/worldgraph-qa.js` with
`{"only":["e2e","review:a11y-design","review:rules","review:artifact-security","review:polish"],"resume":{"e2e":"wip/wf_5401d9b0-dd2-1"}}`. The a11y reviewer's notes were recovered into `orchestration/qa-notes/review-a11y-design-run3.md`: 4 findings plus the passing checks. Run it again only for the 4 unfinished checks listed there.
Then fix the remaining items with `worldgraph-qa-fix.js`: the shell agent did not reach the globe minute clock, the forecasts empty state, the favicon and the ForecastRow wrap at 352 px.

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

- Done: `DATABASE_URL` is set and live data works.
- Done (15 Oct): the GitHub token is in Vault. pg_cron `wg-live-data` starts the Live data job every 15 minutes; runs at 11:15, 11:30 and 11:45 all succeeded.
- Optional cleanup: the old `worldgraph` branch in `amanakbar65/Others`.
- Before a public launch:
  - feed terms for commercial use;
  - Manifold commercial use;
  - GDACS licence;
  - an Anthropic API key and budget;
  - the go-ahead to deploy on Netlify.

## Loss log (retained vs lost after interruptions)

| When | Run | Spent / saved | Retained | Lost | Notes (from 31 Oct: work and tokens) |
| --- | --- | --- | --- | --- | --- |
| 30 Oct ~05:52 UTC limit (previous session only) | screens 2a (provenance, bugs), 2b (as-of, undo) | work 97% saved, 3% lost | tokens 11.0 L, 96% on saved work, 0.4 L lost | 2a: 100% (3 commits, 1,851 lines); 2b: 95% (2 commits, 2,295 of 2,427 lines; lost = a 132-line screenshot script). Lost: 12 test and screenshot commands, rerun by the fresh agents. Main session: all pushed |
| 29 Oct ~14:10 UTC limit (previous session only) | screens 1, backend 2, e2e | ~26.7 L | ~60% | ~40% | screens 1: ~16.5 L, ~35% kept (code all saved at 14:02; lost = final screenshot checks); backend 2 and e2e finished and merged (100%). 49 saves, 0 failures. Screens finished by a fresh agent, not resumed |
| 15 Oct 11:50 UTC limit | QA `wf_fe3c223c-34c` | 7.8 L | 45% | 55% | e2e 100% kept (1,167 lines of tests); correctness reviewer 0% kept (notes were in an ignored folder). Its 2 findings were rescued by hand from its transcript into `orchestration/qa-notes/`. The saver now keeps notes files. |
| 29 Oct ~07:45 UTC limit | backend 2, screens 1, e2e (lifetime) | 96.7 L | 86% | 14% | screens 100%; backend 2 86% (0024 kept on disk and in wip); e2e 84% (final runs) |
| 28 Oct 15:50 UTC limit | Phase A backend 2, screens 1, e2e (lifetime) | 68.2 L | 89% | 11% | screens 98%; e2e 94%; backend 2: 0% on GitHub (it was still reading; transcript intact, resumed) |
| 23 Oct ~14:30 UTC limit | Phase A backend 1, globe A6/A7, e2e (lifetime totals) | 68.6 L | 78% | 22% | backend 97% (saved 14:17); globe 68% (code saved 14:02, later debugging scripts unsaved); e2e 77% (saved 13:47) |
| 23 Oct 09:40 UTC limit | Phase A backend 1, globe A6/A7, e2e (Agent tool) | 38.6 L | 76% | 24% | backend 1: 0% on GitHub (transcript intact, resumed); globe 99%; e2e 78% |
| 22 Oct 22:40 UTC limit | e2e agent + 2 research agents (Agent tool) | 17.5 L | 87% | 13% | e2e 99% (wip/agent-a77a20ba8b48c074c); research 0% on GitHub but transcripts intact, so resumed |
| 22 Oct 14:40 UTC limit | final `wf_8041ad46-903` | 16.4 L | 79% | 21% | snapshot 100% (merged); e2e 73% on `wip/wf_8041ad46-903-2` |
| 22 Oct 07:50 UTC limit | QA `wf_1734d928-feb` | 39.9 L | 81% | 19% | 3 reviews finished (43 findings saved); e2e 71% kept on `wip/wf_1734d928-feb-1` |
| 21 Oct 17:30 UTC limit | fixes `wf_c203058a-8f7` (a11y) | 4.4 L | 96% | 4% | all 12 commits plus the WIP snapshot merged |
| 15 Oct 21:50 UTC limit | QA `wf_5401d9b0-dd2` + fixes `wf_46134b48-10a` | 15.8 L | 54% | 46% | Fixers 99% kept and merged; e2e 50%; a11y reviewer 0% (notes unsaved). |
| 15 Oct 12:45 UTC limit | QA `wf_4ef20849-b70` | 10.5 L | 93% | 7% | correctness finished (100%); e2e 87% kept on `wip/wf_4ef20849-b70-1`. The other 4 reviewers had not started. |

## Gotchas learned

- Workflow concurrency is 2 (4 CPUs). Agents hit usage limits mid-run (session limits about every 5 hours, plus a weekly limit). Agents now push their own commits to `wip/<worktree>`, and the detached saver covers uncommitted work. Keep this file current at every merge.
- Supabase refuses function-level `SET` of extension settings (`pg_trgm.similarity_threshold`).
- Dev servers in agent worktrees: `vite.config.ts` now allows the real node_modules path (fonts) and uses a per-checkout `.vite-cache`.
- `ops.run_remote_sql` only runs files from this repo's raw GitHub URLs with a matching md5; push first, use commit-SHA URLs.
- The GDELT links in `lastupdate.txt` are plain HTTP; the proxy only allows HTTPS (rewrite to https://data.gdeltproject.org).

# Checkpoint (read this first after any pause)

The live state of the build: what's done, what's in flight, and exactly how to resume. Updated at every milestone and before any expected pause (usage limits, long agent runs). `PROGRESS.md` is the history; this file is the current state.

**Last updated:** 22 Oct 2026. Test link https://claude.ai/artifact/XfUP7NoqKsf471epDNFRJN is **version 2** (Ask chat, globe idle turn, logo as Home, the a11y and design fixes, favicon). Nothing is in flight. 935 frontend tests pass. **Next:** the 3 reviews never run (rules, artifact-security, polish), finish the e2e suite (`wip/wf_5401d9b0-dd2-1`, about 50%; it must cover the new Ask chat and focus behaviour), then one fix round and a republish.

## How to resume (any new session)

1. `cd /home/user/worldgraph && git pull` (or clone `amanakbar65/worldgraph`), then `pg_ctlcluster 16 main start`.
2. Read this file, then `CLAUDE.md`, `PLAN.md`, and the latest `PROGRESS.md` entry.
3. Run `orchestration/status.sh`; if the saver is STOPPED, start it: `setsid nohup .claude/skills/progress-saver/checkpoint.sh 600 12 >/dev/null 2>&1 </dev/null &`. The saver, status and loss report now live in the reusable skill `.claude/skills/progress-saver/`.
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

| When | Run | Spent | Retained | Lost | Notes |
| --- | --- | --- | --- | --- | --- |
| 15 Oct 11:50 UTC limit | QA `wf_fe3c223c-34c` | 7.8 L | 45% | 55% | e2e 100% kept (1,167 lines of tests); correctness reviewer 0% kept (notes were in an ignored folder). Its 2 findings were rescued by hand from its transcript into `orchestration/qa-notes/`. The saver now keeps notes files. |
| 21 Oct 17:30 UTC limit | fixes `wf_c203058a-8f7` (a11y) | 4.4 L | 96% | 4% | all 12 commits plus the WIP snapshot merged |
| 15 Oct 21:50 UTC limit | QA `wf_5401d9b0-dd2` + fixes `wf_46134b48-10a` | 15.8 L | 54% | 46% | Fixers 99% kept and merged; e2e 50%; a11y reviewer 0% (notes unsaved). |
| 15 Oct 12:45 UTC limit | QA `wf_4ef20849-b70` | 10.5 L | 93% | 7% | correctness finished (100%); e2e 87% kept on `wip/wf_4ef20849-b70-1`. The other 4 reviewers had not started. |

## Gotchas learned

- Workflow concurrency is 2 (4 CPUs). Agents hit usage limits mid-run (session limits about every 5 hours, plus a weekly limit). Agents now push their own commits to `wip/<worktree>`, and the detached saver covers uncommitted work. Keep this file current at every merge.
- Supabase refuses function-level `SET` of extension settings (`pg_trgm.similarity_threshold`).
- Dev servers in agent worktrees: `vite.config.ts` now allows the real node_modules path (fonts) and uses a per-checkout `.vite-cache`.
- `ops.run_remote_sql` only runs files from this repo's raw GitHub URLs with a matching md5; push first, use commit-SHA URLs.
- The GDELT links in `lastupdate.txt` are plain HTTP; the proxy only allows HTTPS (rewrite to https://data.gdeltproject.org).

export const meta = {
  name: 'worldgraph-final',
  description: 'Real-news snapshot for the test link, then finish the end-to-end suite against the fixed app',
  phases: [{ title: 'Snapshot', detail: 'real-news first frame and fallback' }, { title: 'E2E', detail: 'merge and make the suite green' }],
}

const ENV = `
Environment
- You are in an isolated git worktree at current main. Read CLAUDE.md first.
- node_modules is NOT in your worktree: run \`ln -sfn /home/user/worldgraph/frontend/node_modules frontend/node_modules\`. Never run npm install.
- Your own database: \`psql postgresql://wg:wg@localhost:5432/postgres -c "drop database if exists DB" -c "create database DB"\`, then \`cd backend && uv sync && DATABASE_URL=postgresql://wg:wg@localhost:5432/DB uv run wg db migrate && DATABASE_URL=postgresql://wg:wg@localhost:5432/DB uv run wg seed load\` (\`pg_ctlcluster 16 main start\` if Postgres is down). Add live (is_sample = false) rows yourself when you need live data.
- Dev server (website mode): \`cd frontend && DEV_DATABASE_URL=postgresql://wg:wg@localhost:5432/DB npx vite --port PORT --strictPort &\`. Artifact build: \`npm run build:artifact\`, served with \`npx vite preview --outDir dist-artifact --port PORT2 --strictPort &\`. Playwright Chromium at '/opt/pw-browsers/chromium'; screenshots under frontend/test-results/LABEL/ (git-ignored); LOOK at them. Stop your servers when done.
- Commit as you go (\`git add -A && git commit -m "Area: what changed"\`, no trailers; never commit test-results/), and after every commit run \`git push -q -f origin HEAD:refs/heads/wip/$(basename "$(git rev-parse --show-toplevel)")\`: usage limits can stop you without warning.
- Checks before you finish (all must pass): \`cd frontend && npx tsc -b --force --noEmit && npx eslint . && npx vitest run && npx vite build && npm run build:artifact\`.
`

const SCHEMA = {
  type: 'object',
  properties: {
    branch: { type: 'string' },
    commit: { type: 'string' },
    done: { type: 'array', items: { type: 'string' } },
    app_bugs: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } }, required: ['title', 'evidence', 'fix', 'files'] } },
    checks: { type: 'string' },
    concerns: { type: 'array', items: { type: 'string' } },
  },
  required: ['branch', 'commit', 'done', 'app_bugs', 'checks', 'concerns'],
}

phase('Snapshot')
const snap = await agent(`You are making WorldGraph's test link (a claude.ai Artifact) never show invented news unless the viewer asks for it. The owner asked: no invented stories by default; live news is flowing (over 2,500 live stories in Supabase).
${ENV.replaceAll('DB', 'wg_final_snap').replaceAll('PORT2', '5452').replaceAll('PORT', '5402').replaceAll('LABEL', 'final-snapshot')}
Today the shipped snapshot (frontend/public/snapshot/, built by frontend/scripts/build-snapshot.ts from a local sample database, with times moved to now by shiftTimes in src/api/sources/static.ts) is used as the test link's first frame (placeholderData in src/api/client.ts, SNAPSHOT_FIRST_FRAME) and as the offline fallback. That means invented sample stories can flash on screen even when live data follows, and are the whole app when the viewer declines the Supabase connector.

Build:
1. build-snapshot.ts: add a live mode that reads from the website's RPC endpoint: \`npm run snapshot:live -- https://worldgraph-kuq2.netlify.app\` POSTs the same plan (src/lib/snapshot-plan.ts) to <url>/api/rpc (read frontend/server/rpc.ts and src/api/sources/http.ts for the exact request shape), with sample:false where the function takes it, never refreshing any sample clock. Keep the current DB mode for the sample snapshot (tests use it). The manifest records kind: "live" | "sample" and as_of (when it was built).
2. static.ts: shiftTimes applies only to kind "sample". A live snapshot keeps its true dates.
3. Rules for what the viewer sees: a LIVE snapshot may be the first frame and the offline fallback, and the status pill then says it is a snapshot with its as-of time (never 'Live data'). A SAMPLE snapshot is used only when the viewer's Sample data setting is 'on'. Otherwise, with no live connection, show an honest state ('Live data isn't connected' plus the existing allow/retry control where there is one), not invented stories. Use the existing UI kit and copy rules (text limits, tokens, lucide icons, labels).
4. Unit tests: manifest kinds, no time shift for live, the first-frame/fallback gating for each Sample setting. Prove the live mode against your own dev server (website mode, with a few live rows you add) by building a live snapshot into a temp folder and checking its contents; do NOT commit a live snapshot built from your test data (the shipped snapshot stays the sample one until the owner's website is up; I will build the real one).
5. Document the command in README.md (one short section).
You own: frontend/scripts/build-snapshot.ts, frontend/src/lib/snapshot-plan.ts, frontend/src/api/sources/static.ts (and its tests), frontend/src/api/client.ts (first-frame code only), frontend/src/app/StatusBar.tsx and any small new component it needs under frontend/src/app/, frontend/package.json (scripts only), README.md. Report app bugs elsewhere in app_bugs rather than editing them.`, { label: 'live-snapshot', phase: 'Snapshot', isolation: 'worktree', schema: SCHEMA })

phase('E2E')
const snapBranch = snap && snap.branch ? (snap.branch.match(/wip\/[\w.-]+/) || [snap.branch])[0] : null
const e2e = await agent(`You are finishing WorldGraph's end-to-end test suite (Playwright).
${ENV.replaceAll('DB', 'wg_final_e2e').replaceAll('PORT2', '5453').replaceAll('PORT', '5403').replaceAll('LABEL', 'final-e2e')}
An earlier agent wrote most of the suite (about 20 files under frontend/e2e/ plus playwright config) on branch wip/wf_1734d928-feb-1, against an older main; it was stopped by a usage limit. Since then main gained: Ask as a chat thread with follow-ups, the globe's slow idle turn (Home or 30 s idle), the logo as Home, focus moving into panels and search and back, the phone status pill in the header, 40 px tap targets, sample labels everywhere, opaque wide panels, a readable phone graph, India-view names, and more (see git log).
${snapBranch ? `Also merge the snapshot work on ${snapBranch} (a real-news snapshot mode; with no live connection the test link shows a 'Live data isn't connected' state unless Sample data is set to 'on' in localStorage worldgraph.settings.v1).` : ''}
Do:
1. \`git fetch origin wip/wf_1734d928-feb-1 && git merge --no-edit FETCH_HEAD\`${snapBranch ? `, then \`git fetch origin ${snapBranch.replace('wip/', 'wip/')} && git merge --no-edit FETCH_HEAD\`` : ''}. Resolve conflicts keeping main's app code.
2. Run the whole suite against your own servers. Make it green against today's app by fixing the TESTS where the test is outdated or wrong (selectors, copy, flows that intentionally changed). Never weaken a check to hide a real bug, never skip or delete a test to get green: if the app is wrong, leave that test failing-as-expected only via test.fail() with a comment naming the bug, and list the bug in app_bugs with evidence and the smallest fix.
3. Add coverage for the new behaviour that has none: the Ask chat (follow-up, New chat, retry on a failed turn with a stand-in AI), focus into/out of panels and search, the logo as Home, and the snapshot gating above.
4. Add an npm script \`e2e\` that runs the suite headless and document how to run it in frontend/e2e/README.md (short).
You own: frontend/e2e/**, frontend/playwright*.ts, frontend/package.json (scripts and devDependency entries only if already installed in node_modules). Do not edit app code.`, { label: 'e2e-final', phase: 'E2E', isolation: 'worktree', schema: SCHEMA })

return { snapshot: snap, e2e }
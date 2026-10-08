export const meta = {
  name: 'worldgraph-qa-fix',
  description: 'Fix triaged QA findings, one agent per owning area in its own worktree, each change checked by the unit and end-to-end tests',
  phases: [{ title: 'Fix', detail: 'one agent per area, in parallel worktrees' }],
}

// args.groups: [{ label, owns: ["frontend/src/features/globe/**", ...], findings: [{title, severity, files, evidence, fix}] }]
// Triaged by hand from worldgraph-qa.js output. Areas must not overlap.

const COMMON = `
You are fixing review findings in WorldGraph, a visual world-knowledge web app for businesses (globe, knowledge graph, cascades, crowd forecasts). The owner wants it sleek, professional, simple, accurate and convenient. It runs as a claude.ai Artifact (test link) and later as a website on Netlify.

Your working directory is an isolated git worktree at the current main. Read CLAUDE.md (rules and design system) and PLAN.md first, then the files named in your findings.

Environment
- node_modules is NOT in your worktree: run \`ln -sfn /home/user/worldgraph/frontend/node_modules frontend/node_modules\` first. Never run npm install.
- Your own database: \`psql postgresql://wg:wg@localhost:5432/postgres -c "drop database if exists wg_fix_<db>" -c "create database wg_fix_<db>"\`, then \`cd backend && uv sync && DATABASE_URL=postgresql://wg:wg@localhost:5432/wg_fix_<db> uv run wg db migrate && DATABASE_URL=postgresql://wg:wg@localhost:5432/wg_fix_<db> uv run wg seed load\` (\`pg_ctlcluster 16 main start\` if Postgres is down).
- Dev server: \`cd frontend && DEV_DATABASE_URL=postgresql://wg:wg@localhost:5432/wg_fix_<db> npx vite --port <port> --strictPort &\`. Playwright with Chromium at '/opt/pw-browsers/chromium'; screenshots under frontend/test-results/<label>/ (git-ignored); LOOK at them.
- End-to-end tests live in frontend/e2e/ (\`npx playwright test <spec>\`; set the base URL/port as frontend/playwright.config.ts expects, or start your own server and point it there).

How to work
- Fix each finding at its root with the smallest correct change. Reproduce it first (the evidence says how), then show it fixed (test, screenshot or command).
- Edit ONLY files in the area you own (listed below). If a finding needs a change elsewhere, don't make it: report it as "blocked" with the exact change needed.
- Add or update a unit test for each logic fix. Never weaken, skip or delete a test to make it pass; if an e2e test is itself wrong, say so and fix only the test's mistake.
- If a finding is not real (cannot reproduce on current main), say so with what you tried.
- Commit after each fix or small group (\`git add -A && git commit -m "<Area>: <what changed>"\`, plain message, no trailers; never commit test-results/). A background saver also pushes your worktree every 10 minutes.

Finishing
- Checks (all must pass): \`cd frontend && npx tsc -b --force --noEmit && npx eslint . && npx vitest run && npx vite build\`, the e2e specs for your area, and for backend changes \`cd backend && uv run ruff check . && TEST_DATABASE_URL=postgresql://wg:wg@localhost:5432/postgres uv run pytest -q\`.
- Stop your servers. Report branch, commit, and the outcome of every finding.
`

const SCHEMA = {
  type: 'object',
  properties: {
    branch: { type: 'string' },
    commit: { type: 'string' },
    outcomes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          outcome: { type: 'string', enum: ['fixed', 'not-real', 'blocked'] },
          note: { type: 'string' },
        },
        required: ['title', 'outcome', 'note'],
      },
    },
    checks: { type: 'string' },
    concerns: { type: 'array', items: { type: 'string' } },
  },
  required: ['branch', 'commit', 'outcomes', 'checks', 'concerns'],
}

const groups = (args && args.groups) || []
if (!groups.length) throw new Error('Pass args.groups (see the comment at the top)')

phase('Fix')
log('Fixing ' + groups.reduce((n, g) => n + g.findings.length, 0) + ' findings in ' + groups.length + ' areas')
return await parallel(groups.map((g, i) => () =>
  agent(COMMON + `
Your label: fix:${g.label}. Your dev-server port: ${5401 + i}. Your database name: wg_fix_${g.label.replace(/[^a-z0-9]/g, '_')}.
Files you own: ${g.owns.join(', ')}.
${g.note ? 'Note: ' + g.note + '\n' : ''}Findings (fix all of them, most severe first):
${JSON.stringify(g.findings, null, 2)}`, {
    label: 'fix:' + g.label,
    phase: 'Fix',
    isolation: 'worktree',
    schema: SCHEMA,
  }).then(r => r ? { label: g.label, ...r } : { label: g.label, failed: true })
))

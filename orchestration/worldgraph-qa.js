export const meta = {
  name: 'worldgraph-qa',
  description: 'End-to-end tests plus five adversarial reviews (correctness, accessibility and design, product and legal rules, artifact and security, visual polish), each finding reproduced before it is reported',
  phases: [{ title: 'Review', detail: 'E2E author and 5 reviewers in parallel worktrees' }],
}

// Run after every screen is merged into main. Reviewers only REPORT (they do
// not fix app code); the e2e agent commits tests. Fixes go through
// orchestration/worldgraph-qa-fix.js with the triaged findings.

const COMMON = `
You are reviewing WorldGraph, a visual world-knowledge web app for businesses: a 3D globe, a knowledge graph, cause-and-effect cascades and crowd forecasts. The owner wants it sleek, professional, simple, accurate and convenient to use. It runs as a claude.ai Artifact (the owner's private test link) and later as a website on Netlify. Every screen is now built; your job is to find what is wrong before the owner sees it.

Your working directory is an isolated git worktree of the repository at the current main. Read first: CLAUDE.md, PLAN.md, BUILD_BRIEF.md ("Visual design system", "Product principles"), CHECKPOINT.md, then the code relevant to your focus (frontend/src/**, frontend/server/**, frontend/netlify/**, frontend/scripts/**, backend/src/worldgraph/db/migrations/*.sql for api.* behaviour).

Environment
- node_modules is NOT in your worktree: run \`ln -sfn /home/user/worldgraph/frontend/node_modules frontend/node_modules\` first. Never run npm install.
- Your own database: \`psql postgresql://wg:wg@localhost:5432/postgres -c "drop database if exists wg_qa_<db>" -c "create database wg_qa_<db>"\`, then \`cd backend && uv sync && DATABASE_URL=postgresql://wg:wg@localhost:5432/wg_qa_<db> uv run wg db migrate && DATABASE_URL=postgresql://wg:wg@localhost:5432/wg_qa_<db> uv run wg seed load\`. If Postgres refuses connections run \`pg_ctlcluster 16 main start\`. Add a few live (is_sample = false) rows yourself when you need drafts or live data.
- Dev server (website mode with the local /api/rpc middleware): \`cd frontend && DEV_DATABASE_URL=postgresql://wg:wg@localhost:5432/wg_qa_<db> npx vite --port <port> --strictPort &\`. The viewer's country comes from WG_DEV_VIEWER_COUNTRY (e.g. IN, US, unset).
- Artifact build: \`cd frontend && npm run build:artifact\` → dist-artifact/ (outside claude.ai it has no capabilities, so it falls back to the bundled snapshot); serve it with \`npx vite preview --outDir dist-artifact --port <port+50> --strictPort &\`.
- Playwright (@playwright/test, @axe-core/playwright installed): launch Chromium with executablePath '/opt/pw-browsers/chromium'. Settings live in localStorage key worldgraph.settings.v1 (e.g. {"theme":"light","sample":"on","borders":"india","calm":true}). Screenshot at 1440×900 and 390×844 (and 360×740 where layout is tight), dark and light, under frontend/test-results/<your label>/ (git-ignored). LOOK at every screenshot with the Read tool.
- Stop every server you start before you finish.

Rules for findings
- Report only what you have REPRODUCED: a failing command, a screenshot you looked at, an axe violation, or code you read with an exact file:line and a concrete input that breaks it. No speculation, no style preferences dressed up as bugs.
- Severity: "blocker" (wrong data, broken screen, legal/product-rule breach, security hole, crash), "major" (clearly wrong or confusing for a user, accessibility failure, design-rule breach), "minor" (polish that a careful reviewer would ask for), "nit". Be honest; most findings are not blockers.
- For each finding give: a short title, severity, the files to change, the evidence (what you ran or saw), and the smallest correct fix.
- Do NOT change app code. You may write throwaway scripts under frontend/test-results/ (git-ignored). If you are the e2e author, you commit tests only.
- Group by the owning area so fixes can be split: one of globe, story-cascade, region, forecasts, business, graph-entity, ask-brief-search-settings, ai-artifact-web, ui-kit (components/**, styles/**, lib/**), shell (app/**, state/**, api/**, platform/**), backend (SQL, pipeline), netlify (frontend/netlify/**, server/**).
`

const SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
          area: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          evidence: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['title', 'severity', 'area', 'files', 'evidence', 'fix'],
      },
    },
    checked: { type: 'string' },
    screenshots: { type: 'array', items: { type: 'string' } },
    branch: { type: 'string' },
    commit: { type: 'string' },
  },
  required: ['findings', 'checked', 'screenshots'],
}

const tasks = [
  {
    label: 'e2e',
    db: 'e2e',
    port: 5301,
    prompt: `
Task: END-TO-END TESTS. Files you own: frontend/e2e/**, frontend/playwright.config.ts, and the "e2e" scripts in frontend/package.json (scripts only). Write Playwright tests that a contributor runs with \`npm run e2e\`:
- playwright.config.ts: Chromium via executablePath '/opt/pw-browsers/chromium' when that path exists (else Playwright's default); two projects, "desktop" (1440×900) and "phone" (390×844, touch); a webServer that starts the dev server on a fixed port with DEV_DATABASE_URL from the environment (default postgresql://wg:wg@localhost:5432/worldgraph_dev) and reuses an existing server; a second config or project for the artifact build served by vite preview.
- Specs (one file per screen area): the globe loads (canvas present, Top 5 card, window and sector controls work, List view lists events and opens a story); story panel and cascade (open from the list, cascade nodes render, list alternative, evidence drawer); region panel (open via search, breadcrumb, KPIs, compare 2 regions); forecasts view (filters, sort, open a forecast, provider link only when present, no bet/trade wording on the page); My Business (onboarding, save a profile, it survives reload in the browser store, Affects-you feed); opportunities; graph (canvas present, list fallback, entity panel, notes save); Ask (unavailable state outside claude.ai explains why); brief; command search (Ctrl+K, type, Enter opens the right panel); settings (theme switch persists; sample on/off; borders); deep links (load #story=…, Back works).
- Accessibility: an axe scan (@axe-core/playwright, tags wcag2a, wcag2aa) of every screen and panel in dark AND light; fail on serious/critical violations.
- Rules: a test that no visible text matches /\\b(bet|bets|betting|wager|trade|trading)\\b/i on forecast screens; that sample stories show "Sample data"; that the page makes no request to any host other than the app's own origin (record requests; the artifact build especially).
- Artifact build: the snapshot first frame renders the globe and Top 5 with no network, and the status line says it is showing saved data.
Run the whole suite. Tests must assert CORRECT behaviour: when a test fails because the APP is wrong, do not weaken or skip the test: report it as a finding (area = the owning screen) and leave the test failing. Tests that fail because the TEST is wrong, fix. Commit your tests (\`git add frontend/e2e frontend/playwright.config.ts frontend/package.json && git commit -m "E2E: <what>"\`, no trailers) and report branch and commit. In "checked" give the pass/fail counts per spec.`,
  },
  {
    label: 'review:correctness',
    db: 'correct',
    port: 5302,
    prompt: `
Focus: CORRECTNESS AND DATA. For every screen: does it read the right api function with the right args (contract.ts RpcArgs), render every field correctly (units, dates, time zones, probabilities as %, ▲▼ signs, counts), handle loading, empty, error and partial data (null fields, empty arrays, drafts with analysed=false, unknown ids, a region with no KPIs, a forecast with no history), and keep state right across navigation (panel stack, window/sector changes, back, deep links, refetch, theme switch)? Look for race conditions (stale responses overwriting newer ones), leaks (map/graph not cleaned up on unmount; listeners), effects firing in loops, react-query keys that miss an arg, wrong invalidation after save_analysis, and anything that would show the user wrong information. Cross-check a few rendered values against direct SQL (\`select api.<fn>('{...}'::jsonb)\`). Also run the frontend checks (\`npx tsc -b --force --noEmit && npx eslint . && npx vitest run\`) and the backend tests (\`cd backend && TEST_DATABASE_URL=postgresql://wg:wg@localhost:5432/postgres uv run pytest -q\`) and report any failure.`,
  },
  {
    label: 'review:a11y-design',
    db: 'a11y',
    port: 5303,
    prompt: `
Focus: ACCESSIBILITY AND THE DESIGN SYSTEM. Check every screen and panel, dark and light, desktop and 360/390 px phone:
- axe (wcag2a, wcag2aa) on each screen and open panel; keyboard-only walkthrough (Tab order, visible focus ring, Escape closes panels/sheets/dialogs, focus returns to the opener, no keyboard traps, the map/graph/cascade each have a list alternative reachable by keyboard); every control has an accessible name; touch targets ≥ 40 px for primary controls; colour contrast AA for text and meaningful graphics (measure computed colours, including text over the globe and over glass panels).
- Design rules from CLAUDE.md: colours only from tokens (grep components and features for hex/rgb/hsl literals and Tailwind palette classes like text-red-500); risk amber, opportunity teal, neutral slate, forecasts violet with a crowd icon and ring; colour always paired with an icon or ▲▼; never red against green; lucide icons only; at most 3 text sizes per screen (count distinct computed font sizes per screen in the browser); tabular numbers for figures; reduced motion and the calm setting stop animation (emulate prefers-reduced-motion and check for running animations/auto-rotation).
- Layout at 360 px: nothing overflows horizontally, bottom sheet works, controls don't cover the map more than needed.`,
  },
  {
    label: 'review:rules',
    db: 'rules',
    port: 5304,
    prompt: `
Focus: PRODUCT AND LEGAL RULES (these are non-negotiable for the owner):
- Prediction markets are information only: search the UI copy, built bundle and prompts for bet, betting, wager, trade, trading, odds, stake, payout, wallet, referral (allow "trade" only where it means international trade in news, e.g. "trade policy"); no buy/sell controls; provider links only when the API returns a url; real-money providers hidden unless allowed for the viewer's country and hidden when the country is unknown (fail closed): test with WG_DEV_VIEWER_COUNTRY unset, US, IN, GB and inspect api.provider rows/gating in SQL.
- Facts, inferences and forecasts visibly separate: every causal link shows type and confidence; every forecast shows provider, volume with unit, last update and the words "crowd forecast"; AI projections are labelled "Projection, not news" and are never saved.
- Sample data: labelled "Sample data" wherever it appears (story cards, panels, forecasts, KPIs, brief), has no evidence URLs, and no invented news about real companies (spot-check the seed storylines in backend/src/worldgraph/seed/storylines/*.yaml for real company names in invented events).
- Live data: never full article text (headline, url, source, date, ≤ one-sentence snippet); drafts show the source headline with "Draft · awaiting analysis" and no invented so-what; no private individuals.
- India borders: with borders auto and an Indian browser locale/time zone (emulate locale en-IN and timezone Asia/Kolkata), the map uses India's official view; with international, the default. Check the geo files used for each worldview.
- Attribution: Settings lists each data source with its attribution text and link as SOURCES.md requires (GDELT citation, USGS, GDACS, Natural Earth, Manifold, feeds).`,
  },
  {
    label: 'review:artifact-security',
    db: 'sec',
    port: 5305,
    prompt: `
Focus: THE TEST-LINK BUILD AND SECURITY.
- Artifact build: run \`npm run build:artifact\`; check dist-artifact/ size (page and each file under the limits: page ≤ 16 MB, files ≤ 15 MB), ARTIFACT.md and artifact-files.json (every referenced asset listed, relative paths, nothing missing); grep the built JS/CSS/HTML for absolute http(s) URLs, external fonts, tile/glyph/sprite URLs, fetch() to other origins; confirm the app works with no capabilities (snapshot fallback) and read frontend/src/platform/types/*.d.ts to check capability use: mcp callTool args for the Supabase execute_sql tool (project_id xmznnjpflimsjvwftxpa, read-only SELECT api.* calls, writes only save_analysis), approval_required handling (one repeat via a button, no loops), sample (AI) use only on user action or the owner's on-use analysis with consent, db rules (each viewer only writes data/users/{self}), user capability use. Deep links use only bare #anchors.
- SQL safety: the artifact composes SQL text for execute_sql (frontend/src/api/sql.ts and sources/connector.ts): prove that function names come from an allow-list and args are passed as a safely quoted jsonb literal (try names and args with quotes, $$, backslashes, null bytes, very long strings). The website's server/rpc.ts and netlify/functions/rpc.mts: same allow-list, parameterised queries, writes refused, viewer country set by the server only (a browser-sent _viewer must be ignored/overwritten), payload size limits, errors don't leak internals.
- AI: netlify/functions/ai.mts refuses "analysis", validates task and input size, enforces the daily budget before calling (race between concurrent requests?), records usage and cost, never echoes the API key, and returns safe errors; prompts treat news text as untrusted data (prompt-injection: a headline saying "ignore previous instructions" must not change the output schema or leak anything). The artifact's on-use analysis runs only for the owner/editor, at most 3 batches, one at a time, validates items with AnalysisItem before save_analysis.
- Secrets: nothing secret committed (grep the repo and git history for keys/tokens/passwords; .env ignored; .env.example has placeholders only). GitHub workflows: least-privilege permissions, secrets only via secrets.*, no pull_request_target misuse.`,
  },
  {
    label: 'review:polish',
    db: 'polish',
    port: 5306,
    prompt: `
Focus: VISUAL POLISH AND EASE OF USE, as the owner (a business person, not a developer) would judge it: "sleek, professional, simple, accurate and convenient". Walk every screen and panel at 1440×900, 390×844 and 360×740, dark and light, with sample data. Look hard at each screenshot: alignment and spacing rhythm, consistent radii and borders, truncation and overflow, awkward wrapping, empty space, visual hierarchy (is the most important thing the most prominent?), loading skeletons that jump, glass panels that are hard to read over the globe, chart readability, icon consistency, copy (plain English, short, no jargon, consistent capitalisation, no "lorem" or developer wording), number formatting, and the first impression of the home screen within 3 seconds. Try the core journeys: "what's happening in the world that affects my business" (globe → story → cascade), "what does the crowd expect" (forecasts), "set up my business" (onboarding → Affects you), "ask a question". Report what makes it feel less than premium, each with the screenshot path that shows it and the smallest change that would fix it.`,
  },
]

phase('Review')
const only = (args && args.only) || null
const todo = only ? tasks.filter(t => only.includes(t.label)) : tasks
log('Launching ' + todo.length + ' QA agents in isolated worktrees')
const results = await parallel(todo.map(t => () =>
  agent(COMMON + `\nYour label: ${t.label}. Your dev-server port: ${t.port}. Your database name: wg_qa_${t.db}.\n` + t.prompt, {
    label: t.label,
    phase: 'Review',
    isolation: 'worktree',
    schema: SCHEMA,
  }).then(r => r ? { label: t.label, ...r } : { label: t.label, failed: true })
))
const findings = results.flatMap(r => (r.findings || []).map(f => ({ from: r.label, ...f })))
const order = { blocker: 0, major: 1, minor: 2, nit: 3 }
findings.sort((a, b) => order[a.severity] - order[b.severity])
return {
  counts: Object.fromEntries(['blocker', 'major', 'minor', 'nit'].map(s => [s, findings.filter(f => f.severity === s).length])),
  e2e: results.find(r => r.label === 'e2e'),
  reports: results.map(r => ({ label: r.label, failed: !!r.failed, checked: r.checked, screenshots: r.screenshots })),
  findings,
}

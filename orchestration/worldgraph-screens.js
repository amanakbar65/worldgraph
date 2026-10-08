export const meta = {
  name: 'worldgraph-screens',
  description: 'Build every WorldGraph screen, the AI engines, the claude.ai test-link build and the Netlify functions, each in an isolated worktree',
  phases: [{ title: 'Build', detail: '8 agents in parallel worktrees' }],
}

const COMMON = `
You are building part of WorldGraph, a visual world-knowledge web app for businesses: a 3D globe, a knowledge graph, cause-and-effect cascades and crowd forecasts. The owner wants it sleek, professional, simple, accurate and convenient to use. It runs as a claude.ai Artifact (the owner's private test link) and later as a website on Netlify.

Your working directory is an isolated git worktree of the repository (a copy of /home/user/worldgraph at its current commit). Read first: CLAUDE.md, PLAN.md (especially "Screens", "User data", "AI" and the design rules), BUILD_BRIEF.md sections "Visual design system" and "Product principles", then:
- frontend/src/api/contract.ts (every response shape and RpcArgs), frontend/src/api/client.ts (useRpc, useConnection), frontend/src/api/source.ts (DataError)
- frontend/src/state/nav.ts (views, panels, window, sectors, flyTo), frontend/src/state/settings.ts (sampleArg, theme, borders), frontend/src/state/ui.ts
- frontend/src/app/* (the shell: Header, PanelHost (desktop side panel / mobile bottom sheet), StatusBar, registry.tsx: your feature's default export is already wired in)
- frontend/src/components/** (the UI kit: primitives in components/ui, domain components such as StoryCard, ForecastRow, ProbabilityRing, KpiTile, ImpactBadge, EntityChip, SourcesList, ErrorState, EmptyState, SampleBadge; and features/settings/DesignPreview.tsx, which shows them all). REUSE these; don't restyle or duplicate them.
- frontend/src/lib/* (format, time, icons, meaning, geo loader), frontend/src/styles/tokens.css and globals.css
- frontend/src/ai/engine.ts and schemas.ts (AI: getAiEngine(), runAi(task, input, schema)), frontend/src/platform/storage.ts (useUserValue for per-viewer data), frontend/src/platform/runtime.ts
- prompts/README.md (AI prompts shared with the website)

Data
- Every screen reads through useRpc(name, args). Pass the sample setting: sample: sampleArg(useSettings(s => s.sample)) where the RpcArgs allow it. Window and sector lens come from useNav.
- Show loading with skeletons, failures with <ErrorState error=…/> (it explains connector problems), and empty results with a helpful <EmptyState/> that suggests a next tap.
- Sample data is labelled "Sample data" (SampleBadge) wherever it appears. Stories with analysed=false are drafts from the live news pipeline: show their source headline with a small "Draft · awaiting analysis" label, never invent a so-what for them.
- First frame: the test link shows a bundled snapshot until live data arrives. If your screen is on the first frame (globe: meta, globe, top; brief; forecasts), send exactly the arg shapes listed in frontend/src/lib/snapshot-plan.ts; if you need a different default shape, update snapshot-plan.ts and run \`cd frontend && DEV_DATABASE_URL=… npm run snapshot\` (its test checks the committed files match the plan).
- Already built (don't rebuild): deep links in state/nav.ts (view, panel, window and sectors in the hash; just use useNav), the StatusBar (data source, freshness, AI analysis status, connector approval), the AI engines and on-use analysis (src/ai/engines.ts, analysis-runner.ts).
- Buttons: use components/ui/button.tsx (variants default, secondary, outline, ghost; sizes default 40 px, sm, lg, icon) or StateButton from components/EmptyState. Icons in JSX: read them from the records (e.g. SECTORS[id].icon, EVENT_TYPE_ICONS[...]); the lint rule react-hooks/static-components rejects \`const I = sectorIcon(x)\` rendered in JSX (see lib/icons.ts).
- Facts, inferences and forecasts stay visibly separate: causal links always show type (Reported / Inferred / Projected / Conditional) and confidence; forecasts always show provider, volume with its unit, and last update, plus the words "crowd forecast". Prediction markets are information only: never use the words bet, betting, trade, trading, wager or odds-to-win; no buy/sell buttons. Show a provider link only when the API returns a url.

Design rules (non-negotiable)
- Dark by default, light theme too: colours ONLY via the CSS tokens/classes (no hex or rgb literals in components). Risk is amber, opportunity teal, neutral slate, forecasts violet with a crowd icon and ring shape. Colour is always paired with an icon or ▲ ▼; never red against green.
- lucide-react icons only; at most 3 text sizes per screen (text-label, text-body, text-figure); tabular numbers.
- Calm motion that stops under prefers-reduced-motion and the app's "calm" setting (data-wg-calm on <html>).
- WCAG AA; every control keyboard-reachable with a visible focus ring and an accessible name; touch targets ≥ 40 px for primary controls; works at 360 px wide (panels become the bottom sheet there).
- Short, plain English copy. No jargon in labels. Numbers formatted with lib/format.
- Inside claude.ai there is NO network except our own files and capabilities: no external fonts, tiles, images or fetches. Only bare #anchors survive in the URL.

Environment
- Frontend: node_modules is NOT in your worktree. Before any npm/npx command run \`ln -sfn /home/user/worldgraph/frontend/node_modules frontend/node_modules\`. Never run npm install. If you truly need a new package, say so in "concerns" instead.
- A local database for the dev server: create your own, e.g. for label X: \`psql postgresql://wg:wg@localhost:5432/postgres -c "drop database if exists wg_dev_X" -c "create database wg_dev_X"\`, then \`cd backend && uv sync && DATABASE_URL=postgresql://wg:wg@localhost:5432/wg_dev_X uv run wg db migrate && DATABASE_URL=postgresql://wg:wg@localhost:5432/wg_dev_X uv run wg seed load\`. If Postgres refuses connections run \`pg_ctlcluster 16 main start\`. To add a few live (non-sample) rows for testing drafts, insert them yourself in your own database.
- Dev server: \`cd frontend && DEV_DATABASE_URL=postgresql://wg:wg@localhost:5432/wg_dev_X npx vite --port <your port> --strictPort &\` (the /api/rpc middleware serves the api functions). Use YOUR port only (given below).
- Screenshots: Playwright is installed (@playwright/test); launch Chromium with executablePath '/opt/pw-browsers/chromium'. Take screenshots of your screens at 1440×900 and 390×844, in dark and light themes (settings live in localStorage key worldgraph.settings.v1, e.g. {"theme":"light"}), LOOK at them with the Read tool, and fix what looks off: alignment, overflow, truncation, contrast, empty space, anything not sleek. Save them under frontend/test-results/<your label>/ (git-ignored) and list them in your report.
- Other agents are building the other screens in parallel in their own worktrees. Create or edit ONLY the files your task gives you. Shared files you must NOT edit unless your task says so: frontend/src/api/**, frontend/src/components/**, frontend/src/lib/** (you may ADD new files in lib/ with a name prefixed by your feature, e.g. lib/globe-*.ts), frontend/src/styles/**, frontend/src/state/** (except files your task names), frontend/src/app/**, frontend/src/ai/engine.ts, frontend/src/ai/schemas.ts, frontend/src/platform/**, backend/**, prompts/**, package.json. If a shared file needs a change, describe it precisely in "concerns".

Saving progress
- Usage limits can stop you mid-task. Commit early and often in your worktree (after each working milestone, with a plain "<Area>: <what>" message); a background saver also pushes your worktree every 10 minutes. If you were given a RESUME note, start from that branch.

Finishing
1. Checks (all must pass): \`cd frontend && npx tsc -b --noEmit && npx eslint . && npx vitest run && npx vite build\`. Write vitest tests for your pure logic (data shaping, layout, filtering) and at least one render test per screen with mocked data (mock useRpc via vi.mock('@/api/client')).
2. Stop your dev server. Commit in your worktree: \`git add -A && git commit -m "<Area>: <what changed>"\` (plain message, no trailers; never commit test-results/).
3. Reply with the structured report: branch (git rev-parse --abbrev-ref HEAD), commit (short hash), files changed, a short summary, the checks you ran with results, screenshot paths, and concerns.
`

const tasks = [
  {
    label: 'globe',
    port: 5201,
    prompt: `
Task: THE GLOBE (the home screen). Files you own: frontend/src/features/globe/** and new frontend/src/lib/globe-*.ts files.
Data: api.globe({window, sectors, sample}) (events, arcs, forecasts, countries) and api.top({window, sectors, sample}) (Top 5 now and movers). Map shapes: frontend/src/lib/geo.ts (loadCountries(worldview), loadAdmin1(country, worldview), loadPlaces()) reading frontend/public/geo/*.json. Use useIndiaBorders() from state/settings for the worldview.
Build:
- A full-screen MapLibre GL map (maplibre-gl, installed) with the globe projection, drawn ONLY from our own data (no tile URLs, no glyph or sprite URLs; text labels, if any, via deck.gl TextLayer which draws with the page font). Background like a dark planetarium (token colours read from CSS variables at runtime, re-read on theme change). Country fills tinted subtly by their activity score from api.globe countries (risk/opportunity balance), thin borders; on zooming into a country (or selecting it) load and draw its states from loadAdmin1. Atmosphere/space look within tokens; respect reduced motion (no auto-rotation then).
- deck.gl layers via @deck.gl/maplibre MapboxOverlay (interleaved): H3 hex heat of events (h3-js: compute cells client-side from lon/lat; resolution by zoom), event points sized by importance and coloured by impact (with the impact icon shown in tooltips/cards, never colour alone), cross-border arcs from api.globe arcs (type and confidence in the tooltip; dashed/lighter for inferred), forecast rings (violet rings at forecast locations, glow for big 24 h movers, crowd icon in tooltip).
- Hover tooltip (desktop) and tap selection (mobile): small glass card using the UI kit (StoryCard compact / ForecastRow). Click a country or state → useNav.open({kind:"region", id}); click an event → {kind:"story", id}; click a forecast → {kind:"forecast", id}. React to useNav.focus (flyTo requests from other screens) with an eased camera move.
- Overlay controls, floating glass, not covering the map more than needed:
  - time window segmented control (24 h / 7 d / 30 d) bound to useNav.window;
  - sector lens: chips for the 9 sectors bound to useNav.sectors (empty = all), with icons;
  - layer toggles (heat, events, arcs, forecasts) and a compact legend that explains colours with icons and ▲▼;
  - "Top 5 now" card (from api.top) with movers (crowd forecasts that moved most), each row clickable;
  - a "List" toggle that shows the same events as an accessible, keyboard-navigable list (the non-map alternative), sorted by importance.
- Performance: smooth on a laptop with 1,500 events; memoise layer data; don't re-create the map on re-render. Clean up the map on unmount.
- Mobile: controls collapse into a compact bar; Top 5 becomes a swipeable/collapsible card; the map stays usable with one thumb.
Tests: pure functions (hex binning, colour/size scales, arc filtering, the list view's sorting) and a render test of the overlay with mocked data (mock maplibre-gl and deck.gl in tests).`,
  },
  {
    label: 'ai-artifact-web',
    port: 5202,
    prompt: `
Task: AI ENGINES, ON-USE ANALYSIS, THE TEST-LINK BUILD, DEEP LINKS and NETLIFY FUNCTIONS. Files you own: frontend/src/ai/engines.ts, frontend/src/api/sources/connector.ts (see below) and new files in frontend/src/ai/ (not engine.ts or schemas.ts except to ADD exports if truly needed: say so), frontend/src/app/StatusBar.tsx, frontend/src/app/Providers.tsx, frontend/src/state/nav.ts (deep-link sync only), frontend/scripts/**, the repo-root netlify.toml (with base = "frontend" so functions resolve frontend/node_modules), frontend/netlify/functions/**, frontend/server/** (add files), frontend/package.json "scripts" section only (you may add scripts, not dependencies), frontend/.gitignore. Also read frontend/src/platform/types/sample.d.ts, mcp.d.ts, db.d.ts, user.d.ts and claude.d.ts carefully (the claude.ai Artifact runtime, contract 0.2.74), and backend/src/worldgraph/pipeline/analysis.py (the website's Python version of the analysis job). You also own frontend/src/api/sources/connector.ts for one change: handle the connector's \`approval_required\` code as the runtime docs describe (a "needs approval" state with a button that repeats the same call once via callTool; then render that result), instead of silently falling back to the snapshot; keep the snapshot fallback for connector_missing / not_granted / offline.
The test link's capability declaration (for ARTIFACT.md and the publish step): mcp {servers: [{server: "Supabase", tools: ["execute_sql"]}]} (the Supabase connector's execute_sql takes {project_id, query}; its result text wraps the JSON rows in <untrusted-data-…> tags, already parsed by src/api/sql.ts), sample {} (no images), db {rules: [{path: "data/users/{self}", write: "interact"}]}, user {}.
Build:
1. Engines (frontend/src/ai/engines.ts → resolveEngine()):
   - Artifact (TARGET === "artifact" and capability("sample") resolves): complete(task, input) sends ONE user turn: PROMPTS[task] + "\n\n## Data\n\n" + JSON.stringify(input) and uses sample.json(...) (read sample.d.ts for options: pick the model tier per task: analysis "default", ask "default", projection "quick" if suitable), maps SampleError codes to AiError kinds (not_granted → declined, rate_limited, cancelled, unavailable…). Label "Your Claude account".
   - Website (TARGET === "web"): POST /api/ai {task, input} → JSON; maps 402/429/503 to AiError budget/rate_limited/unavailable. Label "WorldGraph AI".
   - Otherwise the none engine. Never retry from a loop.
2. On-use analysis runner (frontend/src/ai/analysis-runner.ts + a small zustand store): only in the artifact and only when the viewer is the owner or can write (use the user capability: isOwner()/canEdit()); after the app has loaded and the viewer has been idle on screen for a few seconds, call api.pending_analysis({limit: 6}); if items exist, show a quiet status in the StatusBar ("Analysing 6 new stories with your Claude account…", with a Stop button), run runAi("analysis", {today, items: compacted like analysis.py's compact()}, AnalysisResult), validate each item with AnalysisItem (contract.ts) and drop invalid ones, then call api.save_analysis({engine: "artifact", model: "claude (your account)", items, skipped}) through dataSource with fresh reads afterwards (invalidate react-query 'rpc' keys). At most 3 batches per visit, never more than one at a time, stop on any AI error, and remember a "declined" answer for the visit. Show results in the status line ("12 stories analysed"). The first AI call asks the viewer's consent: that's expected.
   NOTE: save_analysis is a write; the connector source sends writes uncached. In the website build this runner is OFF (the pipeline does analysis there).
3. StatusBar: keep the data-source line, add the AI analysis status and a tiny freshness note ("Updated 4 min ago" from api.meta's newest data). Calm, one line, never covering important UI on mobile.
4. Deep links: keep the current view and top panel in the URL hash (#globe, #story=story:abc, #region=region:in-gj&w=24h …); restore them on load and on hashchange; only bare #anchors are allowed inside claude.ai, so keep it to the hash. Make Back (browser) work sensibly.
5. The test-link build: frontend/scripts/artifact-page.mjs, run by "build:artifact" after \`vite build --mode artifact\`, turns dist-artifact/ into what the Artifact tool publishes: dist-artifact/index.html as the page (keep it a normal HTML page; relative asset paths) plus a manifest dist-artifact/artifact-files.json listing every other file (assets/*, geo/*, snapshot/*) with its published path, for the publish step. Also write dist-artifact/ARTIFACT.md describing the capabilities the page needs: mcp {servers: [{server: "Supabase", tools: ["execute_sql"]}]}, sample, db (rules: each viewer's own data/users/{self} subtree), user. Keep the total under 16 MB and each file under 15 MB; report the sizes.
6. Snapshot: frontend/scripts/build-snapshot.ts (run with node --experimental-strip-types; add "snapshot" to package.json scripts): connects to DEV_DATABASE_URL with pg, calls the api functions for the first frame (meta; globe and top for each window with no sectors; brief; forecasts default) with sample: true, and writes frontend/public/snapshot/*.json plus manifest.json keyed by snapshotKey(name, args) from src/api/sources/static.ts (args exactly as the app sends them for the first frame). Commit the generated snapshot files.
7. Netlify functions (website mode; NOT deployed): frontend/netlify/functions/rpc.mts using server/rpc.ts handleRpc with a pg Pool from process.env.DATABASE_URL (Supabase pooler; ssl), viewerCountry from Netlify's context.geo.country.code, allowWrites false; frontend/netlify/functions/ai.mts: POST {task: "ask"|"projection", input} → validates input size, checks the daily budget in the llm_usage table (US$2/day total from WG_AI_DAILY_BUDGET_USD; Ask/projection may use the remaining 25% after analysis's share, matching backend/src/worldgraph/pipeline/analysis.py), calls the Claude API with @anthropic-ai/sdk ONLY IF it is already installed in frontend/node_modules (check; if not, use fetch to https://api.anthropic.com/v1/messages with the documented headers), model from WG_AI_MODEL (default claude-opus-5-5), output_config {effort: "low", format: {type: "json_schema", schema: prompts/<task>.schema.json without $comment}}, system = prompts/<task>.md with cache_control ephemeral, records usage+cost in llm_usage, returns the parsed JSON; and the "analysis" task is refused (pipeline only). netlify.toml: build command (npm run build in frontend), publish dir, functions dir, node 22, /api/rpc and /api/ai redirects. Read the Claude API skill guidance if available to you (Skill tool, "claude-api") before writing the API call.
Tests: vitest for the engines (mock capability("sample") and fetch), the runner (mock dataSource/runAi: validates, drops bad items, stops on errors, max batches), hash parsing/serialising, and the snapshot key logic. Build the artifact (npm run build:artifact) and report its file list and sizes.`,
  },
  {
    label: 'story-cascade',
    port: 5203,
    prompt: `
Task: STORY CARD and CASCADE VIEW. Files you own: frontend/src/features/story/**.
Data: api.story({id}) and api.cascade({id, depth}). AI: runAi("projection", input, ProjectionResult) from src/ai.
Build:
- StoryPanel (panel kind "story"): headline, ImpactBadge with direction, so-what, chips (sectors, region link, horizon, confidence), magnitude, time (first seen / last seen), actions as a short checklist-style list, crowd forecasts row (ProbabilityRing/ForecastRow; tap → forecast panel), entities (EntityChip, tap → entity panel; regions → region panel and flyTo), sources (SourcesList), causes and effects lists with link type + mechanism + confidence (tap → that story), and a prominent "See the cascade" button → {kind:"cascade", id}. Draft stories (analysed=false): source headline + "Draft · awaiting analysis", no so-what/actions; sources first. Sample stories: SampleBadge.
- CascadePanel (wide): a left-to-right flow with @xyflow/react (React Flow) and @dagrejs/dagre layout: causes on the left, the focus story highlighted in the middle, effects on the right; depth control 1–3. Nodes are compact story cards (impact icon + colour, headline, region, time). Edges show mechanism labels and are styled by link type: reported solid, inferred dashed, projected dotted, conditional with a violet crowd-forecast badge; confidence as stroke opacity/width plus text on hover/focus. Conditional branches: group the YES and NO effects of each forecast in labelled lanes ("If YES · 62%" / "If NO · 38%" with the ProbabilityRing), from api.cascade branches. Click a node → open its story panel (replace focus); click an edge → evidence drawer: evidence snippets with source name, date and link (only when url exists), link type and confidence explained in plain words. Fit view, zoom controls, keyboard navigation between nodes (arrow keys) and an accessible list alternative ("View as list").
- "Project next effects" button (AI): calls runAi("projection", {story: {headline, so_what, region, sectors, impact, direction}, known_effects: [...headlines], regions: [ids and names of the story's region, its country and related regions]}, ProjectionResult); shows up to 3 dotted "AI projection" nodes clearly labelled "Projection, not news" with confidence ≤ 50%; nothing is saved. Handle AI states: unavailable (hide the button and say why on hover), declined, busy, error. The button costs the viewer's Claude usage in the test link: run only on click.
- Mobile: the cascade becomes a vertical flow or the list alternative by default.
Tests: dagre layout helper (positions, lanes for branches), edge styling by link type, data shaping from CascadeResponse, and render tests.`,
  },
  {
    label: 'region',
    port: 5204,
    prompt: `
Task: REGION PANEL and COMPARE. Files you own: frontend/src/features/region/**.
Data: api.region({id, window, sample}) and api.compare({ids, window, sample}); api.local_graph for the mini graph if you show one (you may instead render region.graph from the response).
Build:
- RegionPanel (kind "region", any level: bloc, country, state, city): breadcrumb (tap → that region, and flyTo on the globe), name and level, "Sample data" when relevant, KPI tiles (KpiTile with sparkline; note when KPIs are the country's, from kpi_scope), sector pulse (9 sectors, impact-weighted, ▲▼ vs previous window, with icons; tap a sector → set the lens), top stories (StoryCard compact; tap → story), decisions ahead (forecasts about the region: ForecastRow), children (states/cities/member countries with counts; tap → region), a small "connections" graph of the region's entities (render the response's graph with an SVG/canvas layout of your own, or react-force-graph-2d at a small size; tap a node → entity/story panel), and actions: "Compare", "Ask about this region" (open {kind:"ask", scope: id}), "Watch" (add to the watchlist via useUserValue("watchlist", [] as string[])).
- ComparePanel (wide): 2–3 regions side by side (add/remove via search: use api.search with types ["region"]), aligned KPI tiles where the same indicator exists, sector pulse bars side by side, story counts; clear empty states.
- Window comes from useNav; keep the panel fast (show cached data while refetching).
Tests: KPI alignment for compare, sector pulse shaping, breadcrumb building, render tests.`,
  },
  {
    label: 'forecasts',
    port: 5205,
    prompt: `
Task: FORECASTS VIEW and FORECAST PANEL. Files you own: frontend/src/features/forecasts/**.
Data: api.forecasts({sectors, regions, categories, sort, include_thin, profile, sample}) and api.forecast({id}).
Build:
- ForecastsView (top-level screen): a clean list/grid of crowd forecasts with filters (category chips, sector lens from useNav, region filter via search, "include thin markets" switch), sort (relevance, biggest moves, ending soon, most volume), each row: short title, ProbabilityRing or bar, 24 h change ▲▼, volume with unit, ends in, provider name, "crowd forecast" label, sparkline. A short explainer line: "Crowd forecasts are what forecasters expect, not facts. Play-money sources are labelled." Movers section at the top. Empty/sample states.
- ForecastPanel (kind "forecast"): the question in full, ProbabilityRing (lg), ProbabilityHistoryChart of history, outcomes and resolution rule, provider, volume with unit, liquidity, last update, end date, thin-market note, the link to the provider ONLY when url is non-null (rel="noreferrer", opens a new tab, label "View on <provider>"), related stories (tap → story), entities (EntityChip), and "If YES / If NO" branches with their effect stories (mechanism, confidence). Information only: never bet/trade wording.
- Mobile-friendly layout; keyboard accessible chart.
Tests: sorting/filter shaping, branch probability display, the no-link-when-url-null rule, render tests.`,
  },
  {
    label: 'business',
    port: 5206,
    prompt: `
Task: MY BUSINESS and OPPORTUNITIES. Files you own: frontend/src/features/business/**, frontend/src/features/opportunities/**, frontend/src/state/profile.ts (new).
Data: api.affects({profile, window, sample}), api.opportunities({sectors, regions, profile, window, sample}), api.search for picking entities, api.forecasts for suggested forecasts if useful. Profile type: Profile in contract.ts.
Build:
- state/profile.ts: the business profile stored per viewer with useUserValue("profile", emptyProfile) (artifact: private db subtree; web: localStorage), plus helpers (isEmpty, matches). Also the watchlist (useUserValue("watchlist", [] as string[])) and alert rules (useUserValue("alerts", ...)): simple in-app alerts = new stories since your last visit (useUserValue("last-seen", iso)) that match the profile or watchlist, shown as a badge/count on My Business.
- BusinessView (top-level screen "business"):
  - First run: a short, friendly onboarding (3 steps, skippable): sectors (chips), locations (regions via search), inputs/suppliers/markets/competitors (entities via search: commodities, organizations, infrastructure), keywords. Save as you go. Explain where it's saved ("Saved to your Claude account" / "Saved in this browser") using the store kind.
  - Then: "Affects you" feed from api.affects: each item with why it matched (matched entities, direct vs downstream path with the hop chain), relevance, impact, actions, tap → story; suggested forecasts; watchlist (regions/entities with latest activity counts; tap → panel); alerts since last visit; an "Edit profile" button.
- OpportunitiesView (top-level "opportunities"): an opportunity radar (polar/SVG chart: angle = sector, radius = momentum or relevance, dot = opportunity story; accessible list alternative) and a ranked list of cards: why now (so-what), suits (chips), momentum, related crowd forecast (ProbabilityRing), tap → story. Uses the profile when set.
- Never store names, emails or anything personal beyond the profile the viewer types; ids and short keywords only.
Tests: profile helpers and matching, alert counting since last visit, radar geometry, render tests.`,
  },
  {
    label: 'graph-entity',
    port: 5207,
    prompt: `
Task: KNOWLEDGE GRAPH and ENTITY PAGES. Files you own: frontend/src/features/graph/**.
Data: api.graph({types, sectors, regions, window, min_confidence, limit, sample}), api.local_graph({id, depth, limit}), api.entity({id}).
Build:
- GraphView (top-level "graph"): react-force-graph-2d (installed) on a canvas: nodes coloured by entity type token (read CSS variables at runtime; re-read on theme change) with type icons drawn or a legend, size by degree/importance, stories as small impact-coloured dots, causal links directional with type styling (dashed for inferred etc.), labels for important nodes only (avoid clutter; show on hover/zoom). Filters: entity types, sector lens (useNav), regions (search), window (useNav or "all"), minimum confidence slider, node limit. Time-lapse: a play button that reveals nodes by created_at over the window (respect reduced motion: step instead of animate). Click a node → entity panel (or story/forecast/region panel by type); hover highlights neighbours. A search box to focus a node. An accessible fallback list (top nodes and their connections). Calm, sleek; good on mobile (pinch zoom; simplified labels).
- EntityPanel (kind "entity"): name, type icon, facts (label/value), "located in" link, KPIs (KpiTile), timeline of events (tap → story), forecasts about it (with history sparkline), backlinks grouped by type, a local graph (depth 1–2) rendered small, and personal notes: a short textarea saved with useUserValue("notes", {} as Record<string, string>) keyed by entity id (show where it's saved). Regions open the region panel instead (registry handles kind "region"; here redirect if a region id arrives).
Tests: graph data shaping (filters, limit, time-lapse ordering), colour mapping, notes saving logic, render tests (mock react-force-graph-2d).`,
  },
  {
    label: 'ask-brief-search-settings',
    port: 5208,
    prompt: `
Task: ASK, DAILY BRIEF, SEARCH and SETTINGS. Files you own: frontend/src/features/ask/**, frontend/src/features/brief/**, frontend/src/features/search/**, frontend/src/features/settings/** (DesignPreview.tsx exists: keep it, link to it from Settings as "Design preview").
Data: api.ask_context({q, limit, sample}), api.brief({profile, sample}), api.search({q, types, limit}), api.meta({}). AI: runAi("ask", {question, context}, AskAnswer).
Build:
- AskPanel (kind "ask", optional q and scope): a question box with 3–4 suggested questions (from the scope, e.g. "What's driving fuel costs in India?"), then: retrieve with api.ask_context, show "Searching WorldGraph…", call runAi("ask", {question, context: <compacted context: stories with id, headline, so_what, region, first_seen, sources (name only), actions; links with from/to/type/mechanism/confidence; forecasts with id, short_title, probability, provider, volume, unit, updated_at>}, AskAnswer). Render up to 3 bullets, each with citation chips (tap → story panel), a mini cascade (from → mechanism → to, with link types), related crowd forecasts (ProbabilityRing), follow-up suggestions (tap to ask). "Not enough evidence" state when status says so or the context is empty: say so plainly and offer follow-ups. Remove any citation id that isn't in the context. Clear AI states: unavailable (explain: test link uses your Claude account; website uses WorldGraph AI), declined, busy (with Stop), errors. Keep a short history of this visit's questions. Ask spends the viewer's Claude usage in the test link: only on submit.
- BriefView (top-level "brief"): the six cards from api.brief in a calm, editorial layout (date, "Generated from stored data" note), each card with its items clickable; uses the profile if one is saved (useUserValue("profile", …) — read only; don't edit profile.ts which another agent owns: read the "profile" key with your own minimal type, or the Profile type from contract.ts); a "Copy as text" button.
- CommandSearch (Ctrl/Cmd+K, cmdk): debounced api.search, grouped results by type with icons and context, keyboard first; Enter opens the right panel (region → region panel + flyTo; story; entity; forecast); recent searches; quick actions ("Go to Forecasts", "Ask a question", "Toggle theme").
- SettingsPanel (kind "settings"): theme (dark/light/system), sample data (auto/on/off with an explanation), map borders (auto/India official view/international, with a one-line explanation), calm motion, AI status (engine label and what it costs: "Uses your Claude account while the app is open" vs "WorldGraph AI, daily limit"), where personal data is saved (store kind), data sources and attribution from api.meta (each source's attribution text and link), "About WorldGraph" (one paragraph), and the Design preview link.
Tests: context compaction for Ask, citation filtering, search grouping, settings persistence, render tests.`,
  },
]

// Resume support: args.resume maps a label to a branch holding an interrupted attempt.
const RESUME_FROM = (args && args.resume) || {}
const resumeNote = (label) => RESUME_FROM[label] ? `
RESUME FIRST: a previous attempt at this exact task was interrupted. Its unreviewed work is on branch ${RESUME_FROM[label]}. Start with \`git fetch origin ${RESUME_FROM[label]} && git merge --no-edit FETCH_HEAD\`, then review it critically against the task below, finish what's missing, and make every check pass.
` : ''

phase('Build')
const done = (args && args.done) || []
const todo = tasks.filter(t => !done.includes(t.label))
log('Launching ' + todo.length + ' agents in isolated worktrees (skipping ' + done.length + ')')
const results = await parallel(todo.map(t => () =>
  agent(COMMON + `\nYour label: ${t.label}. Your dev-server port: ${t.port}. Your database name: wg_dev_${t.label.replace(/-/g, '_')}.\n` + resumeNote(t.label) + t.prompt, {
    label: t.label,
    phase: 'Build',
    isolation: 'worktree',
    schema: {
      type: 'object',
      properties: {
        branch: { type: 'string' },
        commit: { type: 'string' },
        files: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
        checks: { type: 'string' },
        screenshots: { type: 'array', items: { type: 'string' } },
        concerns: { type: 'array', items: { type: 'string' } },
      },
      required: ['branch', 'commit', 'files', 'summary', 'checks', 'screenshots', 'concerns'],
    },
  }).then(r => r ? { label: t.label, ...r } : { label: t.label, failed: true })
))
return results

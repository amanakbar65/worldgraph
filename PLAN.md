# WorldGraph — Plan (v2)

**Status:** building the complete app (6 Oct 2026). `BUILD_BRIEF.md` is the original brief and is kept word for word. Where this plan differs from it, this plan wins.

## The owner's direction (6 Oct 2026)

- Claude builds the whole thing. The brief is a strong starting point, not a rulebook. Keep its core idea, screens and principles, and drop restrictions that don't help.
- Make it sleek, professional, simple, accurate and convenient to use.
- **One app, two ways to run it**, like Family Ledger:
  1. **Test link (now):** a private claude.ai Artifact. It reads live data through the owner's Supabase connector. The AI (headlines, "why it matters", actions, cascades, Ask) runs on the owner's own Claude account, **only while the app is open**. There is no API bill.
  2. **Website (later):** Netlify. It's fully built and documented, but **not deployed until the owner says so**. There, the AI runs on the Claude API with a **$2/day cap**.
- **Global app:** anyone, anywhere, sees the same information.
  - Every country drills down to states or provinces, then major cities.
  - Numbers follow the viewer's locale, and money stays in its own currency.
- **Live news every 15 minutes** from a GitHub Actions job. The repo is public, so the minutes are free.

## Architecture

```
Free sources (GDELT, RSS, USGS, GDACS) + Manifold forecasts
        │  every 15 min: GitHub Actions runs the Python pipeline (no AI)
        ▼
Supabase Postgres (PostGIS, pgvector, pg_trgm)
  tables: node / edge / story / causal_link / forecast / indicator …
  schema `api`: SQL functions that return ready-made JSON for every screen
        │
        ├── Test link: Artifact page → claude.use("mcp") → Supabase connector → select api.<fn>(…)
        │              AI: claude.use("sample") on the owner's account → api.save_analysis(…)
        └── Website:   Netlify Function /api/rpc → select api.<fn>(…)  (deployed later)
                       AI: Netlify Function /api/ask + pipeline job, Claude API, $2/day cap
```

- **The query layer lives in Postgres** (`api.*` functions returning JSON). Both ways of running the app call the same functions, so the logic exists once and is tested once with pytest against a real PostGIS database.
- **The frontend is a static single-page app** (Vite + React + TypeScript). The same build runs as an Artifact and on Netlify. A data adapter picks the transport (connector or HTTP), and an AI adapter picks the engine (`sample` or the API).
- **The pipeline is Python on GitHub Actions** (every 15 minutes), plus a production-only AI job with a spend cap.
- **Built-in sample data** (about 200 stories, about 30 forecasts) is clearly labelled. It makes the app complete before live data flows. Once live data exists, sample data is hidden by default and can be switched on in Settings.

## Changes from the brief, and why

| Brief | Now | Why |
| --- | --- | --- |
| Next.js frontend | Vite + React SPA | A static bundle runs both as an Artifact and on Netlify. No server rendering is needed. |
| FastAPI server | Postgres `api.*` functions + a thin Netlify function | No server to host; one query layer for both ways of running. Python stays for the pipeline and tooling. |
| India at state level, the world at country level | Every country to states/provinces and cities | The owner asked for a global app; Natural Earth and GDELT cover the whole world. |
| Beginner workflow, stopping after each phase | Claude builds end to end | The owner's direction. |
| Phases 0–5 with reviews | One complete build, then a test link | The owner's direction. |
| OpenFreeMap basemap | Our own vector layers (Natural Earth countries, states, cities, coastlines). OpenFreeMap streets are added on the website at high zoom. | Artifacts can't load map tiles from other sites, and our own layers give a calmer, consistent look. |
| Polymarket first | Manifold (play money) on everywhere; Polymarket adapter built, off by default, never shown in India | Legal: real-money markets are blocked or banned in some countries (India: MeitY block, 21 May 2026). |

Kept from the brief:
- the product principles (visual first, three taps to depth, three questions per insight, facts/inferences/forecasts kept apart, calm wording)
- every screen
- the knowledge-graph model, including the four causal link types
- the colour rules (amber risk, teal opportunity, slate neutral, violet forecasts; never red against green)
- no full article text
- no private individuals
- prediction markets as information only

India's official borders are shown to viewers in India, detected from the timezone or the site's geo header, with a switch in Settings.

## Screens (all built)

1. **Globe:**
   - event points and hex heat
   - pulses for items under an hour old
   - cross-border cascade arcs
   - forecast rings (fill = probability, glow = big 24-hour move)
   - sector lens chips
   - 24 h / 7 d / 30 d with replay
   - Top 5 now
   - smooth zoom into regions
2. **Region panel:**
   - breadcrumb
   - 4 KPI tiles with sparklines
   - sector pulse
   - top stories
   - upcoming decisions
   - mini local graph
   - actions: Cascades, Graph, Forecasts, Ask, Compare
3. **Story card and cascade view:**
   - links are solid (reported), dashed (inferred) or dotted (projected and conditional)
   - If YES / If NO branches
   - an evidence popover
4. **Knowledge graph:** global and local, with filters, hover focus, search-to-node and a time-lapse.
5. **Entity pages:**
   - facts
   - timeline
   - backlinks
   - forecasts
   - local graph
   - "impact on you"
   - private notes with [[links]]
6. **My Business:**
   - a two-minute chip onboarding
   - a private business graph
   - an "Affects you" feed
   - a forecast watchlist with alerts
7. **Opportunities:** cards plus a momentum × relevance radar.
8. **Forecasts view:** probability bars, detail with history, and If YES / If NO effects.
9. **Ask** (answers from stored data only, with citations) and a six-card **Daily brief**.

Also: Ctrl/Cmd+K search, a keyboard-friendly list view of everything on the globe, bottom sheets on mobile and side panels on desktop, dark and light themes, and reduced-motion support.

## Where user data lives

- **Test link:** the Artifact's private per-person store (`db` capability, `data/users/<id>/…`). It holds the business profile, watchlist, notes and last visit.
- **Website:**
  - Before sign-in, the browser stores this data.
  - With sign-in (Supabase Auth, email link), it moves to Supabase tables protected by row-level security.

## AI

- One set of prompts and output schemas in `prompts/`, used by both engines.
- **Analysis** turns a story cluster into:
  - a headline (≤12 words)
  - a so-what (≤20 words)
  - impact, direction, magnitude, horizon and confidence
  - sectors and entities
  - up to 3 actions (≤8 words each)
- **Cascades:** for a new story, candidate stories from the last 30 days that share entities, regions or sectors are proposed. The model judges plausibility and wording; links are stored with type, mechanism, confidence and evidence.
- **Ask:** retrieval from stored stories, forecasts and the graph, then an answer of 3 bullets plus a mini cascade with citations. It says "Not enough evidence" when that's true.
- **Test link:** analysis runs when the app opens, on the newest important stories (in batches, with a visible "Analysing 12 new stories…" status), and results are saved.
- **Website:** a pipeline job does the same with the Claude API (Claude Opus 5.5 at low effort; the model is a setting, `WG_AI_MODEL`). Every call is logged with its cost; analysis stops at 75% of the daily cap (US$2), leaving the rest for Ask. Stories the AI judges not to be business news are marked "skipped" and hidden.

## Data sources

See `SOURCES.md`. Each source's terms are checked before it's integrated and its attribution is shown in the app.

## Build order

1. Foundation:
   - this plan
   - the switch to Vite
   - the `api.*` contract and SQL functions
   - the sample dataset
   - map assets (Natural Earth TopoJSON with India's view)
2. Screens: globe and regions, stories and cascades, graph and entities, forecasts.
3. Business layer: My Business, Affects you, watchlist, Opportunities, Ask, Brief, Compare.
4. Live pipeline: GDELT, RSS, USGS, GDACS, Manifold; Polymarket adapter (off); GitHub Actions every 15 minutes; production AI job with the cap.
5. Website mode: Netlify functions, `netlify.toml` and a deploy guide (not deployed).
6. Quality: Playwright end-to-end tests, adversarial reviews, accessibility and performance passes. Then publish the test link.

## What the owner needs to do

- **Make the GitHub repo public:** worldgraph → Settings → General → Danger Zone → Change visibility.
- **When the pipeline is ready, add one secret** (`DATABASE_URL`) to GitHub. Claude will give exact steps.
- **Open the test link** and allow it to use the Supabase connector and Claude when asked.

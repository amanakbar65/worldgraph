# WorldGraph — Plan

**Status:** draft for your approval (6 Oct 2026). Nothing gets built until you say OK.
**Spec:** `BUILD_BRIEF.md` is the source of truth. This plan explains how I'll build it, which tools I'll use, and where I think the brief needs a fix.

Your goal for the feel of the app: **sleek, professional, simple, accurate and convenient.** Every screen gets checked against those five words.

---

## 1. Decisions so far

| Topic | Decision |
| --- | --- |
| Repository | A separate, private GitHub repo: `amanakbar65/worldgraph`. GitHub wouldn't let me create it, so you need to make it (two clicks, see section 12). Until then the brief and this plan sit on a temporary `worldgraph` branch of `Others`, and I'll move them across. |
| Database | A free Supabase project called `worldgraph` in Mumbai (`ap-south-1`), created 6 Oct 2026. It's empty and nothing is stored in it yet. |
| Users | India and abroad. Viewers in India see ₹ with lakh/crore; everyone else sees $ with million/billion. Each viewer can switch. Forecast sources are gated by the viewer's country. |
| Sample data | Balanced across all nine sectors, covering India and the world, not built around one industry. Phase 4 ships three ready-made demo business profiles you can switch between. |

---

## 2. What I checked, and where the brief needs a fix

I checked the brief's facts and tools against what's current in October 2026.

**These are correct as written:**
- MeitY ordered Polymarket blocked in India on 21 May 2026. India's Online Gaming Rules have been in force since 1 May 2026 and treat prediction markets as money games. Kalshi was reported to be next.
- Manifold has been play-money only since March 2025, when it shut down its real-money mode.
- Claude Haiku 4.5 and Claude Sonnet 5.5 exist.
- Option A from the brief works today. deck.gl's docs state that MapLibre's globe projection is fully supported. Current versions are MapLibre GL JS 6.12 and deck.gl 9.4.

**Proposed fixes and additions:**

1. **India's borders.** This item is new, and it matters. Standard world-map data, including the default Natural Earth files and OpenStreetMap tiles, draws Jammu & Kashmir, Ladakh and Arunachal Pradesh differently from India's official map. Showing an incorrect map of India can cause legal trouble in India, and it would put off Indian users.
   **Fix:** we draw all country and state borders ourselves using India's official depiction. Natural Earth publishes an "India point of view" edition, and we'll pair it with India state boundaries that match the Survey of India. The basemap's own border lines get hidden. Please add this to the list for your lawyer.
2. **Node IDs.** The brief says to use the Wikidata QID as the ID when one exists. But we usually find a node's QID later, during linking, and the ID would then change, which breaks links and saved notes.
   **Fix:** each node gets a permanent, readable ID such as `region:IN-GJ` or `commodity:cotton`. The QID is stored in its own column, kept unique, and used for matching.
3. **Metaculus needs an account token.** Every Metaculus API call requires a token from a free account. Manifold's read API needs no key.
   **Fix:** Phase 2 turns on **Manifold** as the non-money forecast provider. Metaculus can be added later if you're happy to create an account and its terms allow our use.
4. **Some "free" sources need free keys:** NASA FIRMS, FRED, UN Comtrade, data.gov.in and Metaculus. I'll ask you before each one, in the phase that needs it.
5. **Supabase free-plan limits.** The free plan allows 500 MB, and raw news fills that quickly.
   **Fix:** raw articles are kept for 14 days. Stories, the graph and forecast history are kept permanently. An admin page shows how much space is used. Free projects also pause after 7 days without activity; once the pipeline runs every 15 minutes, it keeps the project awake.
6. **Where the jobs run before Phase 5.** Until we deploy, the 15-minute jobs run only while your PC is running them. That's fine for building. Phase 5 picks a host, and I'll ask before anything paid.
7. **My cloud workspace can't reach the data sources.** It can only reach package registries and GitHub. Phases 0 and 1 don't need the sources. For Phase 2 you have two options:
   - Allow the source sites in this environment's **Network access** setting. I'll give you the exact list.
   - Or I build against saved sample responses, and you run the live fetch on your PC.

   Polymarket is built against sample responses from its docs either way, as your rules require.
8. **Real-money gating fails closed.** If we can't tell which country a viewer is in, we treat them as restricted. The server filters forecasts out before sending anything, so hidden forecasts never reach the browser.
9. **Sample data must never pass as real news.** The sample stories are made up but realistic. To keep it that way:
   - Every screen shows a **Sample data** badge.
   - Sample evidence has no outbound links.
   - Real company names appear only in true background facts, such as where a plant is.
   - Made-up events about a specific company use invented company names.
10. **Sonnet 5.5 costs only twice as much as Haiku 4.5** ($2 and $10 per million input and output tokens, against $1 and $5). Model names live in config. In Phase 2 I'll compare extraction quality on both models before recommending one.
11. **Screen readers can't read the globe**, because it's a canvas. Every globe view therefore gets an equivalent **List view** that works with a keyboard and a screen reader.
12. **Hosting note for Phase 5:** Vercel's free plan is for non-commercial use only. Cloudflare Pages, which Family Ledger uses, is an option we'll compare then.

---

## 3. Architecture at a glance

```
 Free sources & forecast providers          (GDELT, RSS, USGS, Manifold, Polymarket[off], …)
                 │
                 ▼
 Python jobs  ── news pipeline (every 15 min) ── forecast sync (every 5–15 min)
                 │      ingest → cluster → gate → extract → link → cascades → score → match
                 ▼
 PostgreSQL on Supabase  (PostGIS for maps, pgvector for similarity; graph = node + edge tables)
                 │
                 ▼
 FastAPI  (/api/…; region gating + attribution applied here)
                 │   JSON, polled every 60 s
                 ▼
 Next.js web app  (globe, panels, cascades, graph, entity pages, forecasts)
```

The LLM is called only by the pipeline jobs and by Ask. Phases 0 and 1 make no LLM calls.

---

## 4. Tech choices

| Area | Choice | Why |
| --- | --- | --- |
| Python tooling | **uv** | It installs Python 3.12 for you and runs everything with one command. You don't install Python separately. |
| API | **FastAPI** + **Pydantic** | As in the brief. Popular and well documented, and it generates API docs automatically at `/docs`. |
| Database access | **psycopg 3** + plain **SQL migration files** | The graph queries are recursive SQL, which is clearer written as SQL. Plain SQL is also easier to learn from than an ORM. |
| Database | **Supabase Postgres** with **PostGIS** + **pgvector** | As in the brief. No Postgres install on Windows. |
| Scheduler (Phase 2) | **APScheduler** in one worker process | Simple, and enough for the MVP. |
| Embeddings (Phase 2) | **sentence-transformers**, a small multilingual model, CPU-only | Free and local. I'll install the CPU-only build of PyTorch to keep the download small. |
| Spatial bins | **H3** (`h3` for Python, `h3-js` in the browser) | Hex heat at each zoom level. |
| Web app | **Next.js 16**, TypeScript, **Tailwind CSS 4**, **shadcn/ui**, **lucide** icons, **Inter** font | As in the brief. |
| Globe and map | **Option A:** **MapLibre GL JS** globe + **deck.gl** layers | See below. |
| Basemap tiles | **OpenFreeMap** | Free with no key, no sign-up and no view limits, and commercial use is allowed. The map data comes from OpenStreetMap, with attribution shown. I'll restyle it dark to match the app. |
| Knowledge graph | **react-force-graph-2d** | As in the brief. Sigma.js is the fallback if it gets slow. |
| Cascade view | **React Flow** (`@xyflow/react`) + **dagre** layout | Cascades are small (under about 30 nodes). dagre is tiny and simple; elkjs is much heavier and we don't need it. |
| Charts | **Recharts**, through shadcn/ui's chart component, for full-size charts | One library, themed like the rest of the app. Sparklines, probability rings and bars are small hand-made SVG components, which keeps the globe screen light. |
| Data loading | **TanStack Query** | Caching, skeleton states and polling every 60 seconds. |
| UI state | The **URL** holds what you're looking at; **Zustand** holds small UI-only state | Links and the browser's back button work everywhere. |
| Search | shadcn **Command** (Ctrl/Cmd+K) | Search from anywhere. |
| Mobile sheets | shadcn **Drawer** (vaul) | Bottom sheets with snap points. |
| Tests | **pytest** for the backend; **Vitest** for frontend logic; **Playwright** for a click-through smoke test that fails on any console error | Covers the brief's definition of done. |
| Code style | **ruff** for Python; **ESLint** + **Prettier** for TypeScript | Automatic formatting, so you don't have to think about it. |

**Why Option A (MapLibre globe + deck.gl) over Option B (react-globe.gl):**
- It's one map engine with one camera. The globe flattens into a detailed 2D map as you zoom in, which is exactly the brief's "zoom past country level" behaviour, with no hand-off.
- Every layer exists once: points, hex heat, arcs, borders and labels. Option B needs a second map engine at country level, a visible jump, two copies of every layer and a bigger download, which is harder on a mid-range phone.
- Keyboard pan and zoom are built in, and basemap labels appear naturally as you zoom.
- What we give up is react-globe.gl's ready-made glow effects. I'll recreate the look with MapLibre's atmosphere, a soft star-field background and deck.gl arcs.

**How each globe element is drawn:**
- Events are deck.gl points.
- Hex heat is deck.gl H3 hexagons, shown when zoomed out.
- Cross-border cascades are deck.gl great-circle arcs.
- Forecast rings are small SVG markers. There are only a few dozen, they stay crisp, they're focusable with the keyboard and they carry screen-reader labels. Their violet ring shape can't be confused with an event dot.

---

## 5. Data model

Everything is nodes and typed edges, as in the brief, with a few typed side tables so queries stay simple and fast.

| Table | Holds |
| --- | --- |
| `node` | Every entity: `id` (permanent and readable), `type`, `subtype`, `name`, `aliases`, `summary`, `qid` (Wikidata, optional), `props`, `geom` (PostGIS), `is_sample` |
| `edge` | Structural, mention and forecast edges: `src`, `dst`, `type`, `props` (for example value and year on `exports_to`), validity dates |
| `story` | One row per Story node: headline (12 words or fewer), so-what (20 words or fewer), event type, impact (risk, opportunity or neutral), direction, magnitude 1–5, horizon (now, weeks or months), confidence, importance, first and last seen, sectors, H3 cell |
| `article` | Headline, URL, source, date, language and at most a one-sentence snippet. **No full text, ever.** |
| `causal_link` | Story → story: `link_type` (reported, inferred, projected or conditional), mechanism (2–4 words), direction, expected lag, confidence, `forecast_id` + outcome for conditional links, method, model version, timestamp |
| `evidence` | For each causal link: source name, URL, date and a one-sentence snippet |
| `forecast`, `forecast_snapshot` | Question (full title plus a short title of 12 words or fewer), outcomes, end date, resolution rule, provider, a real-money flag, category; and the time series of probability, volume and liquidity |
| `indicator_series`, `indicator_point` | KPI time series attached to a region or commodity |
| `region_agg` | Pre-computed counts and risk/opportunity scores per region or H3 cell, per sector and time window, for fast map rendering |
| `source` | Licence and attribution text for each data source (shown in the app) |
| Later | `user_profile`, `user_entity`, `note`, `watchlist`, `alert` (Phases 4–5), `llm_call_log` (Phase 2) |

Regions form a tree (country → state → district → city) through `part_of` edges, so other countries can be deepened later without rework. The map uses simplified borders served as small static files, while exact shapes stay in PostGIS.

---

## 6. API

All endpoints are read-only in Phases 0–3. Every response carries attributions and the viewer's allowed forecast providers.

- `GET /api/meta`: sectors, entity types, colours, attributions, the viewer's region and allowed providers
- `GET /api/globe?window=24h&sectors=…`: points, hexes, arcs and forecast rings in a compact format
- `GET /api/top?window=…`: the "Top 5 now" stack, including the biggest odds moves
- `GET /api/regions/{id}`: everything the region panel needs; `…/children` returns sub-region shading
- `GET /api/stories/{id}` and `GET /api/stories/{id}/cascade`: the story card and its cascade with branches
- `GET /api/entities/{id}`: the entity page, with backlinks, timeline and forecasts
- `GET /api/graph?…` (global, filtered) and `GET /api/graph/local/{id}?depth=1..3`
- `GET /api/forecasts?…` (list) and `GET /api/forecasts/{id}` (detail, history and branches)
- `GET /api/search?q=…`: one search across every node type

---

## 7. Look and feel

- **Dark by default**, with a near-black space background behind the globe. A light theme is one tap away.
- **Impact colours**, always paired with an icon and ▲/▼:
  - risk: amber
  - opportunity: teal
  - neutral: slate

  There's never red against green.
- **Forecasts** get their own violet, a "crowd" icon and a ring shape. The percentage is large and the 24-hour change is shown in points (for example ▲ 8). Thin markets are faded and tagged "thin market".
- **One fixed colour per entity type**, the same on the globe, in the graph and on chips. I'll check every colour against WCAG AA contrast in both themes and against common colour blindness with a contrast and colour-blindness checker.
- **Inter, at most three text sizes per screen**, with large numbers.
- **Desktop** gets a right-hand side panel. **Mobile** gets a bottom sheet with three heights: peek, half and full. Controls sit within thumb reach.
- **Three taps to depth:** icon + headline → card with the so-what and three chips → cascade, graph and sources.
- **Motion** is limited to smooth camera flights and a soft pulse on items from the last hour, all switched off when the device asks for reduced motion.
- **Skeleton loaders** instead of spinners, and friendly empty states that suggest a next tap.

**Home screen, desktop:**
```
┌──────────────────────────────────────────────────────────────────────┐
│ ◎ WorldGraph   [⌘K Search…]        Energy Agri Mfg Logistics …  ◐ ☰ │
│                                                                      │
│   ┌ Top 5 now ┐                                                      │
│   │ ▲ icon  headline   │          ( dark 3D globe )                  │
│   │ ◔ 62%  odds moved  │       points · hex heat · arcs · ◯ rings    │
│   │ …                  │                                             │
│   └────────────────────┘                                             │
│                                                                      │
│   ◀ ▶ replay   [24 h | 7 d | 30 d] ──●────────────    ◯ Forecasts    │
│                                                    Sample data · ©   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 8. Sample dataset (Phase 0)

- **About 200 stories** grouped into about 25 storylines. Each storyline has 4–12 linked stories with causes, effects and evidence. The stories cover all nine sectors, every Indian state and union territory, about 25 major Indian cities and about 40 other countries.
- **About 400 entities:**
  - regions
  - companies
  - about 30 commodities with HS codes
  - ports and chokepoints (Hormuz, Bab-el-Mandeb, Suez, Malacca, Mundra, JNPT, Chennai and others)
  - policies
  - indicators with sparkline data
- **About 30 forecasts** with 30–90 days of probability history. Some moved 10 or more points in a day, some are thin markets, and about 10 drive **If YES / If NO** branches.
- **All four causal link types** appear: reported, inferred, projected and conditional.
- **Times are relative to "now"**, so the app always looks current, and a few items are under an hour old so you can see the pulse.
- **How it's built:** readable storyline files plus a small Python generator. Tests check every word limit: headline 12 words, so-what 20 words, action 8 words.

Example storylines (all fictional, labelled as sample):
- Red Sea shipping disruption → container freight rates up → margins of engineering and apparel exporters → air freight for pharma
- Weak monsoon in the Deccan → pulse and onion prices → food inflation → RBI rate decision (a forecast with If YES / If NO) → home loans and real estate
- OPEC+ output decision (a forecast) → crude prices → diesel → trucking and airline costs
- US tariff talks with India (a forecast) → Tiruppur and Surat textile orders; the India–EU trade deal as the opportunity side
- Heatwave in North India → record power demand → coal logistics; cooling appliances as the opportunity
- Earthquake near a chip hub → chip supply → auto production in Pune and Chennai
- Rare-earth export curbs → EV motor makers → India's critical-minerals push
- Palm-oil export levy → edible-oil import costs → FMCG margins
- EU carbon border tax → Indian steel and aluminium exporters; green steel as the opportunity
- Cyclone on the east coast → Paradip and Visakhapatnam ports → metals logistics

---

## 9. Phases and small steps

Each step is small and leaves something working, and each ends with a commit. I stop after every phase for your review and give you a 3–5 step "how to try it" guide with exact PowerShell commands and what you should see.

### Phase 0: Plan and scaffold (next, once you approve)
1. Move the brief and plan into the new repo. Add the root README, `.gitignore`, `.env.example`, a short `CLAUDE.md` (under 200 lines), `PROGRESS.md` and `SOURCES.md` (every source with its terms, limits and attribution; items not yet checked are marked "to verify before use").
2. Backend skeleton: a uv project, FastAPI with `/api/health`, ruff and pytest. **One command:** `uv run wg api`.
3. Frontend skeleton: Next.js, Tailwind, shadcn/ui, Inter, dark and light themes. **One command:** `npm run dev`.
4. Database schema as SQL migrations. `uv run wg db migrate` applies them to Supabase. You'll paste the connection string into `.env`, and I'll show you where to copy it from. It is never committed.
5. Sample dataset: storylines, generator and validation tests. `uv run wg seed load` loads it.
6. Update `PROGRESS.md`, and give you the how-to-try guide.

**What you'll install in Phase 0** (I'll explain each one when we get there):
- Git for Windows
- Node.js LTS
- uv

You'll also add a few VS Code extensions: Python, Ruff, ESLint and Tailwind CSS.

### Phase 1: Visual shell on sample data
1. App shell: header, Ctrl/Cmd+K search, side panel and bottom sheet, theme toggle, "Sample data" badge, attributions.
2. Globe:
   - points and hex heat
   - pulses
   - arcs
   - sector lens chips
   - 24 h / 7 d / 30 d slider with replay
   - "Top 5 now"
3. Forecasts layer: probability rings, with a glow on big 24-hour movers.
4. Zoom into a region: camera flight, Indian states shaded by activity, city bubbles, detailed 2D map.
5. Region panel:
   - KPI tiles with sparklines
   - sector pulse
   - top stories
   - upcoming decisions with gauges and 24-hour change
   - mini local graph

   The action buttons appear only once each one works.
6. Story card and cascade view: line styles for each link type, If YES / If NO branches, and an evidence popover.
7. Graph view: force-directed, with hover highlighting, filters, search-to-node and a local graph with a depth slider.
8. Entity page: summary, chips, timeline, "Linked from", forecasts panel and local graph.
9. Forecasts view and detail: probability bars, history chart and the permanent "crowd forecasts can be wrong" note.
10. List view, keyboard shortcuts, reduced motion and a mobile pass.
11. Playwright click-through test with zero console errors.

### Phase 2: Live data v1
- News pipeline:
  - GDELT 2.0, using its 15-minute files, which already carry locations
  - about 10 RSS feeds, including PIB, RBI and SEBI; we'll choose the list together
  - USGS

  Then clustering, a rules gate, a small LLM gate and LLM extraction into validated JSON.
- Forecast sync: Manifold switched on. Polymarket's adapter is built against sample responses, sits behind its own flag, and is **off by default** and hidden wherever restricted.
- An LLM cost log, a daily spend cap and caching, so an unchanged item is never processed twice.
- **Before the LLM is switched on,** I'll give you a cost estimate based on measured volumes.
- The frontend switches to real data, and the sample data can be cleared with one command.

### Phase 3: Knowledge graph and cascades
Wikidata linking; structural edges (trade flows for top commodities from UN Comtrade, ports, company ownership); causal inference; projected and conditional impacts; linking forecasts to entities; the graph time-lapse; full entity pages.

### Phase 4: Business layer
My Business onboarding (chips and search, about two minutes, with three demo profiles), the "Affects you" feed, forecast watchlist and alerts (a threshold, or a move of 10+ points in a day), Opportunities with the radar, Ask with citations ("not enough evidence" when true), the six-card daily brief, and region Compare.

### Phase 5: Polish and launch prep
Performance and mobile polish, accounts (Supabase Auth fits here; the free plan includes it), region gating checked against your legal advice, export any view as an image, deployment options (I'll ask before anything paid) and basic privacy-friendly analytics.

---

## 10. Costs

- **Phases 0–1: free.** The Supabase free plan, OpenFreeMap tiles and no LLM calls.
- **From Phase 2: the Claude API is the main cost.** A rough first estimate, to be replaced with measured numbers before anything is switched on:

| Step | Model | Assumed volume per day | About |
| --- | --- | --- | --- |
| Relevance gate | Haiku 4.5 | about 800 story clusters | $0.70 |
| Extraction | Haiku 4.5 | about 250 stories | $1.10 |
| Wikidata disambiguation | Haiku 4.5 | about 250 stories | $0.45 |
| Cascade reasoning | Sonnet 5.5 | about 250 stories | $3.50 |
| Forecast linking | Haiku 4.5 | about 30 new questions | $0.10 |
| **Total, before savings** | | | **about $6 per day** |

- Prompt caching, a tighter rules gate and running cascades only for important stories should bring this to about **$2–4 per day ($60–120 a month)**. I'll suggest starting with a **$2 per day cap**, which you control in `.env`.
- **Ask** costs about $0.01–0.03 per question on Sonnet 5.5.
- No other paid services are planned. I'll ask before any.

---

## 11. How we'll work

- I build and test in this cloud workspace, including against a local copy of Postgres for tests. You run the app on Windows.
- Every step gives you exact PowerShell commands and tells you what you should see.
- Secrets live only in `.env`, which is never committed. `.env.example` lists every key and where to get it.
- `PROGRESS.md` is updated after each step, so any new session can pick up where the last one stopped.
- If something in the brief turns out to be wrong or unwise, I'll say so and propose a fix instead of quietly working around it.

---

## 12. What I need from you

1. **Approve this plan,** or tell me what to change.
2. **Create the empty GitHub repo** (GitHub wouldn't let me):
   - At <https://github.com/new>, set the name to `worldgraph`, choose **Private**, and leave "Add a README" **unticked**. Click **Create repository**.
   - If the Claude GitHub app is limited to selected repositories, add `worldgraph` to it. You can manage this at <https://claude.ai/connect-github>.

   Tell me when it's done, and I'll move the brief and plan across, then delete the temporary branch in `Others`.
3. Nothing else for now. Later phases will ask for free keys only when they're needed.

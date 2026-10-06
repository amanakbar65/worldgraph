# WorldGraph — notes for Claude

A visual world-knowledge app for businesses: a globe, a knowledge graph, cascades and crowd forecasts.

- **Spec:** `BUILD_BRIEF.md` (the source of truth; keep it word for word).
- **Approved plan and changes to the brief:** `PLAN.md`. Where the two differ, PLAN.md wins.
- **Log:** `PROGRESS.md`. Read it first; update it after every step.
- **Data sources and their terms:** `SOURCES.md`. Add a row *before* integrating any source.

## Working with the owner

- The owner is a beginner, learning Python, using VS Code on **Windows**. Give exact **PowerShell** commands and say what they should see.
- Work in small, working steps. Commit after each step with a clear message (`Phase N: what changed`).
- Explain any new tool before installing it. Prefer simple, popular, well-documented libraries.
- Ask before anything that costs money, before creating accounts, and before big architecture changes.
- Stop after each phase for review, with a 3–5 step "how to try it" guide.
- If the brief is wrong or unwise, say so and propose a fix. Never quietly work around it.

## Layout

```
backend/    Python 3.12 (uv): FastAPI API, pipeline jobs, sample data, SQL migrations
  src/worldgraph/
    api/        FastAPI app (main.py) and routes
    db/         connection helpers + migrations/NNNN_name.sql
    seed/       sample data: entities/*.yaml, storylines/*.yaml, build + load
    geo/        gazetteer builder (Natural Earth)
    cli.py      the `wg` command
  tests/      pytest
frontend/   Next.js (TypeScript, Tailwind, shadcn/ui, lucide)
```

## Commands

| What | Command (from the folder shown) |
| --- | --- |
| API (port 8000) | `backend> uv run wg api` |
| Apply DB migrations | `backend> uv run wg db migrate` |
| Load / refresh sample data | `backend> uv run wg seed load` |
| Check sample data only | `backend> uv run wg seed check` |
| Backend tests + lint | `backend> uv run pytest` and `uv run ruff check .` |
| Web app (port 3000) | `frontend> npm run dev` |
| Frontend checks | `frontend> npm run lint`, `npm run typecheck`, `npm test` |

## Conventions

- **Node IDs** are permanent and readable: `type:slug`, e.g. `region:in-gj`, `commodity:crude-oil`, `story:red-sea-attacks`. Wikidata QIDs live in `node.qid`, never in the ID.
- **Region IDs:** country `region:<iso2>`; state `region:<iso-3166-2>`; city `region:<state-or-country>.<slug>`. All lowercase.
- **Migrations:** numbered plain SQL in `backend/src/worldgraph/db/migrations/`. Never edit a migration that has been applied; add a new one.
- **Text limits** (enforced in Pydantic, and in SQL where possible): headline ≤ 12 words, so-what ≤ 20, each action ≤ 8, mechanism 2–4 words, evidence snippet = one sentence.
- **Facts, inferences and forecasts stay visibly separate.** Causal links always carry a link type and confidence. Forecasts always carry the source, volume and last update.
- **Never store full article text.** Store the headline, URL, source, date and at most a one-sentence snippet.
- **Sample data** is flagged `is_sample = true`, shown with a "Sample data" badge, and its evidence has no URLs. Real company names appear only in true background facts.
- **Prediction markets:** information only. No trading, betting, wallets, referral links or "bet"/"trade" wording. Real-money providers are off by default and gated by viewer country, failing closed. Never link to a platform blocked for that viewer. Never route around blocks.
- **Design:** dark by default, plus a light theme.
  - Risk is amber, opportunity is teal, neutral is slate. Always pair colour with an icon or ▲ ▼. Never use red against green.
  - Forecasts are violet with a crowd icon and a ring shape.
  - Use lucide icons only, the Inter font, and at most 3 text sizes per screen.
  - Respect reduced motion. Meet WCAG AA, and label every control for screen readers.
- **Python:** ruff for lint and format; type hints; Pydantic models at boundaries; psycopg 3 with plain SQL.
- **TypeScript:** strict mode; colours come from CSS tokens in `globals.css`, never hard-coded.
- **Secrets** live only in `.env` (git-ignored). Document every key in `.env.example`.

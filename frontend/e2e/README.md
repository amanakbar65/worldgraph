# End-to-end tests

Playwright drives the real app in headless Chromium at desktop (1440 × 900) and phone (Pixel 7, 390 × 844) sizes: the website (`e2e/*.spec.ts`, projects `desktop` and `phone`) and the claude.ai test link (`e2e/artifact/`, projects `artifact-desktop` and `artifact-phone`).

## Before the first run

A Postgres with the migrations and the sample data (the website reads it through the dev server's `/api/rpc`):

```sh
pg_ctlcluster 16 main start        # the cloud workspace; elsewhere, any PostGIS 16
psql postgresql://wg:wg@localhost:5432/postgres -c "create database worldgraph_dev"
cd backend
DATABASE_URL=postgresql://wg:wg@localhost:5432/worldgraph_dev uv run wg db migrate
DATABASE_URL=postgresql://wg:wg@localhost:5432/worldgraph_dev uv run wg seed load
```

Chromium: `/opt/pw-browsers/chromium` is used when present; elsewhere run `npx playwright install chromium` once.

## Run (from `frontend/`)

| Command                                 | What it runs                                                       |
| --------------------------------------- | ------------------------------------------------------------------ |
| `npm run e2e`                           | Everything, headless.                                              |
| `npm run e2e:website`                   | The website only (`vite` on port 5301).                            |
| `npm run e2e:artifact`                  | The test link only (`npm run build:artifact`, then `vite preview` on port 5351). |
| `npm run e2e -- e2e/ask-chat.spec.ts`   | One file; add `-g "New chat"` for one test, `--project=phone` for one size. |

Playwright starts both servers (and builds the test link) unless something already answers on their ports; then it uses those, so restart them after changing code. Environment: `DEV_DATABASE_URL` (default `postgresql://wg:wg@localhost:5432/worldgraph_dev`), `E2E_PORT` and `E2E_ARTIFACT_PORT` (use servers you started), `E2E_WORKERS` (default 2: the globe draws WebGL on the CPU), `E2E_SHOTS` (screenshot folder, below).

A failure leaves a trace and a screenshot in `test-results/` and a report in `playwright-report/` (`npx playwright show-report`). Tests also save screenshots for a person to look at in `test-results/screenshots/<project>/`. Both folders are git-ignored.

## How the tests work

- `fixtures.ts` gives every test fresh settings (dark theme, calm motion, Sample data on, since the test database holds only sample data; change them with `test.use({ settings: … })`). It fails a test on any uncaught page error or any request to another host.
- Website tests compare the screen with what the database says, through the same `/api/rpc` the page uses (`rpc()`).
- Ask's AI is a stand-in: `ask-chat.spec.ts` answers `POST /api/ai` itself, so no AI account is needed.
- The globe's camera and slow turn are read through the dev build's `window.__wgGlobe` hook (`home.spec.ts`).
- The test-link tests start as a first-time viewer (Sample data at its default, off). They check the shipped live snapshot as it is, and rewrite its kind (sample or live) on its way to the page for the rest.
- A test that finds an app bug stays in the suite marked `test.fail()`, with a comment naming the bug; once the app is fixed it "unexpectedly passes" and the marker comes off.

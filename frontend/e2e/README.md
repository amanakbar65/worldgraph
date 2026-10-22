# End-to-end tests

Playwright tests that drive the real app in Chromium, headless, at desktop (1440 × 900) and phone (Pixel 7, 390 × 844) sizes.

## What you need

- A Postgres with the migrations and the sample data (the website mode reads it through the dev server's `/api/rpc`):

  ```sh
  pg_ctlcluster 16 main start        # the cloud workspace; elsewhere, any PostGIS 16
  psql postgresql://wg:wg@localhost:5432/postgres -c "create database worldgraph_dev"
  cd backend
  DATABASE_URL=postgresql://wg:wg@localhost:5432/worldgraph_dev uv run wg db migrate
  DATABASE_URL=postgresql://wg:wg@localhost:5432/worldgraph_dev uv run wg seed load
  ```

- Chromium: the cloud workspace's `/opt/pw-browsers/chromium` is used when present; elsewhere run `npx playwright install chromium` once.

## Run

From `frontend/`:

| Command                               | What it runs                                                                                                               |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `npm run e2e`                         | The website suite (`e2e/*.spec.ts`), headless. It starts `vite` on port 5301 unless one is already running there.          |
| `npm run e2e -- --project=phone`      | One screen size (`desktop` or `phone`).                                                                                    |
| `npm run e2e -- e2e/ask-chat.spec.ts` | One file (add `-g "New chat"` for one test).                                                                               |
| `npm run e2e:artifact`                | Builds the claude.ai test link (`npm run build:artifact`) and runs `e2e/artifact/` against it (`vite preview`, port 5351). |
| `npm run e2e:artifact:run`            | The same against the existing `dist-artifact/`.                                                                            |
| `npm run e2e:all`                     | Both suites.                                                                                                               |

Settings by environment variable: `DEV_DATABASE_URL` (default `postgresql://wg:wg@localhost:5432/worldgraph_dev`), `E2E_PORT` and `E2E_ARTIFACT_PORT` (to reuse a server you started yourself), `E2E_WORKERS` (default 2; the globe draws WebGL on the CPU, so more workers rarely help).

Failures leave a trace and a screenshot in `test-results/` and a report in `playwright-report/` (`npx playwright show-report`). Tests also save screenshots for a person to look at under `test-results/final-e2e/<project>/`.

## How the tests work

- `fixtures.ts` gives every test fresh settings in localStorage (dark theme, calm motion; change them with `test.use({ settings: { … } })`), and fails a test on any uncaught page error or any request to a host other than the app's own.
- Tests compare the screen with what the database says, by calling the same `/api/rpc` the page uses (`rpc()`).
- Ask's AI is a stand-in (`ask-chat.spec.ts` answers `POST /api/ai` itself), so no AI account is needed; without it the dev server has no AI and Ask says so (`ask.spec.ts`).
- The globe's camera and slow turn are read through the dev build's `window.__wgGlobe` hook (`home.spec.ts`).
- The test-link tests set the bundled snapshot's kind themselves (sample or live), so they hold whichever snapshot `npm run snapshot` last built.
- A test that finds an app bug stays in the suite marked `test.fail()`, with a comment naming the bug; once the app is fixed it "unexpectedly passes" and the marker comes off.

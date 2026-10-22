# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: artifact.spec.ts >> inside claude.ai without live data >> when the viewer hasn't allowed the connector >> with Sample data on >> a story from the snapshot says how to fix it
- Location: e2e/artifact/artifact.spec.ts:433:9

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByRole('complementary', { name: 'Details' }).or(getByRole('dialog', { name: 'Details' })).getByRole('alert')
Expected substring: "This page needs your OK"
Received string:    "This view needs live dataLive data comes through the Supabase connector in claude.ai. Meanwhile the globe, Forecasts and Brief show sample data."
Timeout: 30000ms

Call log:
  - Expect "toContainText" getByRole('complementary', { name: 'Details' }).or(getByRole('dialog', { name: 'Details' })).getByRole('alert') with timeout 30000ms
  - waiting for getByRole('complementary', { name: 'Details' }).or(getByRole('dialog', { name: 'Details' })).getByRole('alert')
    54 × locator resolved to <div role="alert" class="flex flex-col items-center text-center gap-3 px-6 py-10">…</div>
       - unexpected value "This view needs live dataLive data comes through the Supabase connector in claude.ai. Meanwhile the globe, Forecasts and Brief show sample data."

```

```yaml
- alert:
  - paragraph: This view needs live data
  - paragraph: Live data comes through the Supabase connector in claude.ai. Meanwhile the globe, Forecasts and Brief show sample data.
```

# Test source

```ts
  350 |     const dialog = page.getByRole("dialog", { name: "Search WorldGraph" });
  351 |     await expect(
  352 |       dialog.getByText(/Gujarat|needs the live database|isn't available|live data/).first(),
  353 |     ).toBeVisible();
  354 |   });
  355 | 
  356 |   for (const theme of ["dark", "light"] as const) {
  357 |     test.describe(`${theme} theme`, () => {
  358 |       test.use({ settings: { theme, calm: true } });
  359 |       test("the not-connected first frame has no serious or critical axe problems", async ({ page }) => {
  360 |         await page.goto("/");
  361 |         await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();
  362 |         await expect(page.locator("html")).toHaveAttribute("data-wg-theme", theme);
  363 |         await expect(statusTitle(page)).toHaveAttribute("title", NOT_CONNECTED);
  364 |         const problems = await seriousA11yProblems(page);
  365 |         expect(problems, problems.map((p) => `${p.id}: ${p.targets.join(" | ")}`).join("\n")).toEqual([]);
  366 |       });
  367 |     });
  368 |   }
  369 | });
  370 | 
  371 | test.describe("outside claude.ai, a live snapshot (real news)", () => {
  372 |   // Taken three hours ago: shown to every viewer, with its time, never as live data.
  373 |   test("stands in for every viewer, labelled as a snapshot with its time", async ({
  374 |     page,
  375 |     isPhone,
  376 |   }, testInfo) => {
  377 |     const asOf = new Date(Date.now() - 3 * 3600_000).toISOString();
  378 |     await snapshotOfKind(page, "live", asOf);
  379 |     await page.goto("/");
  380 |     const top = await snapshotFile<Top>(page, "top-7d.json");
  381 |     await expect(topRows(page, isPhone)).toHaveCount(Math.min(5, top.stories.length));
  382 |     await expect(topRows(page, isPhone).first()).toContainText(top.stories[0]!.headline);
  383 | 
  384 |     const clock = new Intl.DateTimeFormat("en-US", {
  385 |       day: "numeric",
  386 |       month: "short",
  387 |       hour: "numeric",
  388 |       minute: "2-digit",
  389 |       timeZone: "UTC",
  390 |     }).format(new Date(asOf));
  391 |     await expect(statusTitle(page)).toHaveAttribute(
  392 |       "title",
  393 |       `Snapshot as of ${clock} · Connectors aren't available in this view.`,
  394 |     );
  395 |     await expect(statusLine(page)).toHaveText(
  396 |       isPhone ? "Snapshot · 3 h ago" : `Snapshot as of ${clock} · Connectors aren't available in this view.`,
  397 |       {
  398 |         useInnerText: true,
  399 |       },
  400 |     );
  401 |     await expect(statusLine(page)).not.toHaveText(/Live data/, { useInnerText: true });
  402 |     await snap(page, testInfo, "artifact-live-snapshot");
  403 |   });
  404 | });
  405 | 
  406 | test.describe("inside claude.ai without live data", () => {
  407 |   // Each failure's own advice (ErrorState): its title names the fix, and its button retries.
  408 |   const CASES = [
  409 |     {
  410 |       code: "server_not_connected",
  411 |       why: "the Supabase connector isn't added",
  412 |       reason: "Add the Supabase connector in claude.ai Settings → Connectors.",
  413 |       fix: "Connect Supabase to see the data",
  414 |       retry: "Try again",
  415 |     },
  416 |     {
  417 |       code: "consent_required",
  418 |       why: "the viewer hasn't allowed the connector",
  419 |       reason: "Live data wasn't approved.",
  420 |       fix: "This page needs your OK",
  421 |       retry: "Ask again",
  422 |     },
  423 |   ];
  424 |   for (const c of CASES) {
  425 |     test.describe(`when ${c.why}`, () => {
  426 |       test.beforeEach(async ({ page }) => {
  427 |         await snapshotOfKind(page, "sample");
  428 |         await claudeWithConnectorError(page, c.code);
  429 |       });
  430 | 
  431 |       test.describe("with Sample data on", () => {
  432 |         test.use({ settings: SAMPLE_ON });
  433 |         test("a story from the snapshot says how to fix it", async ({ page, isPhone }, testInfo) => {
  434 |           // App bug: LiveWithSnapshot (src/api/client.ts) falls back to the snapshot for every call,
  435 |           // and a call the snapshot doesn't cover (a story) then fails with the snapshot's own
  436 |           // "offline" error ("This view needs live data"), not the connector's reason, so the panel
  437 |           // never names the fix. Remove test.fail() once it rethrows the live error in that case.
  438 |           test.fail();
  439 |           await page.goto("/");
  440 |           // The first frame still comes from the snapshot, and the status says why.
  441 |           await expect(topRows(page, isPhone).first()).toBeVisible();
  442 |           await expect(statusTitle(page)).toHaveAttribute("title", `Sample snapshot · ${c.reason}`);
  443 | 
  444 |           await topRows(page, isPhone).first().click();
  445 |           const problem = detailsPanel(page).getByRole("alert");
  446 |           await expect(problem).toBeVisible();
  447 |           await snap(page, testInfo, `artifact-story-${c.code}`);
  448 |           // The panel names the one action that brings the story in.
  449 |           await expect(problem).not.toContainText(/full app/i);
> 450 |           await expect(problem).toContainText(c.fix);
      |                                 ^ Error: expect(locator).toContainText(expected) failed
  451 |           await expect(problem.getByRole("button", { name: c.retry })).toBeVisible();
  452 |         });
  453 |       });
  454 | 
  455 |       test("without Sample data, the globe and a story say how to fix it, with no invented stories", async ({
  456 |         page,
  457 |         isPhone,
  458 |       }) => {
  459 |         await page.goto("/");
  460 |         await expect(statusTitle(page)).toHaveAttribute("title", `Live data isn't connected · ${c.reason}`);
  461 |         const problem = page.locator("main").getByRole("alert").first();
  462 |         await expect(problem).toContainText(c.fix);
  463 |         await expect(problem.getByRole("button", { name: c.retry })).toBeVisible();
  464 |         await expect(topRows(page, isPhone)).toHaveCount(0);
  465 | 
  466 |         // A story link says the same.
  467 |         await page.goto("/#story=story:red-sea-attacks-reroute");
  468 |         const story = detailsPanel(page).getByRole("alert");
  469 |         await expect(story).toContainText(c.fix);
  470 |         await expect(story.getByRole("button", { name: c.retry })).toBeVisible();
  471 |       });
  472 |     });
  473 |   }
  474 | });
  475 | 
```
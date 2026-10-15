/**
 * The claude.ai test link (artifact build) outside claude.ai: no connector,
 * no AI and no db capability. Its first frame comes from the bundled
 * snapshot, it never reaches for the network, and it says plainly that it
 * is showing saved sample data and why Ask can't answer.
 */
import type { Page } from "@playwright/test";

import {
  appStatus,
  detailsPanel,
  expect,
  goToView,
  openSearch,
  seriousA11yProblems,
  snap,
  test,
} from "../fixtures";

interface Top {
  stories: { id: string; headline: string }[];
}

/** Every request the page makes, by path, plus any that left the origin. */
function recordRequests(page: Page, origin: string) {
  const paths: string[] = [];
  const outside: string[] = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (url.protocol === "data:" || url.protocol === "blob:") return;
    if (url.origin !== origin) outside.push(r.url());
    else paths.push(url.pathname);
  });
  return { paths, outside };
}

async function snapshotFile<T>(page: Page, file: string): Promise<T> {
  const response = await page.request.get(`/snapshot/${file}`);
  expect(response.ok(), `snapshot/${file}`).toBe(true);
  return (await response.json()) as T;
}

test.describe("artifact build outside claude.ai", () => {
  test("the first frame is the globe and Top 5 from the snapshot, with no network", async ({
    page,
    isPhone,
    baseURL,
  }, testInfo) => {
    const seen = recordRequests(page, new URL(baseURL!).origin);
    // Anything but the page's own files is refused, as in the claude.ai sandbox.
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return url.origin === new URL(baseURL!).origin ? route.continue() : route.abort("blockedbyclient");
    });
    await page.goto("/");
    await expect(page.locator("header").first()).toBeVisible();

    const canvas = page.locator("canvas.maplibregl-canvas");
    await expect(canvas).toBeVisible();
    const top = await snapshotFile<Top>(page, "top-7d.json");
    const rows = isPhone
      ? page
          .getByRole("list", { name: "Top stories and crowd moves, swipe for more" })
          .locator(":scope > li > button")
      : page.getByRole("list", { name: "Top 5 now" }).locator(":scope > li > button");
    await expect(rows).toHaveCount(Math.min(5, top.stories.length));
    for (const [i, story] of top.stories.slice(0, 5).entries())
      await expect(rows.nth(i)).toContainText(story.headline);

    // The status line says this is saved sample data, not live news.
    await expect(appStatus(page)).toHaveText(/Sample snapshot|Saved sample/);
    await expect(
      page
        .locator("div[title]")
        .filter({ has: appStatus(page) })
        .first(),
    ).toHaveAttribute(
      "title",
      /^(Sample snapshot · Connectors aren't available in this view\.|Saved sample · connecting to live data…)$/,
    );
    await snap(page, testInfo, "artifact-first-frame");

    expect(seen.outside, "requests to other hosts").toEqual([]);
    // Only its own files: no API (there is no server behind the test link).
    const unexpected = seen.paths.filter((p) => !/^\/($|index\.html$|assets\/|geo\/|snapshot\/)/.test(p));
    expect(unexpected, "requests other than the page's own files").toEqual([]);
  });

  test("the status settles on the snapshot and explains why", async ({ page }) => {
    await page.goto("/");
    await expect(appStatus(page)).toHaveText(/^(Sample snapshot|Sample snapshot · .*)$/, { timeout: 30_000 });
    await expect(
      page
        .locator("div[title]")
        .filter({ has: appStatus(page) })
        .first(),
    ).toHaveAttribute("title", "Sample snapshot · Connectors aren't available in this view.");
  });

  test("the forecasts and the brief work from the snapshot", async ({ page }, testInfo) => {
    await page.goto("/");
    await goToView(page, "forecasts");
    const forecasts = await snapshotFile<{ data?: unknown; forecasts?: { short_title: string }[] }>(
      page,
      "forecasts.json",
    );
    const list = forecasts.forecasts ?? [];
    expect(list.length).toBeGreaterThan(0);
    await expect(
      page
        .getByRole("region", { name: /^All forecasts/ })
        .getByRole("listitem")
        .first(),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: /^All forecasts/ })).toContainText(list[0]!.short_title);
    await snap(page, testInfo, "artifact-forecasts");

    await goToView(page, "brief");
    await expect(page.getByRole("heading", { level: 1, name: "Daily brief" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Top risks" }).getByRole("listitem").first()).toBeVisible();
    await expect(page.locator("main header").getByText("Sample data", { exact: true })).toBeVisible();
  });

  test("Ask explains that AI isn't available outside claude.ai", async ({ page }, testInfo) => {
    await page.goto("/#ask");
    const panel = detailsPanel(page);
    await expect(panel.getByRole("heading", { level: 2, name: "Ask WorldGraph" })).toBeVisible();
    const box = panel.getByRole("textbox", { name: "Your question" });
    await expect(box).toHaveAccessibleDescription(
      "AI answers aren't available in this view; you'll still see what WorldGraph has stored.",
    );
    await box.fill("How do Red Sea attacks affect shipping costs?");
    await box.press("Enter");
    const problem = panel.getByRole("alert");
    await expect(problem).toBeVisible({ timeout: 30_000 });
    await expect(problem).toContainText(/AI answers aren't available here|needs the live database/);
    await snap(page, testInfo, "artifact-ask");
    // Whatever the reason, it says where Ask does work.
    await expect(problem).toContainText(/test link uses your Claude account|live database/);
  });

  test("a story opened from Top 5 says it needs the live database instead of failing silently", async ({
    page,
    isPhone,
  }) => {
    await page.goto("/");
    const rows = isPhone
      ? page
          .getByRole("list", { name: "Top stories and crowd moves, swipe for more" })
          .locator(":scope > li > button")
      : page.getByRole("list", { name: "Top 5 now" }).locator(":scope > li > button");
    await rows.first().click();
    const panel = detailsPanel(page);
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/needs the live database/)).toBeVisible();
  });

  test("search works or explains itself", async ({ page, isPhone }) => {
    await page.goto("/");
    await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();
    const box = await openSearch(page, isPhone);
    await box.fill("Gujarat");
    const dialog = page.getByRole("dialog", { name: "Search WorldGraph" });
    await expect(dialog.getByText(/Gujarat|needs the live database/).first()).toBeVisible();
  });

  for (const theme of ["dark", "light"] as const) {
    test.describe(`${theme} theme`, () => {
      test.use({ settings: { theme, calm: true } });
      test("the first frame has no serious or critical axe problems", async ({ page }) => {
        await page.goto("/");
        await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-wg-theme", theme);
        await expect(appStatus(page)).toHaveText(/Sample snapshot/);
        const problems = await seriousA11yProblems(page);
        expect(problems, problems.map((p) => `${p.id}: ${p.targets.join(" | ")}`).join("\n")).toEqual([]);
      });
    });
  }
});

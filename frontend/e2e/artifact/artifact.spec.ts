/**
 * The claude.ai test link (artifact build).
 *
 * Outside claude.ai it has no capabilities (no connector, no AI, no db). Its
 * first frame comes from the bundled snapshot, it never reaches for the
 * network, and it says plainly that it is showing saved sample data and why
 * Ask can't answer.
 *
 * Inside claude.ai the connector can be missing or not allowed. A small
 * stand-in for `window.claude` (the platform's own object, which the page
 * only ever calls through `use()`) shows that the page then names the fix
 * instead of a generic "no data" message.
 */
import type { Page } from "@playwright/test";

import {
  detailsPanel,
  expect,
  goToView,
  openSearch,
  seriousA11yProblems,
  snap,
  statusLine,
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
  const json = (await response.json()) as { data?: T } & T;
  return (json.data ?? json) as T;
}

/** The "Top 5 now" rows: the side card on desktop, the swipe strip on phones. */
function topRows(page: Page, isPhone: boolean) {
  return isPhone
    ? page
        .getByRole("list", { name: "Top stories and crowd moves, swipe for more" })
        .locator(":scope > li > button")
    : page.getByRole("list", { name: "Top 5 now" }).locator(":scope > li > button");
}

/** The status pill's full text (its title; phones show a shorter form). */
function statusTitle(page: Page) {
  return page.locator("div[title]:has(> span[role=status])").first();
}

/**
 * Stand in for claude.ai's `window.claude`: `use("mcp")` resolves, but every
 * connector call fails with `code` (as the platform reports a connector that
 * isn't added, or one the viewer didn't allow). Other capabilities resolve
 * null ("not available in this view").
 */
async function claudeWithConnectorError(page: Page, code: string) {
  await page.addInitScript((errorCode) => {
    const fail = () => {
      const error = new Error(`connector: ${errorCode}`) as Error & { code: string; retryable: boolean };
      error.name = "McpError";
      error.code = errorCode;
      error.retryable = false;
      return Promise.reject(error);
    };
    const mcp = Object.freeze({
      callTool: fail,
      watchTool: fail,
      listTools: () => Promise.resolve([]),
      invalidate: () => Promise.resolve(),
    });
    Object.defineProperty(window, "claude", {
      value: Object.freeze({ use: (name: string) => Promise.resolve(name === "mcp" ? mcp : null) }),
    });
  }, code);
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
    expect(top.stories.length).toBeGreaterThan(0);
    const rows = topRows(page, isPhone);
    await expect(rows).toHaveCount(Math.min(5, top.stories.length));
    for (const [i, story] of top.stories.slice(0, 5).entries())
      await expect(rows.nth(i)).toContainText(story.headline);

    // The status line says this is saved sample data, not live news.
    await expect(statusLine(page)).toHaveText(/^(Sample snapshot|Saved sample)\b/, { useInnerText: true });
    await expect(statusTitle(page)).toHaveAttribute(
      "title",
      /^(Sample snapshot · Connectors aren't available in this view\.|Saved sample · connecting to live data…)$/,
    );
    await snap(page, testInfo, "artifact-first-frame");

    // The snapshot's times are moved to "now": nothing was updated in the future.
    await expect(page.locator("main").getByText(/\b(Updated|updated) in \d/)).toHaveCount(0);

    expect(seen.outside, "requests to other hosts").toEqual([]);
    // Only its own files: no API (there is no server behind the test link).
    const unexpected = seen.paths.filter((p) => !/^\/($|index\.html$|assets\/|geo\/|snapshot\/)/.test(p));
    expect(unexpected, "requests other than the page's own files").toEqual([]);
  });

  test("the status settles on the snapshot and explains why", async ({ page }) => {
    await page.goto("/");
    await expect(statusLine(page)).toHaveText(/^Sample snapshot\b/, { useInnerText: true });
    await expect(statusTitle(page)).toHaveAttribute(
      "title",
      "Sample snapshot · Connectors aren't available in this view.",
    );
  });

  test("the forecasts and the brief work from the snapshot", async ({ page }, testInfo) => {
    await page.goto("/");
    await goToView(page, "forecasts");
    const forecasts = await snapshotFile<{ forecasts: { short_title: string }[] }>(page, "forecasts.json");
    expect(forecasts.forecasts.length).toBeGreaterThan(0);
    const all = page.getByRole("region", { name: /^All forecasts/ });
    await expect(all.getByRole("listitem").first()).toBeVisible();
    await expect(all).toContainText(forecasts.forecasts[0]!.short_title);
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
    await expect(problem).toBeVisible();
    await snap(page, testInfo, "artifact-ask");
    // It says why: there is no AI in this view, and where Ask does work.
    await expect(problem).toContainText("AI answers aren't available here");
    await expect(problem).toContainText(/Claude account/);
    // Never a pointer to some other, "full" app: the test link is the app.
    await expect(problem).not.toContainText(/full app/i);
  });

  test("a story opened from Top 5 explains why it can't load, without pointing elsewhere", async ({
    page,
    isPhone,
  }, testInfo) => {
    await page.goto("/");
    await topRows(page, isPhone).first().click();
    const panel = detailsPanel(page);
    const problem = panel.getByRole("alert");
    await expect(problem).toBeVisible();
    await snap(page, testInfo, "artifact-story");
    await expect(problem).not.toContainText(/full app/i);
  });

  test("search works or explains itself", async ({ page, isPhone }) => {
    await page.goto("/");
    await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();
    const box = await openSearch(page, isPhone);
    await box.fill("Gujarat");
    const dialog = page.getByRole("dialog", { name: "Search WorldGraph" });
    await expect(dialog.getByText(/Gujarat|needs the live database|isn't available/).first()).toBeVisible();
  });

  for (const theme of ["dark", "light"] as const) {
    test.describe(`${theme} theme`, () => {
      test.use({ settings: { theme, calm: true } });
      test("the first frame has no serious or critical axe problems", async ({ page }) => {
        await page.goto("/");
        await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-wg-theme", theme);
        await expect(statusLine(page)).toHaveText(/^Sample snapshot\b/, { useInnerText: true });
        const problems = await seriousA11yProblems(page);
        expect(problems, problems.map((p) => `${p.id}: ${p.targets.join(" | ")}`).join("\n")).toEqual([]);
      });
    });
  }
});

test.describe("artifact build inside claude.ai without live data", () => {
  const CASES = [
    {
      code: "server_not_connected",
      why: "the Supabase connector isn't added",
      status: "Sample snapshot · Add the Supabase connector in claude.ai Settings → Connectors.",
      fix: /Connect Supabase|Supabase connector/,
    },
    {
      code: "consent_required",
      why: "the viewer hasn't allowed the connector",
      status: "Sample snapshot · WorldGraph isn't allowed to use the Supabase connector in this view.",
      fix: /needs your OK|Allow/,
    },
  ];
  for (const c of CASES) {
    test(`when ${c.why}, a story says how to fix it`, async ({ page, isPhone }, testInfo) => {
      await claudeWithConnectorError(page, c.code);
      await page.goto("/");
      // The first frame still comes from the snapshot, and the status says why.
      await expect(topRows(page, isPhone).first()).toBeVisible();
      await expect(statusTitle(page)).toHaveAttribute("title", c.status);

      await topRows(page, isPhone).first().click();
      const problem = detailsPanel(page).getByRole("alert");
      await expect(problem).toBeVisible();
      await snap(page, testInfo, `artifact-story-${c.code}`);
      // The panel names the one action that brings the story in.
      await expect(problem).toContainText(c.fix);
      await expect(problem).not.toContainText(/full app/i);
    });
  }
});

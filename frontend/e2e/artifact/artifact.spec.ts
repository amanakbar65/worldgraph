/**
 * The claude.ai test link (artifact build).
 *
 * Outside claude.ai it has no capabilities (no connector, no AI, no db) and
 * never reaches for the network. What it shows then depends on the bundled
 * snapshot (public/snapshot/, `npm run snapshot` or `npm run snapshot:live`):
 * - a sample snapshot (invented stories) stands in only for a viewer who has
 *   Sample data set to "on"; everyone else sees a plain "Live data isn't
 *   connected" state, never invented stories;
 * - a live snapshot (real news) stands in for every viewer, labelled as a
 *   snapshot with the time it was taken, never as live data.
 * The tests set the snapshot's kind themselves (by rewriting manifest.json on
 * its way to the page), so they hold whichever snapshot is bundled.
 *
 * Inside claude.ai the connector can be missing or not allowed. A small
 * stand-in for `window.claude` (the platform's own object, which the page
 * only ever calls through `use()`) shows that the page then names the fix
 * instead of a generic "no data" message.
 */
import type { Page } from "@playwright/test";

import {
  type Settings,
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

/** A first-time viewer: no Sample data setting saved, so the app's default (off) applies. */
const APP_DEFAULTS = { theme: "dark", calm: true } satisfies Settings;
const SAMPLE_ON = { ...APP_DEFAULTS, sample: "on" } satisfies Settings;
const NO_CONNECTORS = "Connectors aren't available in this view.";
const NOT_CONNECTED = `Live data isn't connected · ${NO_CONNECTORS}`;

// The shared fixtures turn Sample data on (the website tests' database is all
// sample data); the test link is tested as a viewer first opens it.
test.use({ settings: APP_DEFAULTS });

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

/** Only the page's own files: there is no API behind the test link. */
function notOwnFiles(paths: string[]): string[] {
  return paths.filter((p) => !/^\/($|index\.html$|favicon\.svg$|assets\/|geo\/|snapshot\/)/.test(p));
}

async function snapshotFile<T>(page: Page, file: string): Promise<T> {
  const response = await page.request.get(`/snapshot/${file}`);
  expect(response.ok(), `snapshot/${file}`).toBe(true);
  const json = (await response.json()) as { data?: T } & T;
  return (json.data ?? json) as T;
}

/**
 * Make the bundled snapshot say it is of `kind` (and, for a live one, taken
 * at `asOf`), whatever `npm run snapshot` last built. A sample one also has
 * every item marked as sample data, as `npm run snapshot` writes them.
 */
async function snapshotOfKind(page: Page, kind: "sample" | "live", asOf?: string) {
  await page.route("**/snapshot/manifest.json", async (route) => {
    const response = await route.fetch();
    const manifest = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...manifest, kind, ...(asOf ? { as_of: asOf } : {}) } });
  });
  if (kind === "sample") {
    await page.route(/\/snapshot\/(?!manifest\.json)[\w-]+\.json$/, async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: markedSample(await response.json()) });
    });
  }
}

/** A copy of a snapshot file with every `is_sample` and `showing_sample` set to true. */
function markedSample(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(markedSample);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [
      key,
      key === "is_sample" || key === "showing_sample" ? true : markedSample(v),
    ]),
  );
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

test.describe("outside claude.ai, with Sample data on (a sample snapshot)", () => {
  test.use({ settings: SAMPLE_ON });
  test.beforeEach(async ({ page }) => {
    await snapshotOfKind(page, "sample");
  });

  test("the first frame is the globe and Top 5 from the snapshot, with no network", async ({
    page,
    isPhone,
    baseURL,
  }, testInfo) => {
    const seen = recordRequests(page, new URL(baseURL!).origin);
    // Anything but the page's own files is refused, as in the claude.ai sandbox.
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return url.origin === new URL(baseURL!).origin ? route.fallback() : route.abort("blockedbyclient");
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
    // Invented stories are labelled as such.
    await expect(
      page
        .locator("main")
        .getByText(/^Sample( data)?$/)
        .filter({ visible: true })
        .first(),
    ).toBeVisible();

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
    expect(notOwnFiles(seen.paths), "requests other than the page's own files").toEqual([]);
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
    await expect(problem).toContainText("This view needs live data");
    await expect(problem).not.toContainText(/full app/i);
  });

  for (const theme of ["dark", "light"] as const) {
    test.describe(`${theme} theme`, () => {
      test.use({ settings: { ...SAMPLE_ON, theme } });
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

test.describe("outside claude.ai, with Sample data not on (a sample snapshot stays hidden)", () => {
  test.beforeEach(async ({ page }) => {
    await snapshotOfKind(page, "sample");
  });

  for (const sample of ["auto", "off"] as const) {
    test.describe(`Sample data ${sample}`, () => {
      test.use({ settings: { theme: "dark", calm: true, sample } });

      test("no invented stories: the status and the globe say live data isn't connected", async ({
        page,
        isPhone,
        baseURL,
      }, testInfo) => {
        const seen = recordRequests(page, new URL(baseURL!).origin);
        await page.goto("/");
        await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();
        await expect(statusTitle(page)).toHaveAttribute("title", NOT_CONNECTED);
        await expect(statusLine(page)).toHaveText(isPhone ? "Not connected" : NOT_CONNECTED, {
          useInnerText: true,
        });
        // In place of Top 5, the reason.
        const problem = page.locator("main").getByRole("alert").first();
        await expect(problem).toContainText("This view needs live data");
        await snap(page, testInfo, `artifact-not-connected-${sample}`);
        await expect(topRows(page, isPhone)).toHaveCount(0);

        // Not one of the snapshot's stories is on screen, not even for a moment's flash at the end.
        const top = await snapshotFile<Top>(page, "top-7d.json");
        const text = await page.locator("body").innerText();
        for (const story of top.stories)
          expect(text, "a sample story on screen").not.toContain(story.headline);
        await expect(page.getByText(/^Sample( data| snapshot)?$/).filter({ visible: true })).toHaveCount(0);

        expect(seen.outside, "requests to other hosts").toEqual([]);
        expect(notOwnFiles(seen.paths), "requests other than the page's own files").toEqual([]);
      });

      test("Forecasts and Brief say they need live data instead of showing the snapshot", async ({
        page,
      }) => {
        await page.goto("/#forecasts");
        await expect(page.getByRole("heading", { level: 1, name: "Crowd forecasts" })).toBeVisible();
        await expect(page.locator("main").getByRole("alert").first()).toContainText(
          "This view needs live data",
        );
        const forecasts = await snapshotFile<{ forecasts: { short_title: string }[] }>(
          page,
          "forecasts.json",
        );
        await expect(page.locator("main")).not.toContainText(forecasts.forecasts[0]!.short_title);

        await goToView(page, "brief");
        await expect(page.getByRole("heading", { level: 1, name: "Daily brief" })).toBeVisible();
        await expect(page.locator("main").getByRole("alert").first()).toContainText(
          "This view needs live data",
        );
        await expect(page.getByRole("region", { name: "Top risks" }).getByRole("listitem")).toHaveCount(0);
      });
    });
  }

  test("the message doesn't claim that sample data is showing", async ({ page }, testInfo) => {
    await page.goto("/#forecasts");
    const problem = page.locator("main").getByRole("alert").first();
    await expect(problem).toContainText("This view needs live data");
    await snap(page, testInfo, "artifact-not-connected-forecasts");
    await expect(problem).not.toContainText(/sample data/i);
  });

  test("switching Sample data on in Settings brings the sample snapshot in at once", async ({
    page,
    isPhone,
  }) => {
    await page.goto("/");
    await expect(statusTitle(page)).toHaveAttribute("title", NOT_CONNECTED);
    await expect(topRows(page, isPhone)).toHaveCount(0);

    await page.locator('header button[aria-label="Settings"]').click();
    const panel = detailsPanel(page);
    await panel.getByRole("radiogroup", { name: "Sample data" }).getByRole("radio", { name: "On" }).click();
    await panel.getByRole("button", { name: "Close panel" }).click();
    await expect(panel).toBeHidden();

    const top = await snapshotFile<Top>(page, "top-7d.json");
    await expect(topRows(page, isPhone)).toHaveCount(Math.min(5, top.stories.length));
    await expect(topRows(page, isPhone).first()).toContainText(top.stories[0]!.headline);
    await expect(statusTitle(page)).toHaveAttribute(
      "title",
      "Sample snapshot · Connectors aren't available in this view.",
    );
  });

  test("Ask explains that AI isn't available outside claude.ai", async ({ page }, testInfo) => {
    await page.goto("/#ask");
    const panel = detailsPanel(page);
    await expect(panel.getByRole("heading", { level: 2, name: "Ask WorldGraph" })).toBeVisible();
    const box = panel.getByRole("textbox", { name: "Your question" });
    // (A keyboard hint may follow.)
    await expect(box).toHaveAccessibleDescription(
      /^AI answers aren't available in this view; you'll still see what WorldGraph has stored\./,
    );
    await box.fill("How do Red Sea attacks affect shipping costs?");
    await box.press("Enter");
    const turn = panel.getByRole("article", { name: "How do Red Sea attacks affect shipping costs?" });
    const problem = turn.getByRole("alert");
    await expect(problem).toBeVisible();
    await snap(page, testInfo, "artifact-ask");
    // Ask searches WorldGraph's stored stories before any AI is asked, and with no live data
    // there is nothing to search: the turn says so, and nothing was sent to an AI.
    await expect(problem).toContainText("This view needs live data");
    // Never a pointer to some other, "full" app: the test link is the app.
    await expect(problem).not.toContainText(/full app/i);
  });

  test("search works or explains itself", async ({ page, isPhone }) => {
    await page.goto("/");
    await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();
    const box = await openSearch(page, isPhone);
    await box.fill("Gujarat");
    const dialog = page.getByRole("dialog", { name: "Search WorldGraph" });
    await expect(
      dialog.getByText(/Gujarat|needs the live database|isn't available|live data/).first(),
    ).toBeVisible();
  });

  for (const theme of ["dark", "light"] as const) {
    test.describe(`${theme} theme`, () => {
      test.use({ settings: { ...APP_DEFAULTS, theme } });
      test("the not-connected first frame has no serious or critical axe problems", async ({ page }) => {
        await page.goto("/");
        await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-wg-theme", theme);
        await expect(statusTitle(page)).toHaveAttribute("title", NOT_CONNECTED);
        const problems = await seriousA11yProblems(page);
        expect(problems, problems.map((p) => `${p.id}: ${p.targets.join(" | ")}`).join("\n")).toEqual([]);
      });
    });
  }
});

/**
 * A time as the status pill writes it ("Oct 22, 5:52 PM"; the tests run in
 * en-US and UTC), with the year only when it isn't this one.
 */
function pillClock(iso: string): string {
  const at = new Date(iso);
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: at.getUTCFullYear() === new Date().getUTCFullYear() ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(at);
}

test.describe("outside claude.ai, a live snapshot (real news)", () => {
  // Taken three hours ago: shown to every viewer, with its time, never as live data.
  test("stands in for every viewer, labelled as a snapshot with its time", async ({
    page,
    isPhone,
  }, testInfo) => {
    const asOf = new Date(Date.now() - 3 * 3600_000).toISOString();
    await snapshotOfKind(page, "live", asOf);
    await page.goto("/");
    const top = await snapshotFile<Top>(page, "top-7d.json");
    await expect(topRows(page, isPhone)).toHaveCount(Math.min(5, top.stories.length));
    await expect(topRows(page, isPhone).first()).toContainText(top.stories[0]!.headline);

    const long = `Snapshot as of ${pillClock(asOf)} · ${NO_CONNECTORS}`;
    await expect(statusTitle(page)).toHaveAttribute("title", long);
    await expect(statusLine(page)).toHaveText(isPhone ? "Snapshot · 3 h ago" : long, { useInnerText: true });
    await expect(statusLine(page)).not.toHaveText(/Live data/, { useInnerText: true });
    await snap(page, testInfo, "artifact-live-snapshot");
  });
});

/**
 * The snapshot exactly as it ships in public/snapshot/ (`npm run
 * snapshot:live`), not rewritten: the test link's real first frame.
 */
test.describe("outside claude.ai, the shipped snapshot", () => {
  interface Manifest {
    kind?: string;
    as_of?: string;
  }
  interface TopStories {
    stories: { id: string; headline: string; is_sample: boolean }[];
  }

  test("is a live snapshot of real news, with the time it was taken", async ({ page }) => {
    const manifest = await snapshotFile<Manifest>(page, "manifest.json");
    expect(manifest.kind, "the test link ships real news (npm run snapshot:live)").toBe("live");
    expect(Date.parse(manifest.as_of ?? ""), `as_of ${manifest.as_of}`).toBeLessThanOrEqual(Date.now());
    for (const file of ["top-24h.json", "top-7d.json", "top-30d.json"]) {
      const top = await snapshotFile<TopStories>(page, file);
      expect(top.stories.filter((s) => s.is_sample).map((s) => s.headline), `sample stories in ${file}`).toEqual(
        [],
      );
    }
  });

  for (const [label, settings, slug] of [
    ["Sample data at its default (off)", APP_DEFAULTS, "default"],
    ["Sample data off", { ...APP_DEFAULTS, sample: "off" }, "off"],
  ] as const) {
    test.describe(label, () => {
      test.use({ settings });
      test("the globe shows the live snapshot, labelled 'Snapshot as of …', and nothing invented", async ({
        page,
        isPhone,
      }, testInfo) => {
        const manifest = await snapshotFile<Manifest>(page, "manifest.json");
        await page.goto("/");
        await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();
        const top = await snapshotFile<TopStories>(page, "top-7d.json");
        expect(top.stories.length).toBeGreaterThan(0);
        const rows = topRows(page, isPhone);
        await expect(rows).toHaveCount(Math.min(5, top.stories.length));
        for (const [i, story] of top.stories.slice(0, 5).entries())
          await expect(rows.nth(i)).toContainText(story.headline);

        const long = `Snapshot as of ${pillClock(manifest.as_of!)} · ${NO_CONNECTORS}`;
        await expect(statusTitle(page)).toHaveAttribute("title", long);
        await expect(statusLine(page)).toHaveText(isPhone ? /^Snapshot · \S/ : long, { useInnerText: true });
        await expect(statusLine(page)).not.toHaveText(/Live data|Sample/, { useInnerText: true });
        // Real news only: nothing on screen is labelled as sample data.
        await expect(page.getByText(/^Sample( data| snapshot)?$/).filter({ visible: true })).toHaveCount(0);
        await snap(page, testInfo, `artifact-shipped-snapshot-${slug}`);
      });
    });
  }

  test.describe("Sample data on", () => {
    test.use({ settings: SAMPLE_ON });
    test("sample data is allowed, and the bundled live snapshot still says 'Snapshot as of …'", async ({
      page,
      isPhone,
    }) => {
      const manifest = await snapshotFile<Manifest>(page, "manifest.json");
      await page.goto("/");
      const top = await snapshotFile<TopStories>(page, "top-7d.json");
      await expect(topRows(page, isPhone)).toHaveCount(Math.min(5, top.stories.length));
      await expect(topRows(page, isPhone).first()).toContainText(top.stories[0]!.headline);
      await expect(statusTitle(page)).toHaveAttribute(
        "title",
        `Snapshot as of ${pillClock(manifest.as_of!)} · ${NO_CONNECTORS}`,
      );
      await expect(statusLine(page)).not.toHaveText(/Live data|Sample snapshot/, { useInnerText: true });
    });
  });
});

test.describe("inside claude.ai without live data", () => {
  // Each failure's own advice (ErrorState): its title names the fix, and its button retries.
  const CASES = [
    {
      code: "server_not_connected",
      why: "the Supabase connector isn't added",
      reason: "Add the Supabase connector in claude.ai Settings → Connectors.",
      fix: "Connect Supabase to see the data",
      retry: "Try again",
    },
    {
      code: "consent_required",
      why: "the viewer hasn't allowed the connector",
      reason: "Live data wasn't approved.",
      fix: "This page needs your OK",
      retry: "Ask again",
    },
  ];
  for (const c of CASES) {
    test.describe(`when ${c.why}`, () => {
      test.beforeEach(async ({ page }) => {
        await snapshotOfKind(page, "sample");
        await claudeWithConnectorError(page, c.code);
      });

      test.describe("with Sample data on", () => {
        test.use({ settings: SAMPLE_ON });
        test("a story from the snapshot says how to fix it", async ({ page, isPhone }, testInfo) => {
          // A call the snapshot doesn't cover (a story) fails with the connector's own reason
          // (LiveWithSnapshot in src/api/client.ts), so the panel names the fix.
          await page.goto("/");
          // The first frame still comes from the snapshot, and the status says why.
          await expect(topRows(page, isPhone).first()).toBeVisible();
          await expect(statusTitle(page)).toHaveAttribute("title", `Sample snapshot · ${c.reason}`);

          await topRows(page, isPhone).first().click();
          const problem = detailsPanel(page).getByRole("alert");
          await expect(problem).toBeVisible();
          await snap(page, testInfo, `artifact-story-${c.code}`);
          // The panel names the one action that brings the story in.
          await expect(problem).not.toContainText(/full app/i);
          await expect(problem).toContainText(c.fix);
          await expect(problem.getByRole("button", { name: c.retry })).toBeVisible();
        });
      });

      test("without Sample data, the globe and a story say how to fix it, with no invented stories", async ({
        page,
        isPhone,
      }) => {
        await page.goto("/");
        await expect(statusTitle(page)).toHaveAttribute("title", `Live data isn't connected · ${c.reason}`);
        const problem = page.locator("main").getByRole("alert").first();
        await expect(problem).toContainText(c.fix);
        await expect(problem.getByRole("button", { name: c.retry })).toBeVisible();
        await expect(topRows(page, isPhone)).toHaveCount(0);

        // A story link says the same.
        await page.goto("/#story=story:red-sea-attacks-reroute");
        const story = detailsPanel(page).getByRole("alert");
        await expect(story).toContainText(c.fix);
        await expect(story.getByRole("button", { name: c.retry })).toBeVisible();
      });
    });
  }
});

/**
 * The forecasts view and a forecast's panel: the list matches the database
 * for each filter and sort, a forecast opens with its source, volume and
 * last update, the provider link shows only when the API sends one, and no
 * betting or trading wording appears anywhere on these screens.
 */
import type { Page, Route } from "@playwright/test";

import {
  bettingWords,
  currentHash,
  detailsPanel,
  expect,
  goToView,
  openApp,
  rpc,
  snap,
  test,
  visibleText,
} from "./fixtures";

interface Forecast {
  id: string;
  short_title: string;
  question: string;
  category: string;
  provider_name: string;
  url: string | null;
}

function list(page: Page) {
  return page.getByRole("region", { name: /^All forecasts/ }).getByRole("listitem").getByRole("button");
}

/** The forecasts the list shows, by their labels (each starts with the short title). */
async function shownTitles(page: Page, expected: Forecast[]): Promise<string[]> {
  await expect(list(page)).toHaveCount(expected.length);
  const labels = await list(page).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
  return labels.map((label) => expected.find((f) => label.startsWith(`${f.short_title}.`))?.id ?? `?? ${label}`);
}

async function forecasts(page: Page, args: Record<string, unknown>) {
  return (await rpc<{ forecasts: Forecast[] }>(page, "forecasts", args)).forecasts;
}

test.describe("forecasts", () => {
  test("the list matches the database, and the category filter narrows it", async ({ page }, testInfo) => {
    await openApp(page);
    await goToView(page, "forecasts");
    await expect(page.getByRole("heading", { level: 1, name: "Crowd forecasts" })).toBeVisible();
    await expect(page.getByText("Crowd forecasts are what forecasters expect, not facts.", { exact: false })).toBeVisible();

    const all = await forecasts(page, { sort: "relevance", include_thin: false });
    expect(all.length).toBeGreaterThan(0);
    expect(await shownTitles(page, all)).toEqual(all.map((f) => f.id));
    await expect(page.getByRole("heading", { level: 2, name: `All forecasts ${all.length}` })).toBeVisible();
    await snap(page, testInfo, "forecasts");

    await page.getByRole("group", { name: "Categories" }).getByRole("button", { name: "Energy" }).click();
    const energy = await forecasts(page, { sort: "relevance", include_thin: false, categories: ["energy"] });
    expect(energy.length).toBeGreaterThan(0);
    expect(energy.every((f) => f.category === "energy")).toBe(true);
    expect(await shownTitles(page, energy)).toEqual(energy.map((f) => f.id));

    await page.getByRole("group", { name: "Categories" }).getByRole("button", { name: "All", exact: true }).click();
    await expect(list(page)).toHaveCount(all.length);
  });

  test("each sort orders the list as the database does", async ({ page }) => {
    await openApp(page, "#forecasts");
    const sort = page.getByRole("combobox", { name: "Sort forecasts" });
    for (const [value, label] of [
      ["moved", "Biggest moves"],
      ["ending", "Ending soon"],
      ["volume", "Most volume"],
    ] as const) {
      await sort.selectOption({ label });
      const expected = await forecasts(page, { sort: value, include_thin: false });
      await expect.poll(() => shownTitles(page, expected), { message: `sorted by ${label}` }).toEqual(expected.map((f) => f.id));
    }
  });

  test("thin markets and the place filter", async ({ page }) => {
    await openApp(page, "#forecasts");
    const withThin = await forecasts(page, { sort: "relevance", include_thin: true });
    await page.getByRole("switch", { name: "Include thin markets" }).click();
    await expect(page.getByRole("switch", { name: "Include thin markets" })).toBeChecked();
    expect(await shownTitles(page, withThin)).toEqual(withThin.map((f) => f.id));

    const place = page.getByRole("combobox", { name: "Filter forecasts by place" });
    await place.fill("India");
    await page.getByRole("listbox", { name: "Matching places" }).getByRole("option", { name: /^India/ }).first().click();
    await expect(page.getByRole("group", { name: "Active filters" }).getByRole("button", { name: "Remove India" })).toBeVisible();
    const india = await forecasts(page, { sort: "relevance", include_thin: true, regions: ["region:in"] });
    expect(india.length).toBeGreaterThan(0);
    expect(await shownTitles(page, india)).toEqual(india.map((f) => f.id));
  });

  test("a forecast opens with its source, volume and last update, and no provider link for sample data", async ({
    page,
  }, testInfo) => {
    await openApp(page, "#forecasts");
    const first = list(page).first();
    const label = (await first.getAttribute("aria-label"))!;
    await first.click();

    const panel = detailsPanel(page);
    const card = panel.getByRole("article").first();
    await expect(card.getByRole("heading", { level: 2 })).toBeVisible();
    expect(label.startsWith(`${(await card.getByRole("heading", { level: 2 }).textContent())!.trim()}.`)).toBe(true);
    await expect.poll(() => currentHash(page)).toMatch(/^#forecasts&forecast=forecast:/);

    const now = card.getByRole("region", { name: "The crowd's forecast now" });
    await expect(now.getByRole("img", { name: /^Chance of YES: \d+% crowd forecast/ })).toBeVisible();
    await expect(now).toContainText("Source: Sample forecast");
    await expect(now.getByText("Volume", { exact: true })).toBeVisible();
    await expect(now.getByText("Last update", { exact: true })).toBeVisible();
    await expect(card.getByText("Sample data", { exact: true }).first()).toBeVisible();
    await expect(card.getByRole("region", { name: "How the forecast has moved" })).toBeVisible();

    // Sample forecasts carry no URL, so there is no link out.
    await expect(panel.getByRole("link", { name: /^View on/ })).toHaveCount(0);
    await expect(panel.locator("a[href^='http']")).toHaveCount(0);
    await snap(page, testInfo, "forecast-panel");
  });

  test("the provider link appears only when the API sends a web URL", async ({ page }) => {
    const id = "forecast:opec-plus-extends-cuts";
    let url: string | null = "https://manifold.markets/e2e/opec-cuts";
    await page.route("**/api/rpc", async (route: Route) => {
      const body = route.request().postDataJSON() as { fn: string; args: { id?: string } };
      if (body.fn !== "forecast" || body.args.id !== id) return route.continue();
      const response = await route.fetch();
      const json = (await response.json()) as { data: { forecast: Forecast } };
      json.data.forecast.url = url;
      json.data.forecast.provider_name = "Manifold";
      return route.fulfill({ response, json });
    });

    await openApp(page, `#forecast=${id}`);
    const panel = detailsPanel(page);
    const link = panel.getByRole("link", { name: /^View on Manifold/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "https://manifold.markets/e2e/opec-cuts");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noreferrer/);

    // Anything but a plain web link is never an anchor.
    url = "javascript:alert(1)";
    await page.reload();
    await expect(panel.getByRole("heading", { level: 2 })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Watch" })).toBeVisible();
    await expect(panel.getByRole("link", { name: /^View on/ })).toHaveCount(0);
  });

  test("no betting or trading wording on the forecast screens", async ({ page }) => {
    await openApp(page, "#forecasts");
    await expect(list(page).first()).toBeVisible();
    expect(bettingWords(await visibleText(page)), "forecasts view").toEqual([]);

    await page.getByRole("switch", { name: "Include thin markets" }).click();
    for (const sample of ["forecast:opec-plus-extends-cuts", "forecast:us-india-trade-deal-three-months", "forecast:suez-transits-recover"]) {
      await openApp(page, `#forecast=${sample}`);
      await expect(detailsPanel(page).getByRole("region", { name: "How it resolves" })).toBeVisible();
      expect(bettingWords(await visibleText(page)), sample).toEqual([]);
    }
  });

  test("the forecast watch button saves to the watchlist", async ({ page }) => {
    await openApp(page, "#forecast=forecast:fed-cut-next-meeting");
    const panel = detailsPanel(page);
    await panel.getByRole("button", { name: "Watch" }).click();
    await expect(panel.getByRole("button", { name: "Watching" })).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByText("Added to your watchlist.")).toBeAttached();
    const saved = await page.evaluate(() => localStorage.getItem("worldgraph.user.watchlist"));
    expect(JSON.parse(saved ?? "[]")).toContain("forecast:fed-cut-next-meeting");
  });
});

/**
 * Product rules that hold on every screen:
 * - the page asks nothing of any host but its own (no tiles, fonts,
 *   analytics or provider widgets);
 * - sample data is labelled "Sample data" and carries no evidence links;
 * - forecast screens never use betting or trading words.
 */
import type { Page } from "@playwright/test";

import {
  bettingWords,
  detailsPanel,
  expect,
  goToView,
  openApp,
  openSearch,
  rpc,
  test,
  visibleText,
} from "./fixtures";

interface Globe {
  events: { id: string; headline: string }[];
}
interface Forecast {
  id: string;
  short_title: string;
}

/** Move the app with a hash change (no reload), as a link inside the page would. */
async function go(page: Page, hash: string) {
  await page.evaluate((h) => {
    window.location.hash = h;
  }, hash);
}

test.describe("product rules", () => {
  test("every screen and panel loads only from the app's own origin", async ({ page, isPhone, baseURL }) => {
    test.slow(); // every screen and panel in one go
    const hosts = new Map<string, string>();
    page.on("request", (r) => {
      const url = new URL(r.url());
      if (url.protocol === "data:" || url.protocol === "blob:") return;
      if (url.origin !== new URL(baseURL!).origin) hosts.set(url.host, r.url());
    });
    await openApp(page);
    await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();
    for (const view of ["graph", "forecasts", "opportunities", "business", "brief", "globe"] as const) {
      await goToView(page, view);
      await page.waitForTimeout(500);
    }
    for (const hash of [
      "story=story:red-sea-attacks-reroute",
      "cascade=story:red-sea-attacks-reroute",
      "region=region:in-gj",
      "compare=region:in,region:cn",
      "entity=commodity:crude-oil",
      "forecast=forecast:fed-cut-next-meeting",
      "ask",
      "settings",
    ]) {
      await go(page, hash);
      await expect(detailsPanel(page).getByRole("heading", { level: 2 }).first()).toBeVisible();
      await page.waitForTimeout(300);
    }
    if (isPhone) await page.keyboard.press("Escape");
    const box = await openSearch(page, isPhone);
    await box.fill("Gujarat");
    await expect(page.getByRole("option").first()).toContainText("Gujarat");
    expect([...hosts.entries()].map(([host, url]) => `${host}: ${url}`)).toEqual([]);
  });

  test('sample stories say "Sample data" and link to no evidence', async ({ page }) => {
    await openApp(page);
    const globe = await rpc<Globe>(page, "globe", { window: "7d", sectors: [] });
    expect(globe.events.length).toBeGreaterThan(0);
    const panel = detailsPanel(page);
    // Every story in this database is sample data; check a spread of them.
    const step = Math.max(1, Math.floor(globe.events.length / 8));
    for (const event of globe.events.filter((_, i) => i % step === 0).slice(0, 8)) {
      await go(page, `story=${event.id}`);
      const card = panel.getByRole("article", { name: event.headline });
      await expect(card.getByRole("heading", { level: 2, name: event.headline })).toBeVisible();
      await expect(card.getByText("Sample data", { exact: true }).first(), event.id).toBeVisible();
      await expect(card.locator("a[href^='http']"), `${event.id} links out`).toHaveCount(0);
    }
  });

  test("sample places, entities and forecasts are labelled too", async ({ page }) => {
    await openApp(page, "#region=region:in");
    const panel = detailsPanel(page);
    await expect(panel.getByRole("heading", { level: 2, name: "India" })).toBeVisible();
    await expect(panel.getByText("Sample data", { exact: true }).first()).toBeVisible();

    await go(page, "entity=org:opec");
    await expect(panel.getByRole("heading", { level: 2, name: "OPEC" })).toBeVisible();
    await expect(panel.getByText("Sample data", { exact: true }).first()).toBeVisible();

    await go(page, "forecasts");
    await expect(page.getByRole("heading", { level: 1, name: "Crowd forecasts" })).toBeVisible();
    await expect(
      page
        .locator("main")
        .getByText(/^Sample( data)?$/)
        .first(),
    ).toBeVisible();
  });

  test("no betting or trading words in any forecast panel", async ({ page }) => {
    test.slow(); // every forecast's panel
    await openApp(page, "#forecasts");
    const all = (
      await rpc<{ forecasts: Forecast[] }>(page, "forecasts", { sort: "relevance", include_thin: true })
    ).forecasts;
    expect(all.length).toBeGreaterThan(0);
    const panel = detailsPanel(page);
    const found: string[] = [];
    for (const f of all) {
      await go(page, `forecasts&forecast=${f.id}`);
      await expect(panel.getByRole("heading", { level: 2, name: f.short_title })).toBeVisible();
      await expect(panel.getByRole("region", { name: "How it resolves" })).toBeVisible();
      for (const line of bettingWords(await panel.innerText())) found.push(`${f.id}: ${line}`);
    }
    expect(found).toEqual([]);
  });

  test("no betting or trading words where forecasts appear on other screens", async ({ page }) => {
    await openApp(page, "#brief");
    const odds = page.getByRole("region", { name: "Crowd forecasts that moved" });
    await expect(odds.getByRole("listitem").first()).toBeVisible();
    expect(bettingWords(await odds.innerText()), "brief").toEqual([]);

    await go(page, "story=story:red-sea-attacks-reroute");
    const crowd = detailsPanel(page).getByRole("region", { name: "What the crowd expects next" });
    await expect(crowd).toBeVisible();
    expect(bettingWords(await crowd.innerText()), "story").toEqual([]);

    await go(page, "entity=commodity:crude-oil");
    const entity = detailsPanel(page).getByRole("region", { name: /^Crowd forecasts/ });
    await expect(entity).toBeVisible();
    expect(bettingWords(await entity.innerText()), "entity").toEqual([]);

    await go(page, "globe");
    expect(bettingWords(await visibleText(page)), "globe").toEqual([]);
  });
});

/**
 * Settings: the theme switch applies at once and survives a reload, sample
 * data on/off changes what the screens show, and the border choice loads
 * the matching map files.
 */
import type { Page } from "@playwright/test";

import { SETTINGS_KEY, appStatus, detailsPanel, expect, goToView, openApp, rpc, snap, test } from "./fixtures";

async function openSettings(page: Page) {
  await page.locator("header").getByRole("button", { name: "Settings" }).click();
  const panel = detailsPanel(page);
  await expect(panel.getByRole("heading", { level: 2, name: "Settings" })).toBeVisible();
  return panel;
}

async function stored(page: Page): Promise<Record<string, unknown>> {
  return JSON.parse((await page.evaluate((key) => localStorage.getItem(key), SETTINGS_KEY)) ?? "{}") as Record<string, unknown>;
}

test.describe("settings", () => {
  test("the theme switch applies at once and survives a reload", async ({ page }, testInfo) => {
    await openApp(page);
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-wg-theme", "dark");
    const panel = await openSettings(page);
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#globe&settings");
    await snap(page, testInfo, "settings-dark");

    const theme = panel.getByRole("radiogroup", { name: "Theme" });
    await expect(theme.getByRole("radio", { name: "Dark" })).toBeChecked();
    await theme.getByRole("radio", { name: "Light" }).click();
    await expect(html).toHaveAttribute("data-wg-theme", "light");
    await expect(theme.getByRole("radio", { name: "Light" })).toBeChecked();
    expect((await stored(page)).theme).toBe("light");
    // The page itself turns light, not just the attribute.
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const [r, g, b] = (bg.match(/\d+/g) ?? []).map(Number);
    expect((r! + g! + b!) / 3, `body background ${bg}`).toBeGreaterThan(180);
    await snap(page, testInfo, "settings-light");

    await page.reload();
    await expect(html).toHaveAttribute("data-wg-theme", "light");
    await expect(detailsPanel(page).getByRole("radiogroup", { name: "Theme" }).getByRole("radio", { name: "Light" })).toBeChecked();

    // System follows the device.
    await page.emulateMedia({ colorScheme: "dark" });
    await detailsPanel(page).getByRole("radiogroup", { name: "Theme" }).getByRole("radio", { name: "System" }).click();
    await expect(html).toHaveAttribute("data-wg-theme", "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expect(html).toHaveAttribute("data-wg-theme", "light");
  });

  test("calm motion is saved", async ({ page }) => {
    await openApp(page);
    const panel = await openSettings(page);
    const calm = panel.getByRole("switch", { name: "Calm motion" });
    await expect(calm).toBeChecked();
    await calm.click();
    await expect(calm).not.toBeChecked();
    await expect(page.locator("html")).toHaveAttribute("data-wg-calm", "false");
    expect((await stored(page)).calm).toBe(false);
  });

  test("sample data off hides the sample stories; on brings them back", async ({ page }, testInfo) => {
    await openApp(page);
    const panel = await openSettings(page);
    const sample = panel.getByRole("radiogroup", { name: "Sample data" });

    await sample.getByRole("radio", { name: "Off" }).click();
    await expect(panel.getByText("Never shown. Some screens stay empty until live news arrives.")).toBeVisible();
    expect((await stored(page)).sample).toBe("off");
    // This database holds only sample data, so with it off the forecasts are gone.
    const off = await rpc<{ forecasts: unknown[] }>(page, "forecasts", { sort: "relevance", include_thin: true, sample: false });
    await goToView(page, "forecasts");
    await expect(page.getByRole("heading", { level: 2, name: `All forecasts ${off.forecasts.length}` })).toBeAttached();
    await snap(page, testInfo, "sample-off");

    await openSettings(page);
    await detailsPanel(page).getByRole("radiogroup", { name: "Sample data" }).getByRole("radio", { name: "On" }).click();
    await expect(detailsPanel(page).getByText("Always mixed in with live news, each item labelled “Sample data”.")).toBeVisible();
    const on = await rpc<{ forecasts: unknown[] }>(page, "forecasts", { sort: "relevance", include_thin: false, sample: true });
    expect(on.forecasts.length).toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { level: 2, name: `All forecasts ${on.forecasts.length}` })).toBeVisible();
    await expect(appStatus(page)).toHaveText(/Sample/);
  });

  test("the border choice loads India's official view or the international one", async ({ page }) => {
    const geo: string[] = [];
    page.on("request", (r) => {
      const path = new URL(r.url()).pathname;
      if (path.includes("/geo/countries")) geo.push(path.split("/").pop()!);
    });
    await openApp(page);
    const panel = await openSettings(page);
    const borders = panel.getByRole("radiogroup", { name: "Map borders" });

    await borders.getByRole("radio", { name: "India's official view" }).click();
    await expect(panel.getByText("Maps always show India's borders as India officially defines them.")).toBeVisible();
    await expect.poll(() => geo).toContain("countries-in.json");
    expect((await stored(page)).borders).toBe("india");

    await borders.getByRole("radio", { name: "International" }).click();
    await expect(panel.getByText("Maps always show the international default borders (Natural Earth).")).toBeVisible();
    await expect.poll(() => geo).toContain("countries.json");
    expect((await stored(page)).borders).toBe("international");

    await page.reload();
    await expect(detailsPanel(page).getByRole("radiogroup", { name: "Map borders" }).getByRole("radio", { name: "International" })).toBeChecked();
  });

  test("lists its data sources and the viewer's saved data", async ({ page }) => {
    await openApp(page, "#settings");
    const panel = detailsPanel(page);
    await expect(panel.getByRole("region", { name: "Data sources" })).toBeVisible();
    await expect(panel.getByRole("region", { name: "Your saved data" })).toBeVisible();
    await expect(panel.getByRole("region", { name: "AI" })).toContainText(/WorldGraph AI/);
  });
});

/**
 * The region panel: open a place from search, walk the breadcrumb, read the
 * key numbers, and compare two places side by side.
 */
import { currentHash, detailsPanel, expect, openApp, rpc, searchAndOpen, snap, test } from "./fixtures";

interface Region {
  region: { id: string; name: string; breadcrumb: { id: string; name: string }[] };
  kpis: { label: string; source: string | null }[];
  kpi_scope: string | null;
  stories: { headline: string }[];
}

test.describe("region", () => {
  test("search opens a state with its breadcrumb and key numbers", async ({ page, isPhone }, testInfo) => {
    await openApp(page);
    await searchAndOpen(page, isPhone, "Gujarat", "Gujarat");

    const panel = detailsPanel(page);
    const card = panel.getByRole("article", { name: "Gujarat" });
    await expect(card.getByRole("heading", { level: 2, name: "Gujarat" })).toBeVisible();
    await expect.poll(() => currentHash(page)).toBe("#region=region:in-gj");

    const data = await rpc<Region>(page, "region", { id: "region:in-gj", window: "7d" });
    const crumbs = card.getByRole("navigation", { name: "Where this is" });
    await expect(crumbs.getByRole("listitem")).toHaveCount(
      data.region.breadcrumb.filter((b) => b.id !== "region:world").length + 1,
    );
    await expect(crumbs.getByRole("button", { name: "India" })).toBeVisible();
    await expect(crumbs.locator("[aria-current=page]")).toHaveText("Gujarat");

    // Key numbers: up to four tiles, each naming its source.
    const kpis = card.getByRole("region", { name: "Key numbers" }).getByRole("button");
    await expect(kpis).toHaveCount(Math.min(4, data.kpis.length));
    expect(data.kpis.length).toBeGreaterThan(0);
    for (const tile of await kpis.all()) {
      await expect(tile).toHaveAccessibleName(/Source: .+\./);
    }
    await expect(card.getByRole("region", { name: "Sector pulse" }).getByRole("listitem")).toHaveCount(9);
    await expect(card.getByText("Sample data", { exact: true }).first()).toBeVisible();
    await snap(page, testInfo, "region-gujarat");

    // Up the breadcrumb to the country.
    await crumbs.getByRole("button", { name: "India" }).click();
    await expect(panel.getByRole("heading", { level: 2, name: "India" })).toBeVisible();
    await expect.poll(() => currentHash(page)).toBe("#region=region:in");
    await expect(panel.getByRole("navigation", { name: "Where this is" })).toHaveCount(0);
  });

  test("the panel's time window changes its counts", async ({ page }) => {
    await openApp(page, "#region=region:in");
    const panel = detailsPanel(page);
    await expect(panel.getByText("Activity in the last 7 days")).toBeVisible();
    await panel
      .getByRole("radiogroup", { name: "Time window" })
      .getByRole("radio", { name: "Last 30 days" })
      .click();
    await expect(panel.getByText("Activity in the last 30 days")).toBeVisible();
    await expect.poll(() => currentHash(page)).toBe("#region=region:in&w=30d");
  });

  test("compare two places side by side", async ({ page }, testInfo) => {
    await openApp(page, "#region=region:in");
    const panel = detailsPanel(page);
    await panel.getByRole("button", { name: "Compare India with other regions" }).click();
    await expect(panel.getByRole("heading", { level: 2, name: "Compare" })).toBeVisible();
    const chosen = panel.getByRole("list", { name: "Places in the comparison" });
    await expect(chosen.getByRole("button", { name: "Remove India" })).toBeVisible();

    const picker = panel.getByRole("combobox", { name: "Add a region" });
    await picker.fill("China");
    await panel
      .getByRole("listbox", { name: "Matching places" })
      .getByRole("option", { name: /^China/ })
      .first()
      .click();
    await expect(chosen.getByRole("button", { name: "Remove China" })).toBeVisible();
    await expect.poll(() => currentHash(page)).toBe("#compare=region:in,region:cn");

    // The same measure sits in the same row for both places.
    const numbers = panel.getByRole("region", { name: "Key numbers" });
    await expect(numbers.getByRole("group", { name: "Inflation" })).toContainText("India:");
    await expect(numbers.getByRole("group", { name: "Inflation" })).toContainText("China:");
    await expect(panel.getByRole("region", { name: "Stories" })).toContainText(/India: \d+\s*stor/);
    await expect(panel.getByRole("region", { name: "Stories" })).toContainText(/China: \d+\s*stor/);
    await expect(panel.getByRole("region", { name: "Sector pulse" }).getByRole("group")).toHaveCount(9);
    await snap(page, testInfo, "compare");

    await chosen.getByRole("button", { name: "Remove China" }).click();
    await expect(chosen.getByRole("button", { name: "Remove China" })).toHaveCount(0);
  });

  test("a city opens with its state and country in the breadcrumb", async ({ page, isPhone }) => {
    await openApp(page);
    await searchAndOpen(page, isPhone, "Mumbai", "Mumbai");
    const crumbs = detailsPanel(page).getByRole("navigation", { name: "Where this is" });
    await expect(crumbs.getByRole("button", { name: "India" })).toBeVisible();
    await expect(crumbs.getByRole("button", { name: "Maharashtra" })).toBeVisible();
    await expect(crumbs.locator("[aria-current=page]")).toHaveText("Mumbai");
  });
});

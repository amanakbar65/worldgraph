/**
 * The daily brief: six cards that match api.brief, labelled as sample data
 * while the data is sample, items that open their panels, and "Copy as
 * text".
 */
import { currentHash, detailsPanel, expect, goToView, openApp, rpc, snap, test } from "./fixtures";

interface Brief {
  generated_at: string;
  cards: (
    | { kind: "top_risks" | "top_opportunities" | "biggest_movers"; stories: { id: string; headline: string; is_sample: boolean }[] }
    | { kind: "odds_moved"; forecasts: { id: string; short_title: string }[] }
    | { kind: "cascade_to_watch"; focus: { id: string; headline: string } | null; effects: unknown[] }
    | { kind: "region_spotlight"; region: { id: string; name: string } | null; stories: { headline: string }[] }
  )[];
}

const TITLES = [
  "Top risks",
  "Top opportunities",
  "Most reported",
  "Crowd forecasts that moved",
  "Cascade to watch",
  "Region spotlight",
];

test.describe("brief", () => {
  test("the six cards show what api.brief returns, in order", async ({ page }, testInfo) => {
    await openApp(page);
    await goToView(page, "brief");
    await expect(page.getByRole("heading", { level: 1, name: "Daily brief" })).toBeVisible();
    await expect(page.getByText("Generated from stored data")).toBeVisible();
    await expect.poll(() => currentHash(page)).toBe("#brief");

    const brief = await rpc<Brief>(page, "brief", {});
    const cards = page.locator("main section[aria-labelledby]").filter({ has: page.getByRole("heading", { level: 2 }) });
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(TITLES);

    const byKind = Object.fromEntries(brief.cards.map((c) => [c.kind, c]));
    for (const kind of ["top_risks", "top_opportunities", "biggest_movers"] as const) {
      const card = byKind[kind] as Extract<Brief["cards"][number], { kind: typeof kind }>;
      const section = page.getByRole("region", { name: TITLES[["top_risks", "top_opportunities", "biggest_movers"].indexOf(kind)] });
      for (const story of card.stories) await expect(section).toContainText(story.headline);
    }
    const odds = byKind.odds_moved as Extract<Brief["cards"][number], { kind: "odds_moved" }>;
    for (const f of odds.forecasts) {
      await expect(page.getByRole("region", { name: "Crowd forecasts that moved" })).toContainText(f.short_title);
    }
    const spotlight = byKind.region_spotlight as Extract<Brief["cards"][number], { kind: "region_spotlight" }>;
    if (spotlight.region) {
      await expect(page.getByRole("region", { name: "Region spotlight" })).toContainText(spotlight.region.name);
    }
    expect(await cards.count()).toBe(6);

    // All sample: the header says so once.
    await expect(page.locator("main header").getByText("Sample data", { exact: true })).toBeVisible();
    await snap(page, testInfo, "brief");
  });

  test("a story in the brief opens its card", async ({ page }) => {
    await openApp(page, "#brief");
    const brief = await rpc<Brief>(page, "brief", {});
    const risks = brief.cards.find((c) => c.kind === "top_risks") as Extract<Brief["cards"][number], { kind: "top_risks" }>;
    const first = risks.stories[0]!;
    await page.getByRole("region", { name: "Top risks" }).getByRole("button").filter({ hasText: first.headline }).click();
    await expect(detailsPanel(page).getByRole("heading", { level: 2, name: first.headline })).toBeVisible();
    await expect.poll(() => currentHash(page)).toBe(`#brief&story=${first.id}`);
  });

  test("a forecast in the brief opens its panel", async ({ page }) => {
    await openApp(page, "#brief");
    const brief = await rpc<Brief>(page, "brief", {});
    const odds = brief.cards.find((c) => c.kind === "odds_moved") as Extract<Brief["cards"][number], { kind: "odds_moved" }>;
    test.skip(odds.forecasts.length === 0, "No forecast moved in this database.");
    const first = odds.forecasts[0]!;
    await page.getByRole("region", { name: "Crowd forecasts that moved" }).getByRole("button").filter({ hasText: first.short_title }).first().click();
    await expect(detailsPanel(page).getByRole("heading", { level: 2, name: first.short_title })).toBeVisible();
    await expect.poll(() => currentHash(page)).toBe(`#brief&forecast=${first.id}`);
  });

  test("Copy as text copies the whole brief", async ({ page, context, isPhone }) => {
    test.skip(isPhone, "Clipboard permissions are a desktop browser feature here.");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openApp(page, "#brief");
    const brief = await rpc<Brief>(page, "brief", {});
    await page.getByRole("button", { name: "Copy as text" }).click();
    await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toContain("Top risks");
    const risks = brief.cards.find((c) => c.kind === "top_risks") as Extract<Brief["cards"][number], { kind: "top_risks" }>;
    expect(text).toContain(risks.stories[0]!.headline);
    // Sample items are marked in the copy too, so they are never passed on as real news.
    expect(text).toMatch(/sample/i);
  });
});

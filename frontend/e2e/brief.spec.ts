/**
 * The daily brief: six cards that match api.brief, labelled as sample data
 * while the data is sample, items that open their panels, and "Copy as
 * text".
 */
import { currentHash, detailsPanel, expect, goToView, openApp, rpc, snap, test } from "./fixtures";

interface BriefCard {
  kind: string;
  stories?: { id: string; headline: string; is_sample: boolean }[];
  forecasts?: { id: string; short_title: string }[];
  focus?: { id: string; headline: string } | null;
  region?: { id: string; name: string } | null;
}
interface Brief {
  generated_at: string;
  cards: BriefCard[];
}

/** The card of one kind (the API sends each kind once). */
function card(brief: Brief, kind: string): BriefCard {
  const found = brief.cards.find((c) => c.kind === kind);
  expect(found, `the ${kind} card`).toBeDefined();
  return found!;
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
    const cards = page
      .locator("main section[aria-labelledby]")
      .filter({ has: page.getByRole("heading", { level: 2 }) });
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(TITLES);

    const storyCards = [
      ["top_risks", "Top risks"],
      ["top_opportunities", "Top opportunities"],
      ["biggest_movers", "Most reported"],
    ] as const;
    for (const [kind, title] of storyCards) {
      const section = page.getByRole("region", { name: title });
      for (const story of card(brief, kind).stories ?? [])
        await expect(section).toContainText(story.headline);
    }
    for (const f of card(brief, "odds_moved").forecasts ?? []) {
      await expect(page.getByRole("region", { name: "Crowd forecasts that moved" })).toContainText(
        f.short_title,
      );
    }
    const focus = card(brief, "cascade_to_watch").focus;
    if (focus)
      await expect(page.getByRole("region", { name: "Cascade to watch" })).toContainText(focus.headline);
    const region = card(brief, "region_spotlight").region;
    if (region)
      await expect(page.getByRole("region", { name: "Region spotlight" })).toContainText(region.name);
    expect(await cards.count()).toBe(6);

    // All sample: the header says so once.
    await expect(page.locator("main header").getByText("Sample data", { exact: true })).toBeVisible();
    await snap(page, testInfo, "brief");
  });

  test("a story in the brief opens its card", async ({ page }) => {
    await openApp(page, "#brief");
    const brief = await rpc<Brief>(page, "brief", {});
    const first = card(brief, "top_risks").stories![0]!;
    await page
      .getByRole("region", { name: "Top risks" })
      .getByRole("button")
      .filter({ hasText: first.headline })
      .click();
    await expect(detailsPanel(page).getByRole("heading", { level: 2, name: first.headline })).toBeVisible();
    await expect.poll(() => currentHash(page)).toBe(`#brief&story=${first.id}`);
  });

  test("a forecast in the brief opens its panel", async ({ page }) => {
    await openApp(page, "#brief");
    const brief = await rpc<Brief>(page, "brief", {});
    const odds = card(brief, "odds_moved").forecasts ?? [];
    expect(odds.length, "forecasts that moved").toBeGreaterThan(0);
    const first = odds[0]!;
    await page
      .getByRole("region", { name: "Crowd forecasts that moved" })
      .getByRole("button")
      .filter({ hasText: first.short_title })
      .first()
      .click();
    await expect(
      detailsPanel(page).getByRole("heading", { level: 2, name: first.short_title }),
    ).toBeVisible();
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
    expect(text).toMatch(/^TOP RISKS$/m);
    expect(text).toContain(card(brief, "top_risks").stories![0]!.headline);
    // Sample items are marked in the copy too, so they are never passed on as real news.
    expect(text).toMatch(/sample/i);
  });
});

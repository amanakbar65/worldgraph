/**
 * Opportunities: the cards and the momentum × importance radar show the
 * same openings as the database, the sector lens narrows them, and a card
 * opens its story.
 */
import { currentHash, detailsPanel, expect, goToView, openApp, rpc, snap, test } from "./fixtures";

interface Opportunities {
  items: { story: { id: string; headline: string; impact: string; sectors: string[] } }[];
}

test.describe("opportunities", () => {
  test("cards and radar show the database's openings, strongest first", async ({ page }, testInfo) => {
    await openApp(page);
    await goToView(page, "opportunities");
    await expect(page.getByRole("heading", { level: 1, name: "Opportunities" })).toBeVisible();

    const data = await rpc<Opportunities>(page, "opportunities", { window: "7d" });
    expect(data.items.length).toBeGreaterThan(0);
    for (const item of data.items) expect(item.story.impact, item.story.headline).toBe("opportunity");

    const cards = page.getByRole("list", { name: "Openings" }).getByRole("article");
    // Ten at a time.
    await expect(cards).toHaveCount(Math.min(10, data.items.length));
    while ((await cards.count()) < data.items.length) {
      const before = await cards.count();
      await page.getByRole("button", { name: /^Show more \(\d+ left\)$/ }).click();
      await expect(cards).toHaveCount(Math.min(before + 10, data.items.length));
    }
    for (const [i, item] of data.items.entries()) {
      await expect(cards.nth(i)).toHaveAccessibleName(`${i + 1}. ${item.story.headline}`);
    }
    await expect(
      page.getByRole("heading", { level: 2, name: `Strongest first ${data.items.length}` }),
    ).toBeVisible();

    const radar = page.getByRole("group", { name: /^Opportunity radar, \d+ openings/ });
    await expect(radar.getByRole("button")).toHaveCount(data.items.length);
    await snap(page, testInfo, "opportunities");

    await page
      .getByRole("radiogroup", { name: "Show the radar as" })
      .getByRole("radio", { name: "List" })
      .click();
    await expect(radar).toHaveCount(0);
  });

  test("the sector lens narrows the openings", async ({ page }) => {
    await openApp(page, "#opportunities");
    await page
      .getByRole("group", { name: "Sector lens" })
      .getByRole("button", { name: "Energy", exact: true })
      .click();
    await expect.poll(() => currentHash(page)).toContain("s=energy");

    const data = await rpc<Opportunities>(page, "opportunities", { window: "7d", sectors: ["energy"] });
    for (const item of data.items) expect(item.story.sectors).toContain("energy");
    const cards = page.getByRole("list", { name: "Openings" }).getByRole("article");
    await expect(cards).toHaveCount(Math.min(10, data.items.length));
    await expect(
      page.getByRole("group", { name: /^Opportunity radar, \d+ openings/ }).getByRole("button"),
    ).toHaveCount(data.items.length);
    if (data.items[0]) await expect(cards.first()).toHaveAccessibleName(`1. ${data.items[0].story.headline}`);
  });

  test("a card opens its story", async ({ page }) => {
    await openApp(page, "#opportunities");
    const data = await rpc<Opportunities>(page, "opportunities", { window: "7d" });
    const first = data.items[0]!.story;
    await page
      .getByRole("list", { name: "Openings" })
      .getByRole("button", { name: first.headline, exact: true })
      .click();
    await expect(detailsPanel(page).getByRole("heading", { level: 2, name: first.headline })).toBeVisible();
    await expect.poll(() => currentHash(page)).toBe(`#opportunities&story=${first.id}`);
  });
});

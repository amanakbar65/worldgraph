/**
 * Opportunities: the cards and the momentum × importance radar show the
 * same openings as the database, the sector lens narrows them, and a card
 * opens its story.
 */
import type { Page } from "@playwright/test";

import { currentHash, detailsPanel, expect, goToView, openApp, rpc, snap, test } from "./fixtures";

interface Opportunities {
  items: { story: { id: string; headline: string; impact: string; sectors: string[] } }[];
}

/**
 * The page's own latest answer from api.opportunities (last 7 days, every
 * sector). Momentum moves with the clock, so a second request made by the
 * test can rank two close openings the other way round.
 */
function watchOpportunities(page: Page): { latest: Opportunities | null } {
  const seen: { latest: Opportunities | null } = { latest: null };
  page.on("response", async (response) => {
    const request = response.request();
    if (request.method() !== "POST" || !response.url().endsWith("/api/rpc")) return;
    const body = request.postDataJSON() as { fn?: string; args?: { window?: string; sectors?: string[] } } | null;
    if (body?.fn !== "opportunities" || body.args?.window !== "7d" || (body.args.sectors ?? []).length > 0) return;
    try {
      seen.latest = ((await response.json()) as { data: Opportunities }).data;
    } catch {
      // The page went away first.
    }
  });
  return seen;
}

test.describe("opportunities", () => {
  test("cards and radar show the database's openings, strongest first", async ({ page }, testInfo) => {
    const answers = watchOpportunities(page);
    await openApp(page);
    await goToView(page, "opportunities");
    await expect(page.getByRole("heading", { level: 1, name: "Opportunities" })).toBeVisible();

    await expect.poll(() => answers.latest?.items.length ?? 0).toBeGreaterThan(0);
    const data = answers.latest!;
    for (const item of data.items) expect(item.story.impact, item.story.headline).toBe("opportunity");

    const cards = page.getByRole("list", { name: "Openings" }).getByRole("article");
    // Ten at a time.
    await expect(cards).toHaveCount(Math.min(10, data.items.length));
    while ((await cards.count()) < data.items.length) {
      const before = await cards.count();
      await page.getByRole("button", { name: /^Show more \(\d+ left\)$/ }).click();
      await expect(cards).toHaveCount(Math.min(before + 10, data.items.length));
    }
    // Strongest first, in the order of the page's latest answer.
    await expect(async () => {
      const names = await cards.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
      expect(names).toEqual(answers.latest!.items.map((item, i) => `${i + 1}. ${item.story.headline}`));
    }).toPass({ timeout: 30_000 });
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

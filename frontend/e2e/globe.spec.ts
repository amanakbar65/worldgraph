/**
 * The globe (home): the map draws, "Top 5 now" matches the database, the
 * time window and sector lens change what is shown, and the list view lists
 * every event and opens a story.
 */
import type { Page } from "@playwright/test";

import { currentHash, detailsPanel, expect, openApp, rpc, snap, test } from "./fixtures";

interface Top {
  stories: { id: string; headline: string; sectors: string[]; is_sample: boolean }[];
  movers: { id: string; short_title: string }[];
}
interface Globe {
  events: { id: string; headline: string; sectors: string[] }[];
}

/** The rows of "Top 5 now": the side card on desktop, the swipe strip on phones. */
function topStories(page: Page, isPhone: boolean) {
  return isPhone
    ? page.getByRole("list", { name: "Top stories and crowd moves, swipe for more" }).locator(":scope > li > button")
    : page.getByRole("list", { name: "Top 5 now" }).locator(":scope > li > button");
}

async function openList(page: Page, isPhone: boolean) {
  if (isPhone) await page.getByRole("button", { name: "List of events" }).click();
  else await page.getByRole("radio", { name: "List of all events" }).click();
}

async function chooseSector(page: Page, isPhone: boolean, sector: string) {
  if (isPhone) {
    await page.getByRole("button", { name: /^Sector lens:/ }).click();
    await page.getByRole("group", { name: "Sector lens" }).getByRole("button", { name: sector, exact: true }).click();
    await page.keyboard.press("Escape");
  } else {
    await page.getByRole("group", { name: "Sector lens" }).getByRole("button", { name: sector, exact: true }).click();
  }
}

test.describe("globe", () => {
  test("draws the map and shows Top 5 now from the database", async ({ page, isPhone }, testInfo) => {
    await openApp(page);
    const canvas = page.locator("canvas.maplibregl-canvas");
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(300);
    expect(box?.height ?? 0).toBeGreaterThan(300);
    await expect(page.getByRole("region", { name: /^Globe of world events/ })).toBeAttached();

    const top = await rpc<Top>(page, "top", { window: "7d", sectors: [] });
    expect(top.stories.length).toBeGreaterThan(0);
    const rows = topStories(page, isPhone);
    await expect(rows).toHaveCount(Math.min(5, top.stories.length));
    for (const [i, story] of top.stories.slice(0, 5).entries()) {
      await expect(rows.nth(i)).toContainText(story.headline);
    }
    // All sample data: the card says so.
    const topCard = isPhone
      ? page.getByRole("region", { name: "Top 5 now" })
      : page.getByRole("region", { name: "Top stories and all events" });
    await expect(topCard.getByText(/^Sample( data)?$/).first()).toBeVisible();
    await snap(page, testInfo, "globe-home");
  });

  test("the time window changes the stories and the link", async ({ page, isPhone }) => {
    await openApp(page);
    const window = page.getByRole("radiogroup", { name: "Time window" });
    await expect(window.getByRole("radio", { name: "Last 7 days" })).toBeChecked();

    await window.getByRole("radio", { name: "Last 24 hours" }).click();
    await expect(window.getByRole("radio", { name: "Last 24 hours" })).toBeChecked();
    await expect.poll(() => currentHash(page)).toContain("w=24h");
    if (!isPhone) await expect(page.getByText("Last 24 hours · most important first")).toBeVisible();

    const top = await rpc<Top>(page, "top", { window: "24h", sectors: [] });
    const rows = topStories(page, isPhone);
    await expect(rows).toHaveCount(Math.min(5, top.stories.length));
    if (top.stories[0]) await expect(rows.first()).toContainText(top.stories[0].headline);

    await window.getByRole("radio", { name: "Last 30 days" }).click();
    await expect.poll(() => currentHash(page)).toContain("w=30d");
    await expect(page.getByRole("button", { name: "Replay the last 30 days" })).toBeVisible();
  });

  test("the sector lens narrows the stories to that sector", async ({ page, isPhone }) => {
    await openApp(page);
    await chooseSector(page, isPhone, "Energy");
    await expect.poll(() => currentHash(page)).toContain("s=energy");
    if (!isPhone) {
      const lens = page.getByRole("group", { name: "Sector lens" });
      await expect(lens.getByRole("button", { name: "Energy", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(lens.getByRole("button", { name: "All sectors" })).toHaveAttribute("aria-pressed", "false");
    } else {
      await expect(page.getByRole("button", { name: "Sector lens: Energy" })).toBeVisible();
    }

    const top = await rpc<Top>(page, "top", { window: "7d", sectors: ["energy"] });
    expect(top.stories.length).toBeGreaterThan(0);
    for (const story of top.stories) expect(story.sectors).toContain("energy");
    const rows = topStories(page, isPhone);
    await expect(rows).toHaveCount(Math.min(5, top.stories.length));
    for (const [i, story] of top.stories.slice(0, 5).entries()) {
      await expect(rows.nth(i)).toContainText(story.headline);
    }

    // "All sectors" turns the lens off again.
    if (isPhone) {
      await page.getByRole("button", { name: "Sector lens: Energy" }).click();
      await page.getByRole("group", { name: "Sector lens" }).getByRole("button", { name: "All sectors" }).click();
      await page.keyboard.press("Escape");
    } else {
      await page.getByRole("group", { name: "Sector lens" }).getByRole("button", { name: "All sectors" }).click();
    }
    await expect.poll(() => currentHash(page)).not.toContain("s=energy");
  });

  test("the list view lists every event and opens a story", async ({ page, isPhone }, testInfo) => {
    await openApp(page);
    const globe = await rpc<Globe>(page, "globe", { window: "7d", sectors: [] });
    await openList(page, isPhone);

    const count = globe.events.length;
    await expect(page.getByText(new RegExp(`^${count} events · by importance$`))).toBeVisible();
    const list = page.getByRole("list", { name: "All events" });
    const rows = list.locator(":scope > li > button");
    await expect(rows).toHaveCount(Math.min(40, count));
    if (count > 40) {
      await page.getByRole("button", { name: /^Show \d+ more$/ }).click();
      await expect(rows).toHaveCount(Math.min(80, count));
    }
    // Every row is one of the globe's events.
    const headlines = new Set(globe.events.map((e) => e.headline));
    const shown = await rows.locator("span.line-clamp-2").allTextContents();
    for (const h of shown) expect(headlines, `"${h}" is on the globe`).toContain(h.trim());
    await snap(page, testInfo, "globe-list");

    const second = shown[1]!.trim();
    const id = globe.events.find((e) => e.headline === second)!.id;
    await rows.nth(1).click();
    const panel = detailsPanel(page);
    await expect(panel.getByRole("heading", { level: 2, name: second })).toBeVisible();
    await expect.poll(() => currentHash(page)).toBe(`#story=${id}`);
  });

  test("opening a Top 5 story shows its card", async ({ page, isPhone }) => {
    await openApp(page);
    const top = await rpc<Top>(page, "top", { window: "7d", sectors: [] });
    const story = top.stories[0]!;
    await topStories(page, isPhone).first().click();
    const panel = detailsPanel(page);
    await expect(panel.getByRole("heading", { level: 2, name: story.headline })).toBeVisible();
    await expect.poll(() => currentHash(page)).toBe(`#story=${story.id}`);
  });

  test("replay runs and stops", async ({ page }) => {
    await openApp(page);
    await page.getByRole("button", { name: "Replay the last 7 days" }).click();
    await expect(page.getByRole("progressbar", { name: "Replay progress" })).toBeVisible();
    await page.getByRole("button", { name: "Stop the replay" }).first().click();
    await expect(page.getByRole("progressbar", { name: "Replay progress" })).toBeHidden();
  });

  test("zoom buttons work on desktop", async ({ page, isPhone }) => {
    test.skip(isPhone, "Phones pinch to zoom; the buttons are desktop only.");
    await openApp(page);
    const zoom = page.getByRole("group", { name: "Zoom" });
    await zoom.getByRole("button", { name: "Zoom in" }).click();
    await zoom.getByRole("button", { name: "Zoom out" }).click();
    await zoom.getByRole("button", { name: "Show the whole globe" }).click();
    await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();
  });
});

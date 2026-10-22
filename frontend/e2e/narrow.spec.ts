/**
 * Small phones (360 × 740, a common Android size): the controls and screen
 * titles keep their words whole, and no screen scrolls sideways.
 */
import type { Locator, Page } from "@playwright/test";

import { expect, goToView, openApp, snap, test, type ViewName } from "./fixtures";

test.use({ viewport: { width: 360, height: 740 } });

/** Text inside `scope` that is cut short ("…") because it doesn't fit its box. */
async function cutText(scope: Locator): Promise<string[]> {
  return scope.evaluateAll((roots) => {
    const cut: string[] = [];
    for (const root of roots) {
      for (const el of [root, ...Array.from(root.querySelectorAll("*"))]) {
        if (!(el instanceof HTMLElement) || !el.textContent?.trim()) continue;
        const style = getComputedStyle(el);
        if (style.textOverflow !== "ellipsis" && style.overflow === "visible") continue;
        if (el.scrollWidth > el.clientWidth + 1) cut.push(el.textContent.trim().slice(0, 60));
      }
    }
    return [...new Set(cut)];
  });
}

async function noSidewaysScroll(page: Page) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width, "page width").toBeLessThanOrEqual(360);
}

test.describe("a 360 px phone", () => {
  test.beforeEach(({ isPhone }) => {
    test.skip(!isPhone, "Phone layout only.");
  });

  test("the globe's time window labels fit", async ({ page }, testInfo) => {
    await openApp(page);
    const window = page.getByRole("radiogroup", { name: "Time window" });
    await expect(window.getByRole("radio", { name: "Last 7 days" })).toBeChecked();
    await snap(page, testInfo, "narrow-globe");
    expect(await cutText(window), "time window labels cut short").toEqual([]);
    await noSidewaysScroll(page);
  });

  for (const view of ["forecasts", "opportunities", "business", "brief"] as const satisfies ViewName[]) {
    test(`the ${view} title fits`, async ({ page }, testInfo) => {
      await openApp(page);
      await goToView(page, view);
      const title = page.locator("main h1");
      await expect(title).toBeVisible();
      await page.waitForTimeout(500); // let the layout settle
      await snap(page, testInfo, `narrow-${view}`);
      expect(await cutText(title), `${view} title cut short`).toEqual([]);
      await noSidewaysScroll(page);
    });
  }
});

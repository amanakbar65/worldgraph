/**
 * Keyboard focus around panels and search: a panel takes focus when it
 * opens (its Close button, or Ask's question box) and gives it back to the
 * control that opened it when it closes; the search dialog does the same,
 * and a result it opens hands focus on to the panel. Focus never ends up on
 * <body>. A panel open on page load (a deep link) leaves focus alone.
 */
import type { Page } from "@playwright/test";

import { detailsPanel, expect, openApp, test } from "./fixtures";

const STORY = "story:red-sea-attacks-reroute";

/** Header controls by CSS: on phones an open sheet may hide the header from the accessibility tree. */
const header = (page: Page, label: string) => page.locator(`header button[aria-label="${label}"]`);
const askButton = (page: Page) => page.locator("header").getByRole("button", { name: /^Ask( a question)?$/ });

/** What has focus, for failure messages: tag, label and text. */
function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return "<body>";
    const label = el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 40) ?? "";
    return `<${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}> ${label}`;
  });
}

test.describe("focus in and out of panels", () => {
  test("a panel takes focus as it opens and gives it back to its opener on close", async ({ page }) => {
    await openApp(page);
    const settings = header(page, "Settings");
    await settings.click();
    const panel = detailsPanel(page);
    await expect(panel.getByRole("heading", { level: 2, name: "Settings" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Close panel" })).toBeFocused();

    await panel.getByRole("button", { name: "Close panel" }).click();
    await expect(panel).toBeHidden();
    await expect(settings, `focus is on ${await focused(page)}`).toBeFocused();
  });

  test("Escape closes the panel and focus goes back to its opener", async ({ page, isPhone }) => {
    test.skip(isPhone, "Escape is a keyboard key; phones close the sheet with its button or a swipe.");
    await openApp(page);
    const settings = header(page, "Settings");
    await settings.focus();
    await page.keyboard.press("Enter");
    const panel = detailsPanel(page);
    await expect(panel.getByRole("button", { name: "Close panel" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(settings).toBeFocused();
  });

  test("Ask puts focus in its question box on desktop, and closing returns it to Ask", async ({
    page,
    isPhone,
  }) => {
    await openApp(page);
    await askButton(page).click();
    const panel = detailsPanel(page);
    const box = panel.getByRole("textbox", { name: "Your question" });
    await expect(box).toBeVisible();
    // Phones: no keyboard popping up over the sheet, so focus goes to the panel's first control.
    if (isPhone) await expect(panel.getByRole("button", { name: "Close panel" })).toBeFocused();
    else await expect(box).toBeFocused();

    await panel.getByRole("button", { name: "Close panel" }).click();
    await expect(panel).toBeHidden();
    await expect(askButton(page)).toBeFocused();
  });

  test("moving within a panel keeps the original opener for when it closes", async ({ page, isPhone }) => {
    await openApp(page);
    const row = isPhone
      ? page
          .getByRole("list", { name: "Top stories and crowd moves, swipe for more" })
          .locator(":scope > li > button")
          .first()
      : page.getByRole("list", { name: "Top 5 now" }).locator(":scope > li > button").first();
    await row.click();
    const panel = detailsPanel(page);
    await expect(panel.getByRole("article").getByRole("heading", { level: 2 })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Close panel" })).toBeFocused();

    // Into the cascade from inside the panel: focus moves into the new panel, not to <body>.
    await panel.getByRole("button", { name: /^See the cascade/ }).click();
    await expect(panel.getByRole("radiogroup", { name: "Show the cascade as" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Close panel" })).toBeFocused();

    await panel.getByRole("button", { name: "Close panel" }).click();
    await expect(panel).toBeHidden();
    // Back on the row that opened the first panel.
    await expect(row, `focus is on ${await focused(page)}`).toBeFocused();
  });

  test("a panel open on page load leaves focus alone, so the skip link comes first", async ({
    page,
    isPhone,
  }) => {
    test.skip(isPhone, "The skip link is for keyboards.");
    await openApp(page, `#story=${STORY}`);
    await expect(detailsPanel(page).getByRole("heading", { level: 2 })).toBeVisible();
    expect(await focused(page)).toBe("<body>");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  });
});

test.describe("focus in and out of search", () => {
  test.beforeEach(({ isPhone }) => {
    test.skip(isPhone, "Keyboard search (Ctrl+K); phones open it from the header, covered in search.spec.ts.");
  });

  test("Escape closes search and focus goes back where it was", async ({ page }) => {
    await openApp(page);
    const settings = header(page, "Settings");
    await settings.focus();
    await page.keyboard.press("Control+K");
    const box = page.getByPlaceholder("Search places, companies, stories, forecasts…");
    await expect(box).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(box).toBeHidden();
    await expect(settings).toBeFocused();
  });

  test("with nothing focused before, closing search puts focus on the main content, not <body>", async ({
    page,
  }) => {
    await openApp(page);
    expect(await focused(page)).toBe("<body>");
    await page.keyboard.press("Control+K");
    const box = page.getByPlaceholder("Search places, companies, stories, forecasts…");
    await expect(box).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(box).toBeHidden();
    await expect(page.locator("#main")).toBeFocused();
  });

  test("a result opens its panel with focus inside, and closing it returns to where search began", async ({
    page,
  }) => {
    await openApp(page);
    const settings = header(page, "Settings");
    await settings.focus();
    await page.keyboard.press("Control+K");
    const box = page.getByPlaceholder("Search places, companies, stories, forecasts…");
    await box.fill("Gujarat");
    const best = page.getByRole("option").first();
    await expect(best).toContainText("Gujarat");
    await expect(best).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(box).toBeHidden();

    const panel = detailsPanel(page);
    await expect(panel.getByRole("heading", { level: 2, name: "Gujarat" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Close panel" })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(settings, `focus is on ${await focused(page)}`).toBeFocused();
  });
});

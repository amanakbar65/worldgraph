/**
 * Deep links: every kind of link opens the right screen and panel, the
 * browser's Back and Forward walk through what the viewer opened, and links
 * the app doesn't understand are ignored safely.
 */
import { currentHash, detailsPanel, expect, openApp, test } from "./fixtures";

const STORY = "story:red-sea-attacks-reroute";
const HEADLINE = "Attacks near Bab-el-Mandeb push container lines onto the Cape route";

test.describe("deep links", () => {
  const cases: { hash: string; heading: string | RegExp; level?: 1 | 2; view?: string }[] = [
    { hash: `#story=${STORY}`, heading: HEADLINE },
    { hash: `#cascade=${STORY}`, heading: HEADLINE },
    { hash: "#region=region:in-gj", heading: "Gujarat" },
    { hash: "#entity=commodity:crude-oil", heading: "Crude oil" },
    { hash: "#forecast=forecast:fed-cut-next-meeting", heading: "Will the Fed cut rates at its next meeting?" },
    { hash: "#compare=region:in,region:cn", heading: "Compare" },
    { hash: "#settings", heading: "Settings" },
    { hash: "#ask", heading: "Ask WorldGraph" },
    { hash: "#forecasts", heading: "Crowd forecasts", level: 1 },
    { hash: "#opportunities", heading: "Opportunities", level: 1 },
    { hash: "#brief", heading: "Daily brief", level: 1 },
    { hash: "#business", heading: "Set up My Business", level: 1 },
    { hash: "#graph", heading: "Knowledge graph", level: 1 },
  ];
  for (const { hash, heading, level = 2 } of cases) {
    test(`${hash} opens where it points`, async ({ page }) => {
      await openApp(page, hash);
      const scope = level === 2 ? detailsPanel(page) : page.locator("main");
      // The graph's h1 is for screen readers only.
      const target = scope.getByRole("heading", { level, name: heading }).first();
      if (hash === "#graph") await expect(target).toBeAttached();
      else await expect(target).toBeVisible();
      await expect.poll(() => currentHash(page)).toBe(hash);
    });
  }

  test("a link keeps the screen, the panel, the window and the sector lens together", async ({ page }) => {
    await openApp(page, `#forecasts&forecast=forecast:fed-cut-next-meeting&w=30d&s=finance`);
    await expect(page.getByRole("heading", { level: 1, name: "Crowd forecasts" })).toBeVisible();
    await expect(detailsPanel(page).getByRole("heading", { level: 2, name: "Will the Fed cut rates at its next meeting?" })).toBeVisible();
    await expect.poll(() => currentHash(page)).toBe("#forecasts&forecast=forecast:fed-cut-next-meeting&w=30d&s=finance");

    await openApp(page, "#region=region:in&w=24h");
    await expect(detailsPanel(page).getByText("Activity in the last 24 hours")).toBeVisible();
  });

  test("Back and Forward walk through what was opened", async ({ page, isPhone }) => {
    await openApp(page, `#story=${STORY}`);
    const panel = detailsPanel(page);
    await expect(panel.getByRole("heading", { level: 2, name: HEADLINE })).toBeVisible();

    // Into the cascade, then to a place.
    await panel.getByRole("button", { name: /^See the cascade/ }).click();
    await expect.poll(() => currentHash(page)).toBe(`#cascade=${STORY}`);
    await page.goBack();
    await expect.poll(() => currentHash(page)).toBe(`#story=${STORY}`);
    await expect(panel.getByRole("article", { name: HEADLINE })).toBeVisible();
    await page.goForward();
    await expect.poll(() => currentHash(page)).toBe(`#cascade=${STORY}`);
    await expect(panel.getByRole("radiogroup", { name: "Show the cascade as" })).toBeVisible();
    await page.goBack();
    await expect(panel.getByRole("article", { name: HEADLINE })).toBeVisible();

    // A screen change is a step too.
    if (isPhone) await page.keyboard.press("Escape");
    await page.goto(`/#forecasts`);
    await expect(page.getByRole("heading", { level: 1, name: "Crowd forecasts" })).toBeVisible();
    await page.goBack();
    await expect.poll(() => currentHash(page)).toBe(`#story=${STORY}`);
    await expect(panel.getByRole("article", { name: HEADLINE })).toBeVisible();
  });

  test("closing a panel goes back to the globe, and Back reopens it", async ({ page }) => {
    await openApp(page);
    await page.evaluate((id) => {
      window.location.hash = `story=${id}`;
    }, STORY);
    const panel = detailsPanel(page);
    await expect(panel.getByRole("heading", { level: 2, name: HEADLINE })).toBeVisible();
    await panel.getByRole("button", { name: "Close panel" }).click();
    await expect(panel).toBeHidden();
    await expect.poll(() => currentHash(page)).toMatch(/^(#globe)?$/);
    await page.goBack();
    await expect(panel.getByRole("heading", { level: 2, name: HEADLINE })).toBeVisible();
  });

  test("links the app doesn't understand are ignored", async ({ page }) => {
    await openApp(page, "#story=not%20an%20id&w=99d&s=nonsense");
    await expect(detailsPanel(page)).toBeHidden();
    await expect(page.getByRole("radiogroup", { name: "Time window" }).getByRole("radio", { name: "Last 7 days" })).toBeChecked();

    await openApp(page, "#story=story:does-not-exist");
    const panel = detailsPanel(page);
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/couldn.t find|not found|no longer|doesn.t exist/i).first()).toBeVisible();
  });

  test("the skip link doesn't reset the app", async ({ page, isPhone }) => {
    test.skip(isPhone, "The skip link is for keyboards.");
    await openApp(page, `#story=${STORY}`);
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(detailsPanel(page).getByRole("heading", { level: 2, name: HEADLINE })).toBeVisible();
  });
});

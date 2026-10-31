/**
 * Command search (Ctrl/Cmd+K on desktop, the header button on phones):
 * typing finds places, companies, stories and forecasts, Enter opens the
 * right panel, recent searches come back, and the quick actions work.
 */
import {
  currentHash,
  detailsPanel,
  expect,
  expectTakesTaps,
  openApp,
  openSearch,
  searchAndOpen,
  snap,
  test,
} from "./fixtures";

test.describe("command search", () => {
  test("Ctrl+K opens it with quick actions, and Escape closes it", async ({ page, isPhone }, testInfo) => {
    await openApp(page);
    const box = await openSearch(page, isPhone);
    const dialog = page.getByRole("dialog", { name: "Search WorldGraph" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("option", { name: /Ask a question/ })).toBeVisible();
    await expect(dialog.getByRole("option", { name: /Open settings/ })).toBeVisible();
    await snap(page, testInfo, "search-empty");

    await box.fill("G");
    await expect(dialog.getByText("Keep typing: two letters or more.")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("Enter on a place opens its region panel", async ({ page, isPhone }) => {
    await openApp(page);
    await searchAndOpen(page, isPhone, "Gujarat", "Gujarat");
    await expect(detailsPanel(page).getByRole("heading", { level: 2, name: "Gujarat" })).toBeVisible();
    await expect.poll(() => currentHash(page)).toBe("#region=region:in-gj");
  });

  test("Enter on a company opens its entity page", async ({ page, isPhone }) => {
    await openApp(page);
    await searchAndOpen(page, isPhone, "TSMC", "TSMC");
    await expect(detailsPanel(page).getByRole("heading", { level: 2, name: "TSMC" })).toBeVisible();
    await expect.poll(() => currentHash(page)).toBe("#entity=org:tsmc");
  });

  test("arrow keys reach a story and a forecast, and Enter opens each", async ({
    page,
    isPhone,
  }, testInfo) => {
    // The second search starts from the header while the first result's sheet is open.
    await openApp(page);
    const box = await openSearch(page, isPhone);
    await box.fill("fed cut");
    const dialog = page.getByRole("dialog", { name: "Search WorldGraph" });
    const forecast = dialog.getByRole("option", { name: /Will the Fed cut rates at its next meeting\?/ });
    await expect(forecast).toBeVisible();
    await snap(page, testInfo, "search-results");
    // Walk down to the forecast with the keyboard.
    for (let i = 0; i < 10 && (await forecast.getAttribute("aria-selected")) !== "true"; i++) {
      await page.keyboard.press("ArrowDown");
    }
    await expect(forecast).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(
      detailsPanel(page).getByRole("heading", {
        level: 2,
        name: "Will the Fed cut rates at its next meeting?",
      }),
    ).toBeVisible();
    await expect.poll(() => currentHash(page)).toBe("#forecast=forecast:fed-cut-next-meeting");

    await searchAndOpen(page, isPhone, "Bab-el-Mandeb", "Bab-el-Mandeb");
    // The best match for a place name is the place (here, the strait).
    await expect(
      detailsPanel(page).getByRole("heading", { level: 2, name: "Bab-el-Mandeb Strait" }),
    ).toBeVisible();
  });

  test("after a search opens a panel, the rest of the page still takes taps", async ({ page, isPhone }) => {
    await openApp(page);
    await searchAndOpen(page, isPhone, "Gujarat", "Gujarat");
    await expect(detailsPanel(page).getByRole("heading", { level: 2, name: "Gujarat" })).toBeVisible();
    // The search dialog has closed: nothing may stay blocked behind it.
    const settings = page.locator('header button[aria-label="Settings"]');
    await expectTakesTaps(settings, "the header's Settings button");
    await settings.click();
    await expect(detailsPanel(page).getByRole("heading", { level: 2, name: "Settings" })).toBeVisible();
  });

  test("with a panel open from the globe, the header's search still takes taps", async ({
    page,
    isPhone,
  }) => {
    await openApp(page);
    const row = isPhone
      ? page
          .getByRole("list", { name: "Top stories and crowd moves, swipe for more" })
          .locator(":scope > li > button")
          .first()
      : page.getByRole("list", { name: "Top 5 now" }).locator(":scope > li > button").first();
    await row.click();
    await expect(detailsPanel(page).getByRole("article").getByRole("heading", { level: 2 })).toBeVisible();
    const box = await openSearch(page, isPhone);
    await box.fill("Gujarat");
    await expect(page.getByRole("option").first()).toContainText("Gujarat");
  });

  test("a search shows up under Recent next time", async ({ page, isPhone }) => {
    // It opens search from the header while the first result's sheet is open.
    await openApp(page);
    await searchAndOpen(page, isPhone, "Mumbai", "Mumbai");
    await expect(detailsPanel(page).getByRole("heading", { level: 2, name: "Mumbai" })).toBeVisible();
    await openSearch(page, isPhone);
    const dialog = page.getByRole("dialog", { name: "Search WorldGraph" });
    await expect(
      dialog.getByRole("group", { name: "Recent" }).getByRole("option", { name: /Mumbai/ }),
    ).toBeVisible();
  });

  test("no matches says so and still offers to ask", async ({ page, isPhone }) => {
    await openApp(page);
    const box = await openSearch(page, isPhone);
    await box.fill("qqzzxx");
    const dialog = page.getByRole("dialog", { name: "Search WorldGraph" });
    await expect(dialog.getByText("No matches for “qqzzxx”")).toBeVisible();
    const ask = dialog.getByRole("option", { name: /Ask: “qqzzxx”/ });
    await expect(ask).toBeVisible();
    await ask.click();
    await expect(detailsPanel(page).getByRole("textbox", { name: "Your question" })).toHaveValue("qqzzxx");
  });

  test("the theme quick action switches the theme", async ({ page, isPhone }) => {
    await openApp(page);
    await openSearch(page, isPhone);
    await page.getByRole("option", { name: /Switch to light theme/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-wg-theme", "light");
  });
});

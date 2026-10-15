/**
 * Ask: the panel opens from the header, a deep link only fills the box, and
 * when no AI is reachable (the website without WorldGraph AI set up, like a
 * local dev server) the answer explains why and still shows what WorldGraph
 * has stored. The artifact build's "no AI outside claude.ai" case is in
 * e2e/artifact/.
 */
import { detailsPanel, expect, openApp, rpc, snap, test } from "./fixtures";

const QUESTION = "How do Red Sea attacks affect shipping costs?";

interface AskContext {
  stories: { id: string; headline: string }[];
}

test.describe("ask", () => {
  test("the header opens Ask with suggestions and a note on what asking uses", async ({ page }, testInfo) => {
    await openApp(page);
    await page.locator("header").getByRole("button", { name: /^Ask( a question)?$/ }).click();
    const panel = detailsPanel(page);
    await expect(panel.getByRole("heading", { level: 2, name: "Ask WorldGraph" })).toBeVisible();
    const box = panel.getByRole("textbox", { name: "Your question" });
    await expect(box).toBeVisible();
    // The website's engine is WorldGraph AI; the note says so before anything is sent.
    await expect(box).toHaveAccessibleDescription("Uses WorldGraph AI, which has a daily limit.");
    await expect(panel.getByRole("button", { name: "Ask", exact: true })).toBeDisabled();
    await expect(page).toHaveURL(/#globe&ask$/);
    await snap(page, testInfo, "ask-open");
  });

  test("a deep link with a question fills the box but sends nothing", async ({ page }) => {
    const aiCalls: string[] = [];
    page.on("request", (r) => {
      if (new URL(r.url()).pathname.startsWith("/api/ai")) aiCalls.push(r.url());
    });
    await openApp(page, `#ask=${encodeURIComponent(QUESTION).replace(/%20/g, "+")}`);
    const panel = detailsPanel(page);
    await expect(panel.getByRole("textbox", { name: "Your question" })).toHaveValue(QUESTION);
    await expect(panel.getByRole("button", { name: "Ask", exact: true })).toBeEnabled();
    await page.waitForTimeout(1000);
    expect(aiCalls, "AI calls before the viewer asks").toEqual([]);
  });

  test("without AI, the answer explains why and shows the closest stored stories", async ({ page }, testInfo) => {
    await openApp(page, "#ask");
    const panel = detailsPanel(page);
    const box = panel.getByRole("textbox", { name: "Your question" });
    await box.fill(QUESTION);
    await box.press("Enter");

    await expect(panel.getByRole("heading", { level: 3, name: QUESTION })).toBeVisible();
    const problem = panel.getByRole("alert");
    await expect(problem).toContainText("AI answers aren't available here", { timeout: 30_000 });
    // It says why, and where Ask does work.
    await expect(problem).toContainText("On the website, Ask uses WorldGraph AI; in the test link, it uses your Claude account.");
    await expect(problem.getByRole("button", { name: "Try again" })).toBeVisible();

    // What WorldGraph has stored is still shown, as facts from sources.
    const context = await rpc<AskContext>(page, "ask_context", { q: QUESTION, limit: 12 });
    expect(context.stories.length).toBeGreaterThan(0);
    const found = panel.getByRole("region", { name: /^Closest stories in WorldGraph/ });
    await expect(found).toBeVisible();
    await expect(found).toContainText(context.stories[0]!.headline);
    await snap(page, testInfo, "ask-unavailable");

    // A found story opens its card.
    await found.getByRole("button").filter({ hasText: context.stories[0]!.headline }).first().click();
    await expect(detailsPanel(page).getByRole("heading", { level: 2, name: context.stories[0]!.headline })).toBeVisible();
  });

  test("Ask from a region suggests questions about that place", async ({ page }) => {
    await openApp(page, "#ask&scope=region:in");
    const panel = detailsPanel(page);
    await expect(panel.getByRole("heading", { level: 2, name: "Ask WorldGraph" })).toBeVisible();
    const suggestions = panel.getByRole("region", { name: /^Try asking/ });
    await expect(suggestions.getByRole("button", { name: "What's changing for business in India?" })).toBeVisible();
    await expect(suggestions.getByRole("button", { name: "Where are the opportunities in India?" })).toBeVisible();
  });
});

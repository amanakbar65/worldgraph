/**
 * Phase A4 on screen: the graph "as of" a past day (kg.history) and the
 * viewer's own undo and redo.
 *
 * - Under Sample data the date control stays visible but off, and says why
 *   (sample data has no history); a deep link to a day says it can't be
 *   shown and offers "Back to now".
 * - With live data a past day reads api.graph_as_of, a banner says which day
 *   is shown, and "Back to now" returns to the live graph. The test database
 *   holds only sample data, so the graph calls are answered here with its
 *   sample graph (the as-of one with the day and when history starts).
 * - A private note's Undo and Redo step through its saved changes, on
 *   phones too (the note sits low in the half-height sheet).
 */
import type { Page, Route } from "@playwright/test";

import { currentHash, detailsPanel, expect, expectTakesTaps, isPhoneProject, openApp, snap, test } from "./fixtures";

const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
/** "2026-10-28" → "28 Oct 2026", as the screen writes a day. */
const formatDay = (day: string) => DAY_FORMAT.format(new Date(`${day}T00:00:00Z`));
/** The viewer's own calendar day `n` days ago, YYYY-MM-DD (what the date field takes). */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const GRAPH_CALLS = new Set(["graph", "graph_as_of", "local_graph", "local_graph_as_of"]);

/**
 * Live data stand-in: the graph calls get the database's sample graph (an
 * as-of call also its day and when history starts). Returns the `at` of
 * every as-of call made.
 */
async function answerGraphCallsWithSample(page: Page, historyStarts: string): Promise<string[]> {
  const asOfDays: string[] = [];
  await page.route("**/api/rpc", async (route: Route) => {
    const body = route.request().postDataJSON() as { fn: string; args: Record<string, unknown> };
    if (!GRAPH_CALLS.has(body.fn)) return route.continue();
    const { at, ...args } = body.args;
    const asOf = body.fn.endsWith("_as_of");
    const response = await route.fetch({
      postData: JSON.stringify({ fn: body.fn.replace(/_as_of$/, ""), args: { ...args, sample: true } }),
    });
    const json = (await response.json()) as { data?: Record<string, unknown> };
    if (asOf && json.data) {
      asOfDays.push(String(at));
      json.data.as_of = `${String(at)}T23:59:59.999999+00:00`;
      json.data.history_starts = `${historyStarts}T09:00:00+00:00`;
    }
    return route.fulfill({ response, json });
  });
  return asOfDays;
}

test.describe("the graph as of a past day", () => {
  test("under Sample data the date control is off and says why", async ({ page }, testInfo) => {
    await openApp(page, "#graph");
    const control = page.getByRole("button", { name: "Past dates: Sample data has no history" });
    await expect(control).toHaveAttribute("aria-disabled", "true");
    await expect(control).toHaveAttribute("title", "Sample data has no history");
    // It stays tappable on purpose, to say why. Playwright won't click an
    // aria-disabled element, so: nothing covers it, then a forced tap.
    await expectTakesTaps(control, "the date control");
    await control.click({ force: true });
    const reason = page.getByRole("dialog").filter({ hasText: "Sample data has no history" });
    await expect(reason).toContainText("Turn Sample data off in Settings to look back.");
    await expect(page.getByLabel("Day to show")).toHaveCount(0);
    if (isPhoneProject(testInfo)) await snap(page, testInfo, "as-of-sample-reason");
    await page.keyboard.press("Escape");
    await expect(reason).toBeHidden();

    // A link to a past day (from someone with live data, say) shows now instead, and says so.
    const day = daysAgo(2);
    await openApp(page, `#graph&at=${day}`);
    const banner = page.getByTestId("as-of-banner");
    await expect(banner).toContainText(`Can't show ${formatDay(day)}`);
    await expect(banner).toContainText("Sample data has no history. Showing now.");
    await banner.getByRole("button", { name: "Back to now" }).click();
    await expect(banner).toBeHidden();
    expect(await currentHash(page)).not.toContain("at=");
  });

  test.describe("with live data", () => {
    test.use({ settings: { theme: "dark", calm: true, sample: "off" } });

    test("a past day reads the as-of graph, says so in a banner, and Back to now returns", async ({
      page,
    }, testInfo) => {
      const historyStarts = daysAgo(20);
      const asOfDays = await answerGraphCallsWithSample(page, historyStarts);
      await openApp(page, "#graph");
      const summary = page.getByRole("img", { name: /^Knowledge graph: \d+ nodes/ });
      await expect(summary).toBeAttached();

      const control = page.getByRole("button", { name: "Show the graph on a past date" });
      await expect(control).not.toHaveAttribute("aria-disabled", "true");
      await control.click();
      const field = page.getByLabel("Day to show");
      await expect(field).toHaveValue(daysAgo(0));
      const day = daysAgo(3);
      await field.fill(day);
      await page.getByRole("button", { name: "Show", exact: true }).click();

      const banner = page.getByTestId("as-of-banner");
      await expect(banner).toContainText(`As of ${formatDay(day)}`);
      await expect(banner.getByRole("status")).toHaveText(`Showing the graph as of ${formatDay(day)}.`);
      await expect.poll(() => asOfDays).toContain(day);
      await expect.poll(() => currentHash(page)).toContain(`at=${day}`);
      await expect(page.getByRole("button", { name: `As of ${formatDay(day)}. Change the date` })).toBeVisible();
      await expect(summary).toBeAttached();
      // The day's history start sets the field's earliest day.
      await page.getByRole("button", { name: `As of ${formatDay(day)}. Change the date` }).click();
      await expect(page.getByText(`History starts on ${formatDay(historyStarts)}.`)).toBeVisible();
      await expect(page.getByLabel("Day to show")).toHaveAttribute("min", historyStarts);
      await page.keyboard.press("Escape");
      await snap(page, testInfo, "as-of-banner");

      await expectTakesTaps(banner.getByRole("button", { name: "Back to now" }), "the banner's Back to now");
      await banner.getByRole("button", { name: "Back to now" }).click();
      await expect(banner).toBeHidden();
      await expect.poll(() => currentHash(page)).not.toContain("at=");
      await expect(page.getByRole("button", { name: "Show the graph on a past date" })).toBeVisible();
      await expect(summary).toBeAttached();
    });
  });
});

test.describe("undo and redo", () => {
  test("a note's Undo and Redo step through its saved changes", async ({ page }, testInfo) => {
    await openApp(page, "#entity=commodity:crude-oil");
    const panel = detailsPanel(page);
    const note = panel.getByRole("textbox", { name: "Your note on Crude oil" });
    const status = panel.getByRole("region", { name: "Your note" }).getByRole("status");
    const stored = () => page.evaluate(() => localStorage.getItem("worldgraph.user.notes") ?? "");
    await expect(note).toBeEnabled();
    await expect(panel.getByRole("button", { name: "Nothing to undo in this note" })).toBeDisabled();
    await expect(panel.getByRole("button", { name: "Nothing to redo in this note" })).toBeDisabled();

    await note.fill("Check freight rates before the OPEC+ meeting.");
    await expect(status).toHaveText("Saved");
    const undo = panel.getByRole("button", { name: "Undo note on Crude oil" });
    await expect(undo).toBeEnabled();
    await snap(page, testInfo, "note-undo");

    // On phones the half-height sheet rose when the note took focus, so Undo is on screen to tap.
    await undo.click();
    await expect(note).toHaveValue("");
    await expect(page.getByTestId("undo-announcer")).toContainText("Undone: note on Crude oil");
    await expect.poll(stored).not.toContain("freight");

    const redo = panel.getByRole("button", { name: "Redo note on Crude oil" });
    await redo.click();
    await expect(note).toHaveValue("Check freight rates before the OPEC+ meeting.");
    await expect(page.getByTestId("undo-announcer")).toContainText("Redone: note on Crude oil");
    await expect.poll(stored).toContain("freight");
    await expect(panel.getByRole("button", { name: "Nothing to redo in this note" })).toBeDisabled();

    // Outside a text field, Ctrl+Z undoes too (a text field keeps its own undo for typing).
    if (!isPhoneProject(testInfo)) {
      await undo.focus();
      await page.keyboard.press("Control+Z");
      await expect(note).toHaveValue("");
      await page.keyboard.press("Control+Shift+Z");
      await expect(note).toHaveValue("Check freight rates before the OPEC+ meeting.");
    }

    // The list survives a reload.
    await page.reload();
    await expect(detailsPanel(page).getByRole("button", { name: "Undo note on Crude oil" })).toBeEnabled();
  });
});

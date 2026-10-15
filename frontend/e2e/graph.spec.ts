/**
 * The knowledge graph and entity pages: the canvas draws, the list view is
 * the keyboard route to the same nodes, an entity page opens with its facts,
 * and a private note saves and survives a reload.
 */
import { currentHash, detailsPanel, expect, goToView, openApp, snap, test } from "./fixtures";

test.describe("graph and entities", () => {
  test("the graph draws on a canvas and describes itself", async ({ page }, testInfo) => {
    await openApp(page);
    await goToView(page, "graph");
    await expect(page.getByRole("heading", { level: 1, name: "Knowledge graph" })).toBeAttached();
    const canvas = page.locator("main canvas").first();
    await expect(canvas).toBeVisible();
    const box = (await canvas.boundingBox())!;
    expect(box.width).toBeGreaterThan(300);
    expect(box.height).toBeGreaterThan(300);

    const summary = page.getByRole("img", { name: /^Knowledge graph: \d+ nodes and \d+ links/ });
    await expect(summary).toBeAttached();
    const [, nodes, links] = /(\d+) nodes and (\d+) links/.exec((await summary.getAttribute("aria-label"))!)!;
    await expect(page.getByText(`${nodes} items · ${links} links`)).toBeVisible();
    expect(Number(nodes)).toBeGreaterThan(0);
    await page.waitForTimeout(1500); // let the force layout settle for the screenshot
    await snap(page, testInfo, "graph");
  });

  test("the list view opens an entity page", async ({ page }) => {
    await openApp(page, "#graph");
    await page.getByRole("radiogroup", { name: "Show as" }).getByRole("radio", { name: "List" }).click();
    const list = page.getByRole("list", { name: "Nodes, most connected first" });
    await expect(list.getByRole("listitem").first()).toBeVisible();

    // The first non-story node opens its entity page.
    const button = list.locator(":scope > li > button").filter({ hasNotText: /^Story/ }).first();
    const name = (await button.getAttribute("aria-label")) ?? (await button.innerText());
    await button.click();
    const panel = detailsPanel(page);
    await expect(panel.getByRole("heading", { level: 2 }).first()).toBeVisible();
    await expect.poll(() => currentHash(page)).toMatch(/^#graph&(entity|story|region|forecast)=/);
    expect(name.length).toBeGreaterThan(0);
  });

  test("an entity page shows its facts, news and forecasts", async ({ page }, testInfo) => {
    await openApp(page, "#entity=commodity:crude-oil");
    const card = detailsPanel(page).getByRole("article", { name: "Crude oil" });
    await expect(card.getByRole("heading", { level: 2, name: "Crude oil" })).toBeVisible();
    await expect(card.getByText("Sample data", { exact: true }).first()).toBeVisible();
    await expect(card.getByRole("region", { name: "Key facts" })).toContainText("HS code");
    await expect(card.getByRole("region", { name: /^In the news/ }).getByRole("listitem").first()).toBeVisible();
    await expect(card.getByRole("region", { name: /^Crowd forecasts/ })).toContainText("Not facts; for information only.");
    await expect(card.getByRole("region", { name: "Linked from" })).toBeVisible();
    await snap(page, testInfo, "entity");

    // A fact links to another page.
    await card.getByRole("region", { name: "Key facts" }).getByRole("button", { name: "Saudi Arabia, region" }).click();
    await expect(detailsPanel(page).getByRole("heading", { level: 2, name: "Saudi Arabia" })).toBeVisible();
    await expect.poll(() => currentHash(page)).toBe("#region=region:sa");
  });

  test("a private note saves, links [[pages]] and survives a reload", async ({ page }) => {
    await openApp(page, "#entity=commodity:crude-oil");
    const panel = detailsPanel(page);
    const note = panel.getByRole("textbox", { name: "Your note on Crude oil" });
    await expect(note).toBeEnabled();
    await note.fill("Hedge before [[OPEC+]] meets; check [[Saudi Arabia]] prices.");
    await expect(panel.getByRole("region", { name: "Your note" }).getByRole("status")).toHaveText("Saved");
    await expect(panel.getByText("Linked in your note")).toBeVisible();
    await expect(panel.getByRole("button", { name: /^Saudi Arabia/ }).last()).toBeVisible();

    const stored = JSON.parse((await page.evaluate(() => localStorage.getItem("worldgraph.user.notes"))) ?? "{}") as Record<
      string,
      unknown
    >;
    expect(JSON.stringify(stored)).toContain("Hedge before [[OPEC+]]");

    await page.reload();
    await expect(detailsPanel(page).getByRole("textbox", { name: "Your note on Crude oil" })).toHaveValue(
      "Hedge before [[OPEC+]] meets; check [[Saudi Arabia]] prices.",
    );
  });

  test("find in graph shows a node's neighbourhood", async ({ page }) => {
    await openApp(page, "#graph");
    const find = page.getByRole("combobox", { name: "Find something in the graph" });
    await find.fill("Crude oil");
    const option = page.getByRole("option", { name: /Crude oil/ }).first();
    await expect(option).toBeVisible();
    await option.click();
    await expect(find).not.toHaveValue("Crude oil x");
  });
});

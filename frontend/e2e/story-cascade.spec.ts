/**
 * The story card and its cascade: open a story from the list, see its card,
 * open the cascade (flow and list), and read why two stories are linked.
 */
import type { Page } from "@playwright/test";

import { currentHash, detailsPanel, expect, openApp, rpc, snap, test } from "./fixtures";

const STORY = "story:red-sea-attacks-reroute";
const HEADLINE = "Attacks near Bab-el-Mandeb push container lines onto the Cape route";

interface Cascade {
  focus: string;
  nodes: { id: string; headline: string; depth: number }[];
  links: { src: string; dst: string; link_type: string; confidence: number; mechanism: string }[];
}

/** Story nodes in the flow or rows in the list: their labels start with where they sit. */
function cascadeNodes(page: Page) {
  return detailsPanel(page).getByRole("button", {
    name: /^(This story|Cause, \d+ steps? back|Effect, \d+ steps? on): /,
  });
}

test.describe("story and cascade", () => {
  test("a story opened from the list shows its card", async ({ page, isPhone }, testInfo) => {
    await openApp(page);
    if (isPhone) await page.getByRole("button", { name: "List of events" }).click();
    else await page.getByRole("radio", { name: "List of all events" }).click();
    await page
      .getByRole("list", { name: "All events" })
      .getByRole("button", { name: new RegExp(`^${HEADLINE}`) })
      .click();

    const panel = detailsPanel(page);
    const card = panel.getByRole("article", { name: HEADLINE });
    await expect(card.getByRole("heading", { level: 2, name: HEADLINE })).toBeVisible();
    await expect(card.getByText("Sample data", { exact: true }).first()).toBeVisible();
    await expect(
      card.getByRole("region", { name: "What you could do" }).getByRole("listitem"),
    ).not.toHaveCount(0);
    await expect(card.getByRole("region", { name: "Causes and effects" })).toBeVisible();
    // Forecasts in the card are labelled as crowd forecasts, not facts.
    await expect(card.getByRole("region", { name: "What the crowd expects next" })).toContainText(
      "Crowd forecasts, not facts.",
    );
    await expect.poll(() => currentHash(page)).toBe(`#story=${STORY}`);
    await snap(page, testInfo, "story-card");
  });

  test("the cascade shows every linked story, as a flow and as a list", async ({
    page,
    isPhone,
  }, testInfo) => {
    await openApp(page, `#story=${STORY}`);
    const cascade = await rpc<Cascade>(page, "cascade", { id: STORY, depth: 2 });
    const story = await rpc<{ causes: number; effects: number }>(page, "story", { id: STORY });

    const panel = detailsPanel(page);
    const open = panel.getByRole("button", { name: /^See the cascade/ });
    await expect(open).toContainText(`${story.causes} causes · ${story.effects} effects`);
    await open.click();

    await expect(panel.getByRole("heading", { level: 2, name: HEADLINE })).toBeVisible();
    await expect(panel.getByText(`${cascade.nodes.length - 1} linked stories within 2 steps`)).toBeVisible();
    await expect.poll(() => currentHash(page)).toBe(`#cascade=${STORY}`);

    const viewAs = panel.getByRole("radiogroup", { name: "Show the cascade as" });
    // Desktop starts with the flow, phones with the list.
    await expect(viewAs.getByRole("radio", { name: isPhone ? "View as list" : "Flow" })).toBeChecked();
    await expect(cascadeNodes(page)).toHaveCount(cascade.nodes.length);
    await expect(cascadeNodes(page).filter({ hasText: HEADLINE }).first()).toBeVisible();
    await snap(page, testInfo, "cascade-first");

    await viewAs.getByRole("radio", { name: isPhone ? "Flow" : "View as list" }).click();
    await expect(cascadeNodes(page)).toHaveCount(cascade.nodes.length);
    for (const node of cascade.nodes) {
      await expect(cascadeNodes(page).filter({ hasText: node.headline }).first()).toBeAttached();
    }
    await snap(page, testInfo, "cascade-second");

    // Fewer steps, fewer stories.
    await panel
      .getByRole("radiogroup", { name: "Steps each way" })
      .getByRole("radio", { name: "1 step each way" })
      .click();
    const one = await rpc<Cascade>(page, "cascade", { id: STORY, depth: 1 });
    await expect(cascadeNodes(page)).toHaveCount(one.nodes.length);
  });

  test("on desktop the flow opens with the story and its direct causes and effects framed", async ({
    page,
    isPhone,
  }, testInfo) => {
    test.skip(isPhone, "Phones open the list.");
    await openApp(page, `#cascade=${STORY}`);
    const flow = detailsPanel(page).locator(".react-flow");
    await expect(flow).toBeVisible();
    await expect(cascadeNodes(page).first()).toBeVisible();
    await page.waitForTimeout(1000); // the opening frame settles after the first layout
    // The flow frames everything when it fits at a readable size (zoom 1, 12 px
    // labels), else the story and its direct causes and effects (cascade-layout.ts
    // fitPlan). When even that is too big at zoom 1, it opens from the frame's
    // left edge (openingViewport), so cards run off only where the viewer pans
    // next: never cut at the left, and never the story itself.
    const direct = detailsPanel(page).getByRole("button", {
      name: /^(This story|Cause, 1 step back|Effect, 1 step on): /,
    });
    expect(await direct.count()).toBeGreaterThan(1);
    const box = (await flow.boundingBox())!;
    const outside: string[] = [];
    const cutLeft: string[] = [];
    for (const node of await direct.all()) {
      const b = await node.boundingBox();
      if (!b) continue;
      const label = ((await node.getAttribute("aria-label")) ?? "").slice(0, 80);
      const inside =
        b.x >= box.x - 1 &&
        b.y >= box.y - 1 &&
        b.x + b.width <= box.x + box.width + 1 &&
        b.y + b.height <= box.y + box.height + 1;
      if (!inside) outside.push(label);
      if (b.x < box.x - 1) cutLeft.push(label);
    }
    await snap(page, testInfo, "cascade-fit");
    if (outside.length > 0) {
      // Too big to frame: shown at the readable zoom, from the left edge.
      const transform = await detailsPanel(page).locator(".react-flow__viewport").getAttribute("style");
      expect(transform, "the opening zoom").toMatch(/scale\(1\)/);
      expect(cutLeft, "story cards cut off at the left of the flow").toEqual([]);
    }
    const story = (await cascadeNodes(page).filter({ hasText: HEADLINE }).first().boundingBox())!;
    expect(story.x).toBeGreaterThanOrEqual(box.x - 1);
    expect(story.y).toBeGreaterThanOrEqual(box.y - 1);
    expect(story.x + story.width).toBeLessThanOrEqual(box.x + box.width + 1);
    expect(story.y + story.height).toBeLessThanOrEqual(box.y + box.height + 1);
  });

  test("on desktop the story card opens clear of the flow's legend and controls", async ({
    page,
    isPhone,
  }, testInfo) => {
    test.skip(isPhone, "Phones open the list.");
    // App bug: openingViewport (src/features/story/cascade-layout.ts) keeps the story a 24 px
    // margin from the flow's bottom edge, but the diagram key sits over the bottom-left corner
    // (about 46 px tall with its margin). When the story is pulled up into view there, its last
    // line ("Risk ▲ · Yemen · 2 d ago") is hidden under the key. Remove test.fail() once the
    // bottom margin clears the key.
    test.fail();
    await openApp(page, `#cascade=${STORY}`);
    const flow = detailsPanel(page).locator(".react-flow");
    await expect(cascadeNodes(page).first()).toBeVisible();
    await page.waitForTimeout(1000);
    const story = (await cascadeNodes(page).filter({ hasText: HEADLINE }).first().boundingBox())!;
    const overlays = await flow
      .locator(".react-flow__panel")
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect));
    await snap(page, testInfo, "cascade-story-and-key");
    const covered = overlays.filter(
      (o) =>
        o.x < story.x + story.width &&
        story.x < o.x + o.width &&
        o.y < story.y + story.height &&
        story.y < o.y + o.height,
    );
    expect(covered, "the legend or controls over the story card").toEqual([]);
  });

  test("a link's evidence opens beside the flow and Escape closes only it", async ({
    page,
    isPhone,
  }, testInfo) => {
    await openApp(page, `#cascade=${STORY}`);
    const panel = detailsPanel(page);
    if (isPhone) await panel.getByRole("radio", { name: "Flow" }).click();
    const label = panel.getByRole("button", {
      name: /^Lengthens voyage times: reported link, high confidence \(90%\)\. Show the evidence\.$/,
    });
    if (isPhone) {
      // The half-height sheet shows only the top of the flow: use the keyboard route.
      await label.focus();
      await page.keyboard.press("Enter");
    } else await label.click();

    const drawer = panel.getByRole("dialog", { name: "Why these are linked" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("heading", { name: /^Evidence/ })).toBeVisible();
    await expect(drawer).toContainText("Asia–Europe container rates jump as ships sail around Africa");
    await snap(page, testInfo, "cascade-evidence");
    // Focus moves into it (so its Escape is its own, not the panel's).
    await expect
      .poll(() => drawer.evaluate((el) => el.contains(document.activeElement)), { message: "focus in the evidence" })
      .toBe(true);

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(panel).toBeVisible();
    await expect.poll(() => currentHash(page)).toBe(`#cascade=${STORY}`);
  });

  test("the list shows each link's type and confidence, and its evidence inline", async ({
    page,
    isPhone,
  }) => {
    await openApp(page, `#cascade=${STORY}`);
    const panel = detailsPanel(page);
    if (!isPhone) await panel.getByRole("radio", { name: "View as list" }).click();
    const row = panel.getByRole("listitem").filter({ hasText: "Asia–Europe container rates jump" }).first();
    await expect(row).toContainText(/Reported/i);
    await expect(row).toContainText("90%");
    const evidence = row.getByRole("button", { name: "Evidence" }).first();
    await evidence.click();
    await expect(evidence).toHaveAttribute("aria-expanded", "true");
    await expect(row.getByRole("heading", { name: /^Evidence/ })).toBeVisible();
  });

  test("opening a story from the cascade replaces it, and Back returns", async ({ page }) => {
    await openApp(page, `#story=${STORY}`);
    const panel = detailsPanel(page);
    await panel.getByRole("button", { name: /^See the cascade/ }).click();
    await expect.poll(() => currentHash(page)).toBe(`#cascade=${STORY}`);
    await panel.getByRole("button", { name: "Back" }).click();
    await expect(panel.getByRole("article", { name: HEADLINE })).toBeVisible();
    await expect.poll(() => currentHash(page)).toBe(`#story=${STORY}`);
  });
});

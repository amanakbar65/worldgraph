/**
 * My Business: the three-step onboarding, a saved profile that survives a
 * reload (this browser's store on the website), and the "Affects you" feed.
 */
import type { Page } from "@playwright/test";

import { expect, goToView, openApp, rpc, snap, test } from "./fixtures";

async function pick(page: Page, field: string, text: string, option: RegExp) {
  const box = page.getByRole("combobox", { name: field });
  await box.fill(text);
  await page
    .getByRole("listbox", { name: `Matches for ${field.toLowerCase()}` })
    .getByRole("option", { name: option })
    .first()
    .click();
}

async function setUpProfile(page: Page) {
  await goToView(page, "business");
  await expect(page.getByRole("heading", { level: 1, name: "Set up My Business" })).toBeVisible();

  // Step 1: sectors.
  const sectors = page.getByRole("group", { name: "Sectors" });
  await sectors.getByRole("button", { name: "Energy" }).click();
  await sectors.getByRole("button", { name: "Manufacturing" }).click();
  await expect(sectors.getByRole("button", { name: "Energy" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Next" }).click();

  // Step 2: places.
  await expect(page.getByRole("heading", { level: 2, name: "Where do you work?" })).toBeVisible();
  await pick(page, "Add to where you operate", "Gujarat", /^Gujarat/);
  await expect(page.getByRole("list", { name: "Where you operate: chosen" })).toContainText("Gujarat");
  await page.getByRole("button", { name: "Next" }).click();

  // Step 3: inputs.
  await expect(page.getByRole("heading", { level: 2, name: "What do you depend on?" })).toBeVisible();
  await pick(page, "Add to key inputs and routes", "crude oil", /^Crude oil/i);
  await expect(page.getByRole("list", { name: "Key inputs and routes: chosen" })).toContainText(/Crude oil/i);
  await page.getByRole("button", { name: "See what affects you" }).click();
}

test.describe("my business", () => {
  test("onboarding saves a profile that survives a reload", async ({ page }, testInfo) => {
    await openApp(page);
    await setUpProfile(page);

    const profile = page.getByRole("list", { name: "Your profile" });
    await expect(profile).toContainText("Energy");
    await expect(profile).toContainText("Manufacturing");
    // Places and inputs are summed up as counts.
    await expect(profile).toContainText("1 place");
    await expect(profile).toContainText("1 input");
    await snap(page, testInfo, "business-dashboard");

    const saved = JSON.parse(
      (await page.evaluate(() => localStorage.getItem("worldgraph.user.profile"))) ?? "null",
    ) as {
      sectors: string[];
      locations: string[];
      inputs: string[];
    } | null;
    expect(saved?.sectors).toEqual(expect.arrayContaining(["energy", "manufacturing"]));
    expect(saved?.locations).toContain("region:in-gj");
    expect(saved?.inputs).toContain("commodity:crude-oil");

    await page.reload();
    await expect(page.getByRole("list", { name: "Your profile" })).toContainText("1 place");
    await expect(page.getByRole("heading", { level: 1, name: "Set up My Business" })).toHaveCount(0);
  });

  test("the Affects you feed lists the stories the database matches to the profile", async ({ page }) => {
    await openApp(page);
    await setUpProfile(page);
    const profile = JSON.parse(
      (await page.evaluate(() => localStorage.getItem("worldgraph.user.profile")))!,
    ) as Record<string, unknown>;
    const affects = await rpc<{ items: { story: { headline: string; impact: string } }[] }>(page, "affects", {
      profile,
      window: "7d",
    });
    expect(affects.items.length).toBeGreaterThan(0);

    const feed = page.getByRole("list", { name: "Stories that affect you" });
    await expect(feed).toBeVisible();
    const first = affects.items[0]!.story.headline;
    await expect(feed.getByRole("listitem").first()).toContainText(first);
    for (const item of affects.items.slice(0, 5)) {
      await expect(feed.getByText(item.story.headline, { exact: true }).first()).toBeVisible();
    }

    // Only risks.
    await page
      .getByRole("radiogroup", { name: "Show risks or opportunities" })
      .getByRole("radio", { name: /Risks/ })
      .click();
    const risks = affects.items.filter((i) => i.story.impact === "risk");
    if (risks[0]) await expect(feed.getByRole("listitem").first()).toContainText(risks[0].story.headline);
    const opportunities = affects.items.filter((i) => i.story.impact === "opportunity");
    for (const item of opportunities.slice(0, 3)) {
      await expect(feed.getByText(item.story.headline, { exact: true })).toHaveCount(0);
    }
  });

  test("skipping setup offers to set it up later", async ({ page }) => {
    await openApp(page, "#business");
    await page.getByRole("button", { name: "Skip setup" }).click();
    await expect(page.getByText("Tell us about your business")).toBeVisible();
    await expect(page.getByRole("button", { name: "Set up My Business" })).toBeVisible();
  });
});

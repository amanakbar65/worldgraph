/**
 * Accessibility: an axe scan (WCAG 2 A and AA) of every screen and panel,
 * in the dark and the light theme. Serious and critical problems fail the
 * test; the failure message lists each rule and the elements it found.
 */
import type { Page } from "@playwright/test";

import {
  type AxeProblem,
  type Settings,
  detailsPanel,
  expect,
  openApp,
  openSearch,
  seriousA11yProblems,
  test,
} from "./fixtures";

const STORY = "story:red-sea-attacks-reroute";

const PROFILE = {
  name: null,
  sectors: ["energy", "manufacturing"],
  locations: ["region:in-gj"],
  inputs: ["commodity:crude-oil"],
  suppliers: [],
  markets: [],
  competitors: [],
  keywords: [],
};

interface State {
  name: string;
  /** Get the page into this state (the app is already open at `hash`). */
  hash: string;
  ready: (page: Page, isPhone: boolean) => Promise<void>;
  before?: (page: Page) => Promise<void>;
}

const panelHeading = (page: Page, name: string | RegExp) =>
  expect(detailsPanel(page).getByRole("heading", { level: 2, name }).first()).toBeVisible();

const STATES: State[] = [
  {
    name: "globe",
    hash: "",
    ready: async (page) => {
      await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();
      await expect(
        page
          .getByRole("region", { name: "Top 5 now" })
          .or(page.getByRole("region", { name: "Top stories and all events" }))
          .first(),
      ).toBeVisible();
    },
  },
  {
    name: "globe list",
    hash: "",
    ready: async (page, isPhone) => {
      if (isPhone) await page.getByRole("button", { name: "List of events" }).click();
      else await page.getByRole("radio", { name: "List of all events" }).click();
      await expect(
        page.getByRole("list", { name: "All events" }).getByRole("listitem").first(),
      ).toBeVisible();
    },
  },
  {
    name: "graph",
    hash: "#graph",
    ready: async (page) => {
      await expect(page.locator("main canvas").first()).toBeVisible();
      await page.waitForTimeout(1000);
    },
  },
  {
    name: "graph list",
    hash: "#graph",
    ready: async (page) => {
      await page.getByRole("radiogroup", { name: "Show as" }).getByRole("radio", { name: "List" }).click();
      await expect(
        page.getByRole("list", { name: "Nodes, most connected first" }).getByRole("listitem").first(),
      ).toBeVisible();
    },
  },
  {
    name: "forecasts",
    hash: "#forecasts",
    ready: async (page) => {
      await expect(
        page
          .getByRole("region", { name: /^All forecasts/ })
          .getByRole("listitem")
          .first(),
      ).toBeVisible();
    },
  },
  {
    name: "opportunities",
    hash: "#opportunities",
    ready: async (page) => {
      await expect(page.getByRole("list", { name: "Openings" }).getByRole("article").first()).toBeVisible();
    },
  },
  {
    name: "business setup",
    hash: "#business",
    ready: async (page) => {
      await expect(page.getByRole("heading", { level: 1, name: "Set up My Business" })).toBeVisible();
    },
  },
  {
    name: "business dashboard",
    hash: "#business",
    before: async (page) => {
      await page.addInitScript((profile) => {
        localStorage.setItem("worldgraph.user.profile", JSON.stringify(profile));
      }, PROFILE);
    },
    ready: async (page) => {
      await expect(
        page.getByRole("list", { name: "Stories that affect you" }).getByRole("listitem").first(),
      ).toBeVisible();
    },
  },
  {
    name: "brief",
    hash: "#brief",
    ready: async (page) => {
      await expect(page.getByRole("heading", { level: 2, name: "Top risks" })).toBeVisible();
      await expect(
        page.getByRole("region", { name: "Top risks" }).getByRole("listitem").first(),
      ).toBeVisible();
    },
  },
  {
    name: "story panel",
    hash: `#story=${STORY}`,
    ready: (page) => panelHeading(page, /^Attacks near Bab-el-Mandeb/),
  },
  {
    name: "cascade",
    hash: `#cascade=${STORY}`,
    ready: async (page) => {
      await panelHeading(page, /^Attacks near Bab-el-Mandeb/);
      await expect(
        detailsPanel(page)
          .getByRole("button", { name: /^This story: / })
          .first(),
      ).toBeVisible();
      await page.waitForTimeout(800);
    },
  },
  {
    name: "cascade list",
    hash: `#cascade=${STORY}`,
    ready: async (page) => {
      await detailsPanel(page).getByRole("radio", { name: "View as list" }).click();
      await expect(detailsPanel(page).getByRole("radio", { name: "View as list" })).toBeChecked();
      await expect(
        detailsPanel(page)
          .getByRole("button", { name: /^This story: / })
          .first(),
      ).toBeVisible();
    },
  },
  {
    name: "region panel",
    hash: "#region=region:in-gj",
    ready: async (page) => {
      await panelHeading(page, "Gujarat");
      await expect(detailsPanel(page).getByRole("region", { name: "Key numbers" })).toBeVisible();
    },
  },
  {
    name: "compare",
    hash: "#compare=region:in,region:cn",
    ready: async (page) => {
      await panelHeading(page, "Compare");
      await expect(detailsPanel(page).getByRole("region", { name: "Key numbers" })).toBeVisible();
    },
  },
  {
    name: "entity panel",
    hash: "#entity=commodity:crude-oil",
    ready: async (page) => {
      await panelHeading(page, "Crude oil");
      await expect(detailsPanel(page).getByRole("region", { name: "Key facts" })).toBeVisible();
    },
  },
  {
    name: "forecast panel",
    hash: "#forecast=forecast:fed-cut-next-meeting",
    ready: async (page) => {
      await panelHeading(page, "Will the Fed cut rates at its next meeting?");
      await expect(
        detailsPanel(page).getByRole("region", { name: "How the forecast has moved" }),
      ).toBeVisible();
    },
  },
  {
    name: "ask panel",
    hash: "#ask",
    ready: (page) => panelHeading(page, "Ask WorldGraph"),
  },
  {
    name: "settings panel",
    hash: "#settings",
    ready: async (page) => {
      await panelHeading(page, "Settings");
      await expect(detailsPanel(page).getByRole("region", { name: "Data sources" })).toBeVisible();
    },
  },
  {
    name: "search",
    hash: "",
    ready: async (page, isPhone) => {
      const box = await openSearch(page, isPhone);
      await box.fill("Gujarat");
      await expect(page.getByRole("option").first()).toContainText("Gujarat");
    },
  },
];

function describeProblems(problems: AxeProblem[]): string {
  return problems.map((p) => `[${p.impact}] ${p.id}: ${p.help}\n    ${p.targets.join("\n    ")}`).join("\n");
}

for (const theme of ["dark", "light"] as const) {
  test.describe(`accessibility, ${theme} theme`, () => {
    test.use({ settings: { theme, calm: true } satisfies Settings });
    for (const state of STATES) {
      test(`${state.name} has no serious or critical axe problems`, async ({ page, isPhone }) => {
        if (state.before) await state.before(page);
        await openApp(page, state.hash);
        await expect(page.locator("html")).toHaveAttribute("data-wg-theme", theme);
        await state.ready(page, isPhone);
        const problems = await seriousA11yProblems(page);
        expect(problems, describeProblems(problems)).toEqual([]);
      });
    }
  });
}

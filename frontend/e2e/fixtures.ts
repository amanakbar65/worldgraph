/// <reference lib="dom" />
/**
 * Shared fixtures and helpers for the end-to-end tests.
 *
 * Every test starts with the viewer's settings in localStorage
 * (`worldgraph.settings.v1`), dark theme, calm motion and Sample data on by default, so
 * screenshots and timings are steady. A test can change them with
 * `test.use({ settings: { … } })`. The settings are written only when the
 * key is missing, so a reload keeps whatever the app saved.
 *
 * Two checks run on every test:
 * - no uncaught error in the page;
 * - no request leaves the app's own origin (the app may not load anything
 *   from other hosts: the claude.ai sandbox blocks it, and the website keeps
 *   viewers' data to itself).
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test as base, type Locator, type Page, type TestInfo } from "@playwright/test";

export interface Settings {
  theme?: "dark" | "light" | "system";
  sample?: "auto" | "on" | "off";
  borders?: "auto" | "india" | "international";
  calm?: boolean;
}

export const SETTINGS_KEY = "worldgraph.settings.v1";

/** A request that went to another host. */
export interface OutsideRequest {
  url: string;
  resourceType: string;
}

interface Fixtures {
  settings: Settings;
  /** Every request to another host made by any page in this test. */
  outsideRequests: OutsideRequest[];
  /** Uncaught page errors. */
  pageErrors: string[];
  /** True on the phone project. */
  isPhone: boolean;
}

export const test = base.extend<Fixtures>({
  // Sample data is off by default in the app, and the test database holds only
  // sample data (`wg seed load`), so the tests turn it on unless they say otherwise.
  settings: [{ theme: "dark", calm: true, sample: "on" }, { option: true }],
  // eslint-disable-next-line no-empty-pattern
  isPhone: async ({}, provide, testInfo) => {
    await provide(isPhoneProject(testInfo));
  },
  outsideRequests: async ({ context, baseURL }, provide) => {
    const origin = new URL(baseURL ?? "http://127.0.0.1").origin;
    const seen: OutsideRequest[] = [];
    context.on("request", (request) => {
      const url = request.url();
      if (/^(data|blob|about):/.test(url)) return;
      if (new URL(url).origin !== origin) seen.push({ url, resourceType: request.resourceType() });
    });
    await provide(seen);
  },
  pageErrors: async ({ context }, provide) => {
    const errors: string[] = [];
    const watch = (page: Page) =>
      page.on("pageerror", (error) => {
        // Chromium reports this when a ResizeObserver callback resizes again; harmless.
        if (/ResizeObserver loop/.test(error.message)) return;
        errors.push(`${error.name}: ${error.message}`);
      });
    context.pages().forEach(watch);
    context.on("page", watch);
    await provide(errors);
  },
  page: async ({ page, settings, outsideRequests, pageErrors }, provide) => {
    await page.addInitScript(
      ([key, value]) => {
        try {
          if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
        } catch {
          // Storage blocked: the app falls back to its defaults.
        }
      },
      [SETTINGS_KEY, JSON.stringify(settings)] as const,
    );
    await provide(page);
    expect(pageErrors, "uncaught errors in the page").toEqual([]);
    expect(
      outsideRequests.map((r) => r.url),
      "requests to hosts other than the app's own",
    ).toEqual([]);
  },
});

export { expect };

export function isPhoneProject(testInfo: TestInfo): boolean {
  return /phone/.test(testInfo.project.name);
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/** Open the app (optionally at a deep link) and wait until the shell and data are there. */
export async function openApp(page: Page, hash = ""): Promise<void> {
  await page.goto(`/${hash}`);
  // CSS, not the role: a sheet open on a phone hides the rest from the accessibility tree.
  await expect(page.locator("header").first()).toBeVisible();
  await expect(appStatus(page)).not.toHaveText(/Connecting/, { timeout: 30_000 });
}

/**
 * The status pill at the bottom-left ("Sample data", "Live data", "Sample snapshot · …").
 * It holds a short and a long form and hides one by screen width, so compare
 * its text with `{ useInnerText: true }` when the exact wording matters.
 */
export function appStatus(page: Page): Locator {
  return page.locator("div[title] > span[role=status]").first();
}
export const statusLine = appStatus;

const VIEW_LABELS = {
  globe: "Globe",
  graph: "Graph",
  forecasts: "Forecasts",
  opportunities: "Opportunities",
  business: "My Business",
  brief: "Brief",
} as const;
export type ViewName = keyof typeof VIEW_LABELS;

/** Switch screens the way a viewer would: the header on desktop, the tab bar (and "More") on phones. */
export async function goToView(page: Page, view: ViewName): Promise<void> {
  const label = VIEW_LABELS[view];
  // On phones an open sheet covers the tab bar: close it first, as a viewer would.
  const sheet = page.getByRole("dialog", { name: "Details" });
  if (await sheet.isVisible()) {
    await sheet.getByRole("button", { name: "Close panel" }).click();
    await expect(sheet).toBeHidden();
  }
  const nav = page.getByRole("navigation", { name: "Screens" });
  const phoneTabs = nav.filter({ has: page.getByRole("button", { name: "More" }) });
  if (await phoneTabs.isVisible()) {
    const tab = phoneTabs.getByRole("button", { name: label.replace("My ", ""), exact: true });
    if (await tab.isVisible()) await tab.click();
    else {
      await phoneTabs.getByRole("button", { name: "More" }).click();
      await phoneTabs.getByRole("button", { name: label, exact: true }).click();
    }
  } else {
    await nav.getByRole("button", { name: label, exact: true }).click();
  }
}

/** Open Ctrl/Cmd+K search: the shortcut on desktop, the header button on phones. Returns its text box. */
export async function openSearch(page: Page, isPhone: boolean): Promise<Locator> {
  // CSS, not the role: an open sheet hides the header from the accessibility
  // tree on phones, but the button is still there to tap (and must take the tap).
  if (isPhone) {
    const button = page.locator('header button[aria-label^="Search"]');
    await expectTakesTaps(button, "the header's Search button");
    await button.click();
  } else await page.keyboard.press("Control+K");
  const box = page.getByPlaceholder("Search places, companies, stories, forecasts…");
  await expect(box).toBeFocused();
  return box;
}

/**
 * A tap on the middle of `target` reaches it: nothing covers it and nothing
 * blocks pointer events (as `pointer-events: none` left on <body> would).
 */
export async function expectTakesTaps(target: Locator, what: string): Promise<void> {
  await expect(target).toBeVisible();
  // Polled: a dialog's closing animation may cover it for a moment, and a page
  // busy drawing its first globe frame can take a while to answer.
  await expect
    .poll(
      () =>
        target.evaluate((el) => {
          const box = el.getBoundingClientRect();
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          if (hit !== null && el.contains(hit)) return "reaches it";
          // Say what is in the way instead.
          const name = hit
            ? `<${hit.tagName.toLowerCase()} class="${hit.getAttribute("class") ?? ""}">`
            : "nothing";
          return `${name}; body pointer-events: ${getComputedStyle(document.body).pointerEvents}`;
        }),
      { message: `a tap on ${what}`, timeout: 45_000 },
    )
    .toBe("reaches it");
}

/**
 * Search for `text` and press Enter once the best match (an option whose
 * text contains `expect`) is highlighted.
 */
export async function searchAndOpen(page: Page, isPhone: boolean, text: string, match: string | RegExp) {
  const box = await openSearch(page, isPhone);
  await box.fill(text);
  const best = page.getByRole("option").first();
  await expect(best).toContainText(match);
  await expect(best).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(box).toBeHidden();
}

/** The open panel: a side panel on desktop, a bottom sheet on phones. */
export function detailsPanel(page: Page): Locator {
  return page
    .getByRole("complementary", { name: "Details" })
    .or(page.getByRole("dialog", { name: "Details" }));
}

/** The hash part of the page's URL ("" when none). */
export async function currentHash(page: Page): Promise<string> {
  return page.evaluate(() => window.location.hash);
}

/**
 * Ask the same api function the page uses (POST /api/rpc), to compare what
 * the screen shows with what the database says.
 */
export async function rpc<T = Record<string, unknown>>(
  page: Page,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const response = await page.request.post("/api/rpc", { data: { fn, args } });
  expect(response.ok(), `api.${fn} answered ${response.status()}`).toBe(true);
  return ((await response.json()) as { data: T }).data;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

export interface AxeProblem {
  id: string;
  impact: string | null | undefined;
  help: string;
  targets: string[];
}

/**
 * Scan the page (or part of it) with axe for WCAG 2 A and AA problems and
 * return the serious and critical ones, with their elements.
 */
export async function seriousA11yProblems(page: Page, include?: string): Promise<AxeProblem[]> {
  // Colours are measured as drawn: let opening fades (a dialog's fade-in) finish first.
  // Endless ones, like a loading pulse, are left alone, and nothing waits more than 5 s.
  await page.evaluate(() =>
    Promise.race([
      Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => undefined)),
      ),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]),
  );
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]);
  if (include) builder = builder.include(include);
  const results = await builder.analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      targets: v.nodes
        .slice(0, 8)
        .map((n) => `${n.target.join(" ")} :: ${n.failureSummary ?? ""}`.slice(0, 400)),
    }));
}

/**
 * Betting or trading wording, as the product rules forbid on forecast
 * screens. Topical phrases about international trade ("Global trade",
 * "a trade deal") are news, not calls to action, so they are removed first.
 */
const BETTING_WORDS = /\b(bet|bets|betting|wager|trade|trading)\b/i;
const TRADE_TOPICS =
  /\b(global trade|logistics and trade|trade (deal|deals|talks|war|wars|flows?|routes?|polic(y|ies)|rules?|data|deficit|surplus|agreement|pact|barriers?|tensions?|ministry|minister|representative|partners?|volumes?|finance|restrictions?|curbs?|controls?|review)|(free|world|foreign|bilateral|cross-border|international|global) trade)\b/gi;

export function bettingWords(text: string): string[] {
  const cleaned = text.replace(TRADE_TOPICS, " ");
  const found: string[] = [];
  for (const line of cleaned.split(/\n+/)) {
    if (BETTING_WORDS.test(line)) found.push(line.trim().slice(0, 160));
  }
  return found;
}

/** The visible text of the page, line by line. */
export async function visibleText(page: Page): Promise<string> {
  return page.locator("body").innerText();
}

/** Where `snap()` saves its screenshots (git-ignored); E2E_SHOTS changes the folder under test-results/. */
const SHOTS = `test-results/${process.env.E2E_SHOTS ?? "screenshots"}`;

/** Save a full-window screenshot under test-results/screenshots/<project>/ for a person to look at. */
export async function snap(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.screenshot({
    path: `${SHOTS}/${testInfo.project.name}/${name}.png`,
    animations: "disabled",
  });
}

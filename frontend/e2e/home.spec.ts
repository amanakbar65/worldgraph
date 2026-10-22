/**
 * The WorldGraph logo is Home on every screen size: it goes back to the
 * globe, flies the camera to the whole-globe view and starts the globe's
 * slow turn. The turn also starts after 30 s without input while nothing is
 * open over the globe, and any input stops it. Never with Calm motion on.
 *
 * The camera and the turn are read through the dev server's debugging hook
 * (`window.__wgGlobe`, set only in development builds), so these tests run
 * against `vite` (the default config), not the artifact build.
 */
import type { Page } from "@playwright/test";

import { currentHash, detailsPanel, expect, goToView, openApp, type Settings, test } from "./fixtures";

/** The globe's home view (GlobeView.tsx HOME_CENTER). */
const HOME_CENTER = { lng: 25, lat: 20 };

interface Camera {
  lng: number;
  lat: number;
  zoom: number;
  mode: "still" | "after-flight" | "turning";
  moving: boolean;
}

/** The map's camera and the turn's state, once the globe has loaded. */
async function camera(page: Page): Promise<Camera> {
  await page.waitForFunction(() => {
    const g = (window as unknown as { __wgGlobe?: { map?: { loaded(): boolean }; spin?: unknown } }).__wgGlobe;
    return !!g?.spin && !!g.map?.loaded();
  });
  return page.evaluate(() => {
    const g = (
      window as unknown as {
        __wgGlobe: {
          map: { getCenter(): { lng: number; lat: number }; getZoom(): number; isMoving(): boolean };
          spin: { mode: Camera["mode"] };
        };
      }
    ).__wgGlobe;
    const c = g.map.getCenter();
    return { lng: c.lng, lat: c.lat, zoom: g.map.getZoom(), mode: g.spin.mode, moving: g.map.isMoving() };
  });
}

/** Move the camera from the test (not viewer input, so it neither stops nor starts a turn). */
async function jumpTo(page: Page, center: [number, number], zoom: number) {
  await camera(page);
  await page.evaluate(
    ([c, z]) => {
      const g = (window as unknown as { __wgGlobe: { map: { jumpTo(o: object): void } } }).__wgGlobe;
      g.map.jumpTo({ center: c, zoom: z });
    },
    [center, zoom] as const,
  );
}

const logo = (page: Page) => page.locator('header button[aria-label="WorldGraph home"]');

test.describe("the logo is Home", () => {
  test("it goes back to the globe from another screen", async ({ page, isPhone }) => {
    await openApp(page);
    await goToView(page, "forecasts");
    await expect(page.locator("main h1")).toHaveText("Crowd forecasts");
    await expect.poll(() => currentHash(page)).toBe("#forecasts");

    await logo(page).click();
    await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();
    await expect.poll(() => currentHash(page)).toMatch(/^(#globe)?$/);
    await expect(
      page.getByRole("radiogroup", { name: "Time window" }).getByRole("radio", { name: "Last 7 days" }),
    ).toBeVisible();
    // The screen tabs agree: the globe is the current screen.
    const nav = page.getByRole("navigation", { name: "Screens" });
    await expect(nav.getByRole("button", { name: "Globe", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    if (!isPhone) await expect(nav.getByRole("button", { name: "Forecasts", exact: true })).not.toHaveAttribute("aria-current", "page");
  });

  test.describe("with motion on", () => {
    test.use({ settings: { theme: "dark", calm: false } satisfies Settings });

    test("it flies the globe home and starts the slow turn; a key press stops it", async ({ page }) => {
      await openApp(page);
      const start = await camera(page);
      expect(start.mode).toBe("still");
      // Somewhere else, zoomed in.
      await jumpTo(page, [77, 22], 4);
      expect((await camera(page)).zoom).toBeCloseTo(4, 1);

      await logo(page).click();
      // The flight lands on the home view, then the turn starts.
      await expect.poll(async () => (await camera(page)).mode, { timeout: 30_000 }).toBe("turning");
      const landed = await camera(page);
      expect(landed.lat).toBeCloseTo(HOME_CENTER.lat, 0);
      expect(landed.zoom).toBeCloseTo(start.zoom, 1);
      // It turns east, slowly (about 2.4° a second at full speed).
      await expect
        .poll(async () => (await camera(page)).lng - landed.lng, { timeout: 15_000 })
        .toBeGreaterThan(0.5);
      const turned = (await camera(page)).lng - HOME_CENTER.lng;
      expect(turned).toBeLessThan(90);

      await page.keyboard.press("Shift");
      await expect.poll(async () => (await camera(page)).mode).toBe("still");
      const stopped = (await camera(page)).lng;
      await page.waitForTimeout(1000);
      expect((await camera(page)).lng).toBeCloseTo(stopped, 3);
    });

    test("from another screen it lands on the globe turning", async ({ page }) => {
      await openApp(page);
      await goToView(page, "brief");
      await expect(page.locator("main h1")).toHaveText("Daily brief");
      await logo(page).click();
      await expect.poll(async () => (await camera(page)).mode, { timeout: 30_000 }).toBe("turning");
      expect((await camera(page)).lat).toBeCloseTo(HOME_CENTER.lat, 0);
    });

    test("after 30 s without input the globe turns, but not while a panel is open", async ({ page }) => {
      test.slow(); // two 30-second waits
      await openApp(page, "#region=region:in");
      const panel = detailsPanel(page);
      await expect(panel.getByRole("heading", { level: 2, name: "India" })).toBeVisible();
      // A panel covers the globe: idle time never starts a turn.
      await page.waitForTimeout(32_000);
      expect((await camera(page)).mode).toBe("still");

      // Closed from the page itself (no viewer input): idle time counts from now.
      await page.evaluate(() => {
        window.location.hash = "";
      });
      await expect(panel).toBeHidden();
      // Only the whole globe turns by itself: frame it as the home view does.
      await jumpTo(page, [HOME_CENTER.lng, HOME_CENTER.lat], (await camera(page)).zoom);
      await expect
        .poll(async () => (await camera(page)).mode, { timeout: 45_000, intervals: [2_000] })
        .toBe("turning");

      // Any input stops it at once.
      await page.keyboard.press("Shift");
      await expect.poll(async () => (await camera(page)).mode).toBe("still");
    });
  });

  test("with Calm motion on, it flies home but never turns", async ({ page }) => {
    await openApp(page);
    const start = await camera(page);
    await jumpTo(page, [77, 22], 4);
    await logo(page).click();
    await expect.poll(async () => (await camera(page)).zoom, { timeout: 15_000 }).toBeCloseTo(start.zoom, 1);
    const landed = await camera(page);
    expect(landed.lat).toBeCloseTo(HOME_CENTER.lat, 0);
    expect(landed.lng).toBeCloseTo(HOME_CENTER.lng, 0);
    await page.waitForTimeout(2000);
    const later = await camera(page);
    expect(later.mode).toBe("still");
    expect(later.lng).toBeCloseTo(landed.lng, 3);
  });
});

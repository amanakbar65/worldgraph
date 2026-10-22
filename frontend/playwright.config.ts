import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests (e2e/README.md), headless Chromium, desktop and phone:
 * - the website (`desktop`, `phone`: e2e/*.spec.ts) against `vite` in dev
 *   mode, with the local /api/rpc middleware reading DEV_DATABASE_URL;
 * - the claude.ai test link (`artifact-desktop`, `artifact-phone`:
 *   e2e/artifact/) against `npm run build:artifact` served by `vite preview`.
 *
 *   npm run e2e                      everything
 *   npm run e2e:website              the website projects only
 *   npm run e2e:artifact             the test-link projects only
 *
 * The database needs the migrations and the sample data:
 *   cd backend && DATABASE_URL=… uv run wg db migrate && DATABASE_URL=… uv run wg seed load
 */
const PORT = Number(process.env.E2E_PORT ?? 5301);
const ARTIFACT_PORT = Number(process.env.E2E_ARTIFACT_PORT ?? 5351);
export const BASE_URL = `http://127.0.0.1:${PORT}`;
const ARTIFACT_URL = `http://127.0.0.1:${ARTIFACT_PORT}`;
const DATABASE_URL = process.env.DEV_DATABASE_URL ?? "postgresql://wg:wg@localhost:5432/worldgraph_dev";

/** The cloud workspace ships Chromium here; elsewhere Playwright's own download is used. */
const CHROMIUM = "/opt/pw-browsers/chromium";
export const launchOptions = existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {};

export const desktop = {
  ...devices["Desktop Chrome"],
  viewport: { width: 1440, height: 900 },
  launchOptions,
};
export const phone = {
  ...devices["Pixel 7"],
  browserName: "chromium" as const,
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  launchOptions,
};

const WEBSITE = { testDir: "./e2e", testIgnore: ["artifact/**"] };
const TEST_LINK = { testDir: "./e2e/artifact" };

export default defineConfig({
  outputDir: "./test-results/e2e-output",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // The globe is WebGL on the CPU in headless Chromium: keep the workers few,
  // and the time limits generous (a busy machine can take 30 s per test).
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 2,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "en-US",
    timezoneId: "UTC",
  },
  projects: [
    { name: "desktop", ...WEBSITE, use: { ...desktop, baseURL: BASE_URL } },
    { name: "phone", ...WEBSITE, use: { ...phone, baseURL: BASE_URL } },
    // Outside claude.ai the test link has no capabilities (no connector, no AI,
    // no db), so it falls back to the bundled snapshot without the network.
    { name: "artifact-desktop", ...TEST_LINK, use: { ...desktop, baseURL: ARTIFACT_URL } },
    { name: "artifact-phone", ...TEST_LINK, use: { ...phone, baseURL: ARTIFACT_URL } },
  ],
  webServer: [
    {
      command: `npx vite --host 127.0.0.1 --port ${PORT} --strictPort`,
      url: BASE_URL,
      reuseExistingServer: true,
      timeout: 120_000,
      env: { DEV_DATABASE_URL: DATABASE_URL },
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      // Built fresh unless a server is already there (then that one's build is tested).
      command: `npm run build:artifact && npx vite preview --outDir dist-artifact --host 127.0.0.1 --port ${ARTIFACT_PORT} --strictPort`,
      url: ARTIFACT_URL,
      reuseExistingServer: true,
      timeout: 300_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});

import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the website build served by `vite` (dev mode),
 * with the local /api/rpc middleware reading DEV_DATABASE_URL.
 *
 *   npm run e2e                      both projects (desktop and phone)
 *   npm run e2e -- --project=phone   one project
 *   npm run e2e:artifact             builds the claude.ai test link, then tests it (e2e/artifact.config.ts)
 *   npm run e2e:artifact:run         the same tests against the existing dist-artifact/
 *
 * The database needs the migrations and the sample data:
 *   cd backend && DATABASE_URL=… uv run wg db migrate && DATABASE_URL=… uv run wg seed load
 */
const PORT = Number(process.env.E2E_PORT ?? 5301);
export const BASE_URL = `http://127.0.0.1:${PORT}`;
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

export default defineConfig({
  testDir: "./e2e",
  testIgnore: ["artifact/**"],
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
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "en-US",
    timezoneId: "UTC",
  },
  projects: [
    { name: "desktop", use: desktop },
    { name: "phone", use: phone },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
    env: { DEV_DATABASE_URL: DATABASE_URL },
    stdout: "ignore",
    stderr: "pipe",
  },
});

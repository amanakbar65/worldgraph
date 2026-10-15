import { fileURLToPath } from "node:url";

import { defineConfig } from "@playwright/test";

import { desktop, phone } from "../playwright.config";

/**
 * End-to-end tests for the claude.ai test link: the artifact build
 * (`npm run build:artifact` → dist-artifact/) served by `vite preview`.
 * Outside claude.ai it has no capabilities (no connector, no AI, no db), so
 * it must fall back to the bundled snapshot without touching the network.
 *
 *   npm run e2e:artifact          builds, then runs these tests
 *   npm run e2e:artifact:run      runs them against the existing build
 */
const PORT = Number(process.env.E2E_ARTIFACT_PORT ?? 5351);
const FRONTEND = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  testDir: "./artifact",
  outputDir: "../test-results/e2e-artifact-output",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 2,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [["list"], ["html", { outputFolder: "../test-results/playwright-report-artifact", open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "en-US",
    timezoneId: "UTC",
  },
  projects: [
    { name: "artifact-desktop", use: desktop },
    { name: "artifact-phone", use: phone },
  ],
  webServer: {
    command: `npx vite preview --outDir dist-artifact --host 127.0.0.1 --port ${PORT} --strictPort`,
    cwd: FRONTEND,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});

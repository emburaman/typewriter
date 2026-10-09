import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a running app (docker compose up, or npm run dev).
 *   E2E_BASE_URL            defaults to http://localhost:4000
 *   PLAYWRIGHT_CHROMIUM_PATH optional path to an existing Chromium binary
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false, // tests share the single-user settings row
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:4000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
          : {},
      },
    },
  ],
});

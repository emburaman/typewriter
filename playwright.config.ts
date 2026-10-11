import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a running app started with NODE_ENV=test AUTH_DEV_LOGIN=true
 * (test-only sign-in) on a fresh database.
 *   E2E_BASE_URL            defaults to http://localhost:4000
 *   PLAYWRIGHT_CHROMIUM_PATH optional path to an existing Chromium binary
 */
export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false, // tests share the single-user settings row
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:4000",
    // Signed in as the admin (see global-setup.ts); multi-user tests create their own sessions.
    storageState: "tests/e2e/.auth/admin.json",
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

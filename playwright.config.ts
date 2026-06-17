import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the invoice view + Print verification suite.
 *
 * Prerequisites to run (see e2e/invoices.spec.ts header for the full list):
 *   - Backend on :3000 with the invoice HTML/PDF endpoints (enviable-system
 *     commit 45f8f0b or later) and seeded fixtures (one invoice, one proforma).
 *   - Frontend dev server on :3100 (npm run dev).
 *   - `npx playwright install chromium` once to fetch the browser.
 *   - Env: E2E_BASE_URL (default http://localhost:3100), plus the fixture and
 *     credential env vars documented in the spec.
 *
 * Run: npm run e2e
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    trace: "on-first-retry",
    acceptDownloads: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});

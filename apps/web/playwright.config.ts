import { defineConfig, devices } from "@playwright/test";

/**
 * E2E — runs against the real app + seeded demo DB.
 * `pnpm --filter @zfloat/web test:e2e`
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 20_000 },
  retries: 1,
  globalSetup: "./e2e/global-setup.ts",
  // One worker keeps the dev server's on-demand compile predictable.
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    // Production server (next start) — deterministic, low memory, no
    // on-demand compile. Run the suite with the production build env
    // exported (e.g. `source /tmp/zf-build-env.sh && pnpm test:e2e`);
    // the seeded demo DB must be present.
    command: "pnpm --filter @zfloat/web start",
    url: "http://localhost:3000",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});

import { defineConfig, devices } from "@playwright/test";

/*
 * Browser smoke tests against a seeded, disposable database.
 *   E2E_DATABASE_URL=<test db> pnpm test:e2e
 * The web server runs `next start` on the production build with that database.
 */
const databaseUrl = process.env.E2E_DATABASE_URL;
const port = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
  globalSetup: "./tests/e2e/global-setup.ts",
  webServer: {
    command: `pnpm next start -p ${port}`,
    port,
    reuseExistingServer: false,
    env: { DATABASE_URL: databaseUrl ?? "", DATABASE_POOL_MAX: process.env.DATABASE_POOL_MAX ?? "" },
    timeout: 120_000,
  },
});

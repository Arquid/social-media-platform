import { defineConfig } from '@playwright/test';

const PORT = 5175;
// A second copy of the app, with error reporting switched on, for e2e/error-reporting.spec.js.
// The address does not exist: the test catches what the browser tries to send to it.
const REPORTING_PORT = 5176;
const REPORTING_DSN = 'http://e2ekey@localhost:9999/42';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Tests share one local database, so run them one at a time
  fullyParallel: false,
  workers: 1,
  // A freshly started CI machine can be slow for the first requests; retry a failed test once
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './e2e/global-setup.js',
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Uses the Edge/Chrome already installed on the machine, so no browser download is needed.
    // Override with E2E_BROWSER=chrome (or "chromium" after running `npx playwright install chromium`).
    channel: process.env.E2E_BROWSER ?? 'msedge',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: `npm run dev:local -- --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `npm run dev:local -- --port ${REPORTING_PORT} --strictPort`,
      url: `http://localhost:${REPORTING_PORT}`,
      env: { VITE_SENTRY_DSN: REPORTING_DSN },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});

import { defineConfig } from '@playwright/test';

const PORT = 5175;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Tests share one local database, so run them one at a time
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './e2e/global-setup.js',
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Uses the Edge/Chrome already installed on the machine, so no browser download is needed.
    // Override with E2E_BROWSER=chrome (or "chromium" after running `npx playwright install chromium`).
    channel: process.env.E2E_BROWSER ?? 'msedge',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run dev:local -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

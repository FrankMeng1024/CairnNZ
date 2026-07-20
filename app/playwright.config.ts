/**
 * Playwright config for Cairn web-runnable regression tests.
 *
 * Run:
 *   cd app
 *   npx playwright test
 *
 * Prereqs:
 *   - `expo start --web --port 8081` running in another terminal
 *   - `@playwright/test` installed (devDependency)
 *   - `npx playwright install chromium` once per machine
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,           // expo web shared port; serialize
  timeout: 60_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:8081',
    headless: true,
    viewport: { width: 375, height: 812 },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});

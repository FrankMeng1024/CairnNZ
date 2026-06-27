/**
 * Playwright config for Sprint 71 web-runnable scenarios.
 *
 * Run:
 *   cd app
 *   npx playwright test tests/sprint71
 *
 * Prereqs:
 *   - `expo start --web --port 8081` running in another terminal
 *   - `@playwright/test` installed (devDependency)
 *   - `npx playwright install chromium` once per machine
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/sprint71',
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

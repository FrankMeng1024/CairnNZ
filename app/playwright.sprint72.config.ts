/**
 * Sprint 72 Playwright config — extends Sprint 71 baseline.
 *
 * Run:
 *   cd app
 *   npx expo start --web --port 8081        # in one terminal
 *   npx playwright test tests/sprint72       # in another
 *
 * Prereqs:
 *   - @playwright/test installed
 *   - `npx playwright install chromium` once
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/sprint72',
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 8_000 },
  reporter: [['list'], ['html', { outputFolder: '../docs/qa/sprint72-playwright-html', open: 'never' }]],
  outputDir: '../docs/qa/sprint72-evidence',
  use: {
    baseURL: 'http://localhost:8081',
    headless: true,
    viewport: { width: 375, height: 812 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});

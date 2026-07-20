/**
 * Playwright config for cleanup baseline test
 * Run: cd app && npx playwright test tests/cleanup-baseline
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/cleanup-baseline',
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 8_000 },
  reporter: [['list'], ['html', { outputFolder: '../docs/qa/cleanup-baseline-playwright-html', open: 'never' }]],
  outputDir: '../docs/qa/cleanup-baseline-2026-07-19',
  use: {
    baseURL: 'http://localhost:8082',
    headless: true,
    viewport: { width: 375, height: 812 },
    trace: 'retain-on-failure',
    screenshot: 'on',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});

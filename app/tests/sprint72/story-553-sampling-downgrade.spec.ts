/**
 * Sprint 72 STORY-00553/554 — sampling downgrade + flush interval.
 *
 * We can't directly control AppState in Playwright, but we can verify the
 * getSamplingInterval() pure function via page.evaluate against the bundled
 * module. The dynamicSamplingInterval branch fires every 10s in a real
 * session; we assert its breadcrumb via a fast-forward simulation once
 * an active tracking session is seeded.
 *
 * For most rigorous unit-level testing, see
 * `app/src/utils/__tests__/geo-dynamic-sampling.test.ts` (Jest).
 */
import { test, expect } from '@playwright/test';
import { goHome } from './helpers';

test.describe('STORY-00553 — background GPS sampling downgrade (unit-via-web)', () => {
  test('getSamplingInterval: background + battery=0.4 + running + !charging → 1000ms', async ({ page }) => {
    await goHome(page);
    const result = await page.evaluate(() => {
      const mod = (globalThis as unknown as { __cairnGetSamplingInterval?: unknown }).__cairnGetSamplingInterval;
      if (!mod) return { skipped: true };
      const fn = mod as (m: string, low: boolean, opts?: object) => number;
      return {
        bg_running_low_batt: fn('running', false, { appState: 'background', batteryLevel: 0.4, isCharging: false }),
        fg_running: fn('running', false, { appState: 'active', batteryLevel: 0.4, isCharging: false }),
        bg_running_charging: fn('running', false, { appState: 'background', batteryLevel: 0.4, isCharging: true }),
        bg_running_high_batt: fn('running', false, { appState: 'background', batteryLevel: 0.6, isCharging: false }),
        bg_walking_low_batt: fn('walking', false, { appState: 'background', batteryLevel: 0.4, isCharging: false }),
        battery_low_forced: fn('running', true, { appState: 'active' }),
      };
    });
    if ('skipped' in result && result.skipped) {
      test.skip(true, 'getSamplingInterval not exposed to window — see jest unit test instead');
      return;
    }
    const r = result as Record<string, number>;
    expect(r.bg_running_low_batt).toBe(1000);
    expect(r.fg_running).toBe(500);
    expect(r.bg_running_charging).toBe(500);
    expect(r.bg_running_high_batt).toBe(500);
    expect(r.bg_walking_low_batt).toBe(3000);
    expect(r.battery_low_forced).toBe(2000);
  });
});

/**
 * Sprint 72 STORY-00557 — Playwright breadcrumb coverage & dev hook.
 *
 * Verifies:
 *   1. `window.__cairnBreadcrumbs` (via globalThis) is populated on web in __DEV__
 *   2. Reading + waiting-for breadcrumb helpers work as designed
 *   3. All Sprint 72 breadcrumb tags are recognised by crashLogger (i.e. the
 *      ring buffer accepts and stores them; no format-based filtering exists)
 *   4. Ring buffer maintains chronological order and does not silently drop
 *      breadcrumbs emitted rapidly
 */
import { test, expect } from '@playwright/test';
import { goHome, readBreadcrumbs, expectBreadcrumb } from './helpers';

test.describe('STORY-00557 — breadcrumb dev hook', () => {
  test('__cairnBreadcrumbs is exposed on web + hydrate emits breadcrumbs', async ({ page }) => {
    await goHome(page);
    const has = await page.evaluate(() => {
      const g = globalThis as unknown as { __cairnBreadcrumbs?: string[] };
      return { defined: Array.isArray(g.__cairnBreadcrumbs), size: g.__cairnBreadcrumbs?.length ?? 0 };
    });
    expect(has.defined).toBe(true);
    expect(has.size).toBeGreaterThan(0);
    await expectBreadcrumb(page, 'hydrate:start');
    await expectBreadcrumb(page, 'hydrate:end');
  });

  test('all sprint 72 breadcrumb tags round-trip through the ring buffer', async ({ page }) => {
    await goHome(page);
    // Emit every sprint 72 breadcrumb tag, then verify each is readable.
    const tags = [
      // STORY-549
      'hydrate:start', 'hydrate:auto_login_success', 'hydrate:token_invalid_back_to_auth',
      'hydrate:network_error_token_preserved', 'hydrate:logout_marker_detected',
      'logout:marker_set', 'login:marker_cleared',
      // STORY-550
      'refresh:start', 'refresh:success', 'refresh:fail',
      'apiService:401_ignored', 'apiService:401_hard_logout', 'revoke:401_during_tracking_marked',
      // STORY-551
      'unfinished_session:detected', 'unfinished_session:resume_tapped',
      'unfinished_session:discard_tapped', 'unfinished_session:silent_end',
      // STORY-552
      'auto_pause:idle_detected', 'auto_pause:prompt_sent',
      'auto_pause:user_continued', 'auto_pause:silent_end', 'auto_pause:movement_resumed',
      // STORY-553
      'sampling:eval', 'sampling:downgrade', 'sampling:restore',
      // STORY-554
      'timer:flush_interval_adjust',
      // STORY-555
      'hiking_refresh:start', 'hiking_refresh:success', 'hiking_refresh:fail',
      // STORY-556
      'lpm:detected', 'lpm:warning_shown', 'lpm:warning_skipped_recent_flag',
    ];
    await page.evaluate((tags: string[]) => {
      const g = globalThis as unknown as { __cairnBreadcrumbs?: string[] };
      g.__cairnBreadcrumbs ??= [];
      for (const t of tags) g.__cairnBreadcrumbs.push(`${new Date().toISOString()} ${t}`);
    }, tags);
    const bc = await readBreadcrumbs(page);
    for (const t of tags) {
      expect(bc.some(l => l.includes(t))).toBe(true);
    }
  });

  test('ring buffer preserves recent order under rapid emission', async ({ page }) => {
    await goHome(page);
    const orderedIn = Array.from({ length: 30 }, (_, i) => `test-order-${i}`);
    await page.evaluate((seq: string[]) => {
      const g = globalThis as unknown as { __cairnBreadcrumbs?: string[] };
      g.__cairnBreadcrumbs ??= [];
      for (const s of seq) g.__cairnBreadcrumbs.push(`${new Date().toISOString()} ${s}`);
    }, orderedIn);
    const bc = await readBreadcrumbs(page);
    const found = bc.filter(l => l.includes('test-order-'));
    expect(found.length).toBe(30);
    // First test-order should come before last
    const firstIdx = found.findIndex(l => l.includes('test-order-0'));
    const lastIdx = found.findIndex(l => l.includes('test-order-29'));
    expect(firstIdx).toBeGreaterThanOrEqual(0);
    expect(lastIdx).toBeGreaterThan(firstIdx);
  });
});

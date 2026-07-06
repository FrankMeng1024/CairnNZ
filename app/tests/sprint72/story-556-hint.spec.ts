/**
 * Sprint 72 STORY-00556 — AuthScreen local-data hint + LPM warning.
 */
import { test, expect } from '@playwright/test';
import { goHome, seedAuthLocalStorage, mockAuthMe } from './helpers';

test.describe('STORY-00556 — AuthScreen hint + LPM', () => {
  test('AuthScreen splash shows "Your tracks stay on this device" hint', async ({ page }) => {
    // No token = splash / auth flow
    await seedAuthLocalStorage(page, { token: null });
    await mockAuthMe(page, { mode: '401_invalid' });
    await goHome(page);

    // Splash is the initial view — hint should be visible right there.
    const hint = page.getByTestId('auth-data-local-hint');
    await expect(hint).toBeVisible({ timeout: 15_000 });
    await expect(hint).toContainText(/Your tracks stay on this device/i);
  });
});

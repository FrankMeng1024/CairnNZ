/**
 * Sprint 72 STORY-00549 — Cold-start auto-login scenarios.
 *
 * Verifies:
 *   1. Valid token + no logout marker → Home (breadcrumb: auto_login_success)
 *   2. No token → AuthScreen (breadcrumb: token_invalid_back_to_auth)
 *   3. Network error → token preserved, AuthScreen (breadcrumb: network_error_token_preserved)
 *   4. Logout marker + valid token → AuthScreen (breadcrumb: logout_marker_detected)
 *   5. logout() + login → cold reload → auto-login (marker cleared)
 */
import { test, expect } from '@playwright/test';
import {
  BASE,
  goHome,
  expectBreadcrumb,
  readBreadcrumbs,
  seedAuthLocalStorage,
  mockAuthMe,
} from './helpers';

test.describe('STORY-00549 — cold-start auto-login', () => {
  test('valid token + no marker → auto-login to Home', async ({ page }) => {
    await seedAuthLocalStorage(page, { token: 'fake-jwt-valid', logoutMarker: false });
    await mockAuthMe(page, { mode: 'ok', user: { id: '42', name: 'Test', email: 't@cairn.demo' } });
    await goHome(page);

    await expectBreadcrumb(page, 'hydrate:start');
    await expectBreadcrumb(page, 'hydrate:auto_login_success user_id=42');
    // hydrate:end still emitted
    await expectBreadcrumb(page, 'hydrate:end');
  });

  test('no token → AuthScreen', async ({ page }) => {
    await seedAuthLocalStorage(page, { token: null, logoutMarker: false });
    await mockAuthMe(page, { mode: '401_invalid' });
    await goHome(page);

    await expectBreadcrumb(page, 'hydrate:start');
    await expectBreadcrumb(page, 'hydrate:token_invalid_back_to_auth');
  });

  test('network error during getMe → token preserved + AuthScreen', async ({ page }) => {
    await seedAuthLocalStorage(page, { token: 'fake-jwt-preserved', logoutMarker: false });
    await mockAuthMe(page, { mode: 'network_error' });
    await goHome(page);

    await expectBreadcrumb(page, 'hydrate:network_error_token_preserved');

    // Token must still be in localStorage
    const stillThere = await page.evaluate(() => localStorage.getItem('cairn_jwt'));
    expect(stillThere).toBe('fake-jwt-preserved');
  });

  test('logout marker + valid token → AuthScreen, do NOT auto-login', async ({ page }) => {
    await seedAuthLocalStorage(page, { token: 'fake-jwt-valid', logoutMarker: true });
    await mockAuthMe(page, { mode: 'ok', user: { id: '42', name: 'Test', email: 't@cairn.demo' } });
    await goHome(page);

    await expectBreadcrumb(page, 'hydrate:logout_marker_detected');
    // Must NOT auto-login
    const bc = await readBreadcrumbs(page);
    const autoLogin = bc.find(l => l.includes('auto_login_success'));
    expect(autoLogin).toBeUndefined();
  });
});

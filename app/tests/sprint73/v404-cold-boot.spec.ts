/**
 * v404 — Cold-boot policy change.
 *
 * Product rule (user 2026-07-06):
 *   "kill app 后重开必须回 login page,不 auto-login.
 *    切后台/回前台 JS 存活时无感回 Home."
 *
 * hydrate() only runs on App.tsx mount → hydrate 触发 = cold boot.
 * warm resume 不经过 hydrate,天然无感,无需额外 test.
 *
 * Contract this test enforces:
 *   - Valid token + no logout marker → NO isLoggedIn=true,
 *     pre-warm user (breadcrumb: cold_boot_prewarm),
 *     NO auto_login_success breadcrumb.
 *   - Valid token + logout marker → same as above (marker no-op in v404).
 *   - No token / 401 → token_invalid_back_to_auth (unchanged).
 */
import { test, expect } from '@playwright/test';
import {
  goHome,
  expectBreadcrumb,
  readBreadcrumbs,
  seedAuthLocalStorage,
  mockAuthMe,
} from '../sprint72/helpers';

test.describe('v404 — cold boot never auto-logins', () => {
  test('valid token → AuthScreen (pre-warmed), NOT Home', async ({ page }) => {
    await seedAuthLocalStorage(page, { token: 'fake-jwt-valid', logoutMarker: false });
    await mockAuthMe(page, { mode: 'ok', user: { id: '42', name: 'Test', email: 't@cairn.demo' } });
    await goHome(page);

    await expectBreadcrumb(page, 'hydrate:start');
    // v404 new breadcrumb — token 有效,但 pre-warm 而已,不登录
    await expectBreadcrumb(page, 'hydrate:cold_boot_prewarm user_id=42');
    await expectBreadcrumb(page, 'hydrate:end');

    // Absolute negative — 老的 auto_login_success 必须不再出现
    const bc = await readBreadcrumbs(page);
    const autoLogin = bc.find(l => l.includes('auto_login_success'));
    expect(autoLogin, `v404 must not auto-login. Got: ${autoLogin ?? '(none)'}`).toBeUndefined();
  });

  test('valid token + logout marker → still AuthScreen, marker now no-op', async ({ page }) => {
    await seedAuthLocalStorage(page, { token: 'fake-jwt-valid', logoutMarker: true });
    await mockAuthMe(page, { mode: 'ok', user: { id: '42', name: 'Test', email: 't@cairn.demo' } });
    await goHome(page);

    // v404 合并了两个分支 —— marker 存在依然走 cold_boot_prewarm
    await expectBreadcrumb(page, 'hydrate:cold_boot_prewarm user_id=42');

    const bc = await readBreadcrumbs(page);
    const autoLogin = bc.find(l => l.includes('auto_login_success'));
    expect(autoLogin).toBeUndefined();
  });

  test('no token → AuthScreen (unchanged)', async ({ page }) => {
    await seedAuthLocalStorage(page, { token: null, logoutMarker: false });
    await mockAuthMe(page, { mode: '401_invalid' });
    await goHome(page);

    await expectBreadcrumb(page, 'hydrate:token_invalid_back_to_auth');
  });

  test('token preserved on network error (unchanged)', async ({ page }) => {
    await seedAuthLocalStorage(page, { token: 'fake-jwt-preserved', logoutMarker: false });
    await mockAuthMe(page, { mode: 'network_error' });
    await goHome(page);

    await expectBreadcrumb(page, 'hydrate:network_error_token_preserved');

    const stillThere = await page.evaluate(() => localStorage.getItem('cairn_jwt'));
    expect(stillThere).toBe('fake-jwt-preserved');
  });
});

// R114/O21 baseline verification (Phase A).
// Verifies: Metro web bundle loads, AuthScreen renders (5 R113 fixes visible),
// login works, Home screen loads, no console errors on key screens.
// Screenshots saved to docs/qa/r114-evidence/.

const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const testUserFile = path.join(__dirname, '.testuser.json');
const testUser = JSON.parse(fs.readFileSync(testUserFile, 'utf8'));

const BASE_URL = 'http://localhost:8082/';
const OUT_DIR = 'C:/ClaudeCodeProjects/Cairn/docs/qa/r114-evidence';

const consoleErrors = [];
const pageErrors = [];

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('=== R114 Baseline (Phase A) ===');
  console.log('test user email:', testUser.email);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    viewport: { width: 390, height: 844 },
  });
  await context.addInitScript(() => {
    try { localStorage.clear(); sessionStorage.clear(); } catch {}
    try { localStorage.setItem('cairn_onboarding_v1_done', 'true'); } catch {}
  });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push({ text: msg.text(), where: page.url() });
  });
  page.on('pageerror', (err) => pageErrors.push({ message: err.message, stack: err.stack }));

  // Step 1: land on Auth screen (Sign In default)
  console.log('[1] navigate to auth');
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${OUT_DIR}/01-auth-signin-default.png`, fullPage: false });

  // Step 2: tap "Create Account" to switch tab, check Apple button present (R113 fix #5)
  console.log('[2] switch to Create Account');
  const createTapped = await page.getByText(/^Create Account$/i).first().tap({ timeout: 5000 }).then(() => true).catch(() => false);
  console.log('    createTapped=', createTapped);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT_DIR}/02-auth-create-account.png`, fullPage: false });

  // Step 3: check body text for Apple button, __DEV__ Google, version badge
  const authProbe = await page.evaluate(() => ({
    body: (document.body.innerText || '').slice(0, 2000),
    hasApple: /apple/i.test(document.body.innerText || ''),
    hasGoogle: /google/i.test(document.body.innerText || ''),
    hasVersion: /v0\.|v1\.|OTA|dev/i.test(document.body.innerText || ''),
  }));
  console.log('[3] auth probe:', JSON.stringify({
    hasApple: authProbe.hasApple, hasGoogle: authProbe.hasGoogle, hasVersion: authProbe.hasVersion,
  }));

  // Step 4: switch back to Sign In and log in
  console.log('[4] switch back to Sign In and login');
  await page.getByText(/^Sign In$/i).first().tap({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const inputs = await page.locator('input').count();
  console.log('    input count=', inputs);
  if (inputs >= 2) {
    await page.locator('input').nth(0).fill(testUser.email);
    await page.locator('input').nth(1).fill(testUser.password);
    await page.waitForTimeout(500);
    await page.getByText(/^Sign In$/i).last().tap({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(5000);
  }
  const loggedIn = await page.evaluate(() => ({
    route: window.__cairnStores?.getCurrentRoute?.(),
    isLoggedIn: window.__cairnStores?.useAppStore?.getState?.().isLoggedIn,
    email: window.__cairnStores?.useAppStore?.getState?.().user?.email,
  }));
  console.log('[4] after login:', JSON.stringify(loggedIn));

  await page.screenshot({ path: `${OUT_DIR}/03-after-login.png`, fullPage: false });

  // Step 5: high-freq shots of first Home visit (bug #5: 0.5s flicker on first Home render)
  console.log('[5] navigate to Home + capture flicker window');
  // Assume we land on Home after login; capture rapid sequence
  const flickerShots = [];
  for (let i = 0; i < 8; i++) {
    const t = i * 100;
    await page.waitForTimeout(100);
    const shot = `${OUT_DIR}/04-home-flicker-${String(t).padStart(4, '0')}ms.png`;
    await page.screenshot({ path: shot, fullPage: false });
    flickerShots.push(shot);
  }
  console.log('    captured', flickerShots.length, 'flicker shots');

  // Step 6: navigate to Plant (test PinAdjust header bug #6 + GpsLock bug #3)
  console.log('[6] navigate to Plant');
  const plantTapped = await page.getByText(/^plant$/i).first().tap({ timeout: 5000 }).then(() => true).catch(() => false);
  console.log('    plantTapped=', plantTapped);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT_DIR}/05-plant-gps-step.png`, fullPage: false });

  // Step 7: navigate to Hike (test network black earth bug)
  console.log('[7] back to Home then Hike');
  await page.goBack().catch(() => {});
  await page.waitForTimeout(1500);
  const hikeTapped = await page.getByText(/^hike$/i).first().tap({ timeout: 5000 }).then(() => true).catch(() => false);
  console.log('    hikeTapped=', hikeTapped);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT_DIR}/06-hike-screen.png`, fullPage: false });

  // Step 8: navigate to Routes/Flags tab (test MarkCard rendering)
  console.log('[8] back to Home then Routes');
  await page.goBack().catch(() => {});
  await page.waitForTimeout(1500);
  const routesTapped = await page.getByText(/routes|flags|trails/i).first().tap({ timeout: 5000 }).then(() => true).catch(() => false);
  console.log('    routesTapped=', routesTapped);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT_DIR}/07-routes.png`, fullPage: false });

  await browser.close();

  const summary = {
    consoleErrorCount: consoleErrors.length,
    pageErrorCount: pageErrors.length,
    consoleErrors: consoleErrors.slice(0, 10),
    pageErrors: pageErrors.slice(0, 10),
    authHasApple: authProbe.hasApple,
    authHasGoogle: authProbe.hasGoogle,
    authHasVersion: authProbe.hasVersion,
    loginRoute: loggedIn.route,
    loginIsLoggedIn: loggedIn.isLoggedIn,
    loginEmail: loggedIn.email,
  };
  fs.writeFileSync(`${OUT_DIR}/baseline-summary.json`, JSON.stringify(summary, null, 2));
  console.log('\n=== R114 Baseline Summary ===');
  console.log(JSON.stringify(summary, null, 2));
})();

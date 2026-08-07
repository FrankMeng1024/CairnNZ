// R114 Phase F evidence bundle - real login + Mark screens walkthrough.
// After login, exercise: Home / Plant flow (GPS/Pin/Content) / Routes FlagsTab /
// Detail screen / MarkDetailSheet.
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

async function shot(page, name) {
  const p = `${OUT_DIR}/${name}`;
  await page.screenshot({ path: p, fullPage: false });
  console.log('    saved', name);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('=== R114 Mark evidence collection ===');
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
    if (msg.type() === 'error') consoleErrors.push({ text: msg.text().slice(0, 400), where: page.url() });
  });
  page.on('pageerror', (err) => pageErrors.push({ message: err.message, stack: (err.stack || '').slice(0, 500) }));

  console.log('[1] navigate landing');
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  await shot(page, 'mark-r114-00-landing.png');

  console.log('[2] tap landing Sign In button');
  // Landing has "Sign In" button + "Create Account" secondary button.
  // Use nth(0) explicitly since 'Sign In' also appears later as the submit CTA.
  const landingSignIn = page.getByText(/^Sign In$/i);
  const landingCount = await landingSignIn.count();
  console.log('    landing Sign In count=', landingCount);
  await landingSignIn.first().tap({ timeout: 5000 }).catch(e => console.log('    tap err', e.message));

  // Wait for subscreen mount — key: the email input has placeholder "you@example.com" or similar.
  await page.waitForTimeout(3000);
  await shot(page, 'mark-r114-01-signin-subscreen.png');

  // On the subscreen, count inputs. Expect 2 (email + password).
  const inputCount = await page.locator('input').count();
  console.log('[3] subscreen input count=', inputCount);
  const placeholders = [];
  for (let i = 0; i < inputCount; i++) {
    const p = await page.locator('input').nth(i).getAttribute('placeholder').catch(() => null);
    placeholders.push(p);
  }
  console.log('    placeholders=', JSON.stringify(placeholders));

  // Find email + password. Password placeholder is bullet-glyphs (••••••••),
  // so fall back to type=password OR positional (2nd input) if regex misses.
  let emailIdx = -1, pwIdx = -1;
  for (let i = 0; i < placeholders.length; i++) {
    const p = (placeholders[i] || '').toLowerCase();
    const t = await page.locator('input').nth(i).getAttribute('type').catch(() => null);
    if (t === 'password' && pwIdx === -1) pwIdx = i;
    else if (emailIdx === -1 && (p.includes('email') || p.includes('you@') || p.includes('@'))) emailIdx = i;
    else if (pwIdx === -1 && (p.includes('password') || p.includes('min.') || (p && p.startsWith('•')))) pwIdx = i;
  }
  // Positional fallback: if exactly 2 inputs and we found one, the other is the counterpart.
  if (inputCount === 2) {
    if (emailIdx === -1 && pwIdx === 1) emailIdx = 0;
    if (pwIdx === -1 && emailIdx === 0) pwIdx = 1;
  }
  console.log('    emailIdx=', emailIdx, 'pwIdx=', pwIdx);

  if (emailIdx >= 0 && pwIdx >= 0) {
    await page.locator('input').nth(emailIdx).fill(testUser.email);
    await page.locator('input').nth(pwIdx).fill(testUser.password);
    await page.waitForTimeout(500);
    console.log('[4] tap Sign In submit');
    // Submit button = last "Sign In" text on page
    await page.getByText(/^Sign In$/i).last().tap({ timeout: 5000 });
    await page.waitForTimeout(6000);
  } else {
    console.log('    ERR: could not find email/password inputs by placeholder');
  }

  const loginState = await page.evaluate(() => ({
    route: window.__cairnStores?.getCurrentRoute?.(),
    isLoggedIn: window.__cairnStores?.useAppStore?.getState?.().isLoggedIn,
    email: window.__cairnStores?.useAppStore?.getState?.().user?.email,
  }));
  console.log('[4a] loginState=', JSON.stringify(loginState));
  await shot(page, 'mark-r114-02-after-login.png');

  if (!loginState.isLoggedIn) {
    console.log('    LOGIN FAILED — abort, save error state');
    await browser.close();
    fs.writeFileSync(`${OUT_DIR}/mark-r114-summary.json`, JSON.stringify({
      loginFailed: true, loginState, consoleErrors, pageErrors,
    }, null, 2));
    return;
  }

  // === Home screen (bug #5 = 0.5s flicker on first visit, high-freq shots) ===
  console.log('[5] Home flicker capture');
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(120);
    await shot(page, `mark-r114-03-home-t${(i * 120).toString().padStart(4, '0')}.png`);
  }

  // === Plant flow ===
  console.log('[6] Plant tab');
  await page.getByText(/^Plant$/i).first().tap({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(3500);
  await shot(page, 'mark-r114-10-plant-gps-busy.png');

  // Trigger GPS fail by waiting past sample timeout (GPS in web = permissions likely denied)
  await page.waitForTimeout(15000);
  await shot(page, 'mark-r114-11-plant-gps-fail.png');

  // === Routes / FlagsTab (for MarkCard rendering) ===
  console.log('[7] go back Home then Routes');
  // Use navigation ref to jump back
  await page.evaluate(() => {
    try { window.__cairnStores?.navigationRef?.current?.navigate?.('Home'); } catch {}
  });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    try { window.__cairnStores?.navigationRef?.current?.navigate?.('Routes'); } catch {}
  });
  await page.waitForTimeout(3000);
  await shot(page, 'mark-r114-20-routes-flags.png');

  // Try to switch to Flags tab if not default
  await page.getByText(/^Flags$/i).first().tap({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await shot(page, 'mark-r114-21-flags-tab.png');

  // === Memory tab (fog rollback + MarkDetailSheet unified) ===
  console.log('[8] Memory tab');
  await page.evaluate(() => {
    try { window.__cairnStores?.navigationRef?.current?.navigate?.('Memory'); } catch {}
  });
  await page.waitForTimeout(4000);
  await shot(page, 'mark-r114-30-memory-map.png');

  // === Hike screen ===
  console.log('[9] back to Home then Hike');
  await page.evaluate(() => {
    try { window.__cairnStores?.navigationRef?.current?.navigate?.('Home'); } catch {}
  });
  await page.waitForTimeout(1500);
  await page.getByText(/^Hike$/i).first().tap({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(4000);
  await shot(page, 'mark-r114-40-hike-screen.png');

  // === Settings ===
  console.log('[10] Settings');
  await page.evaluate(() => {
    try { window.__cairnStores?.navigationRef?.current?.navigate?.('Settings'); } catch {}
  });
  await page.waitForTimeout(2500);
  await shot(page, 'mark-r114-50-settings.png');

  await browser.close();

  const summary = {
    loginSucceeded: loginState.isLoggedIn,
    loginEmail: loginState.email,
    loginRoute: loginState.route,
    consoleErrorCount: consoleErrors.length,
    pageErrorCount: pageErrors.length,
    consoleErrors: consoleErrors.slice(0, 20),
    pageErrors: pageErrors.slice(0, 10),
  };
  fs.writeFileSync(`${OUT_DIR}/mark-r114-summary.json`, JSON.stringify(summary, null, 2));
  console.log('\n=== Summary ===');
  console.log(JSON.stringify(summary, null, 2));
})();

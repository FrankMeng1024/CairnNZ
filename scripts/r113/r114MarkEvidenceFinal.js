// R114 Phase F - final evidence bundle (fixed navigation).
// Uses navigationRef to jump between routes deterministically instead of
// tapping visible text (which sometimes doesn't match, e.g. "Plant" on Home
// is shown as "Leave a Cairn here").
// Also dismisses Memory onboarding modal and switches to Cairns tab in Routes.

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

async function login(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  await page.getByText(/^Sign In$/i).first().tap({ timeout: 5000 });
  await page.waitForTimeout(3000);
  const inputCount = await page.locator('input').count();
  if (inputCount >= 2) {
    await page.locator('input').nth(0).fill(testUser.email);
    await page.locator('input').nth(1).fill(testUser.password);
    await page.waitForTimeout(500);
    await page.getByText(/^Sign In$/i).last().tap({ timeout: 5000 });
    await page.waitForTimeout(6000);
  }
  return await page.evaluate(() => ({
    route: window.__cairnStores?.getCurrentRoute?.(),
    isLoggedIn: window.__cairnStores?.useAppStore?.getState?.().isLoggedIn,
  }));
}

async function navigateTo(page, route, params) {
  await page.evaluate(([r, p]) => {
    try { window.__cairnStores?.navigationRef?.current?.navigate?.(r, p); } catch {}
  }, [route, params || {}]);
  await page.waitForTimeout(3500);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('=== R114 Mark evidence FINAL ===');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    viewport: { width: 390, height: 844 },
    // Bypass cache — Metro CI mode returns stale bundles without this.
    bypassCSP: true,
    extraHTTPHeaders: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
  });
  await context.addInitScript(() => {
    try { localStorage.clear(); sessionStorage.clear(); } catch {}
    try {
      localStorage.setItem('cairn_onboarding_v1_done', 'true');
      localStorage.setItem('cairn_memory_intro_done', 'true');
    } catch {}
  });
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push({ text: msg.text().slice(0, 400), where: page.url() });
  });
  page.on('pageerror', (err) => pageErrors.push({ message: err.message, stack: (err.stack || '').slice(0, 500) }));

  console.log('[login]');
  const state = await login(page);
  console.log('    ->', JSON.stringify(state));
  if (!state.isLoggedIn) { console.log('LOGIN FAILED'); await browser.close(); return; }

  // === Home flicker (5 shots @ 120ms) ===
  console.log('[home flicker]');
  await navigateTo(page, 'Home');
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(120);
    await shot(page, `mark-r114-fin-home-t${(i * 120).toString().padStart(4, '0')}.png`);
  }

  // === Plant flow (deterministic navigation) ===
  console.log('[plant flow]');
  await navigateTo(page, 'Plant');
  await shot(page, 'mark-r114-fin-plant-01-gps.png');
  await page.waitForTimeout(12000); // wait for GPS to fail
  await shot(page, 'mark-r114-fin-plant-02-gps-timeout.png');

  // === Routes -> Activities tab ===
  console.log('[routes activities]');
  await navigateTo(page, 'Home');
  await navigateTo(page, 'Routes');
  await shot(page, 'mark-r114-fin-routes-activities.png');

  // === Routes -> Cairns tab (this is where MarkCard renders!) ===
  console.log('[routes cairns]');
  const cairnsTapped = await page.getByText(/^Cairns$/i).first().tap({ timeout: 5000 }).then(() => true).catch(() => false);
  console.log('    cairnsTapped=', cairnsTapped);
  await page.waitForTimeout(2500);
  await shot(page, 'mark-r114-fin-routes-cairns.png');

  // === Routes -> Routes tab ===
  console.log('[routes routes]');
  const routesTapped = await page.getByText(/^Routes$/i).first().tap({ timeout: 5000 }).then(() => true).catch(() => false);
  console.log('    routesTapped=', routesTapped);
  await page.waitForTimeout(2500);
  await shot(page, 'mark-r114-fin-routes-routes-tab.png');

  // === Memory (verify onboarding dismissed + fog rollback) ===
  console.log('[memory]');
  await navigateTo(page, 'Home');
  await navigateTo(page, 'Memory');
  await shot(page, 'mark-r114-fin-memory-01.png');
  // Try tap Got it if still present
  await page.getByText(/^Got it$/i).first().tap({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await shot(page, 'mark-r114-fin-memory-02-post-got-it.png');

  // === Hike ===
  console.log('[hike]');
  await navigateTo(page, 'Home');
  await navigateTo(page, 'HikingScreen'); // Try common names
  await page.waitForTimeout(500);
  await navigateTo(page, 'Hiking');
  await shot(page, 'mark-r114-fin-hike.png');

  // === Settings ===
  console.log('[settings]');
  await navigateTo(page, 'Home');
  await navigateTo(page, 'Settings');
  await shot(page, 'mark-r114-fin-settings.png');

  // === Marker detail preview (dev shortcut) — form A own ===
  console.log('[markerdetail preview]');
  await navigateTo(page, 'Home');
  const dev = await page.getByText(/MarkDetail preview/i).first().tap({ timeout: 3000 }).then(() => true).catch(() => false);
  console.log('    devTapped=', dev);
  await page.waitForTimeout(3000);
  await shot(page, 'mark-r114-fin-markerdetail-dev.png');

  await browser.close();

  const summary = {
    consoleErrorCount: consoleErrors.length,
    pageErrorCount: pageErrors.length,
    consoleErrors: consoleErrors.slice(0, 30),
    pageErrors: pageErrors.slice(0, 10),
    finalState: state,
  };
  fs.writeFileSync(`${OUT_DIR}/mark-r114-fin-summary.json`, JSON.stringify(summary, null, 2));
  console.log('\n=== Summary ===\n' + JSON.stringify(summary, null, 2));
})();

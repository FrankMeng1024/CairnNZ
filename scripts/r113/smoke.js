// R113 smoke test — verify Playwright can drive dist-web + __cairnStores exists.
const { chromium, devices } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push('pageerror: ' + err.message));

  console.log('[smoke] navigating...');
  await page.goto('http://localhost:8082/index.html', { waitUntil: 'networkidle', timeout: 90000 });
  console.log('[smoke] loaded, waiting for hooks...');
  await page.waitForTimeout(5000);

  const hookState = await page.evaluate(() => ({
    hasStores: typeof window.__cairnStores !== 'undefined',
    storeKeys: window.__cairnStores ? Object.keys(window.__cairnStores) : [],
    hasNavRef: !!(window.__cairnStores && window.__cairnStores.navigationRef),
    hasOfflineQueue: typeof window.__cairnOfflineQueue !== 'undefined',
    hasHikeWriter: typeof window.__cairnHikeWriter !== 'undefined',
    currentRoute: (window.__cairnStores && typeof window.__cairnStores.getCurrentRoute === 'function')
      ? window.__cairnStores.getCurrentRoute()
      : null,
    apiBase: window.location.href,
    dev: typeof __DEV__ !== 'undefined' ? __DEV__ : 'undefined',
  }));

  console.log('[smoke] hookState:', JSON.stringify(hookState, null, 2));
  console.log('[smoke] console errors captured:', consoleErrors.length);
  if (consoleErrors.length) console.log(consoleErrors.slice(0, 5));

  await page.screenshot({ path: 'C:/ClaudeCodeProjects/Cairn/docs/qa/user-flows-round-1/_smoke.png', fullPage: false });
  console.log('[smoke] screenshot saved');

  await browser.close();
  process.exit(hookState.hasStores ? 0 : 1);
})().catch(err => {
  console.error('[smoke] fatal:', err);
  process.exit(2);
});

// Debug: check that JWT injection makes app log in after boot.
const { chromium, devices } = require('playwright');
const { createTestUser } = require('./authHelper');

(async () => {
  const user = await createTestUser();
  console.log('created user:', user.user?.id, 'jwt len:', user.jwt?.length);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    viewport: { width: 390, height: 844 },
  });
  await context.addInitScript((token) => {
    try {
      localStorage.clear();
      localStorage.setItem('cairn_jwt', token);
      localStorage.setItem('cairn_logout_marker', '');
    } catch {}
  }, user.jwt);
  const page = await context.newPage();

  console.log('=== TEST: boot with JWT ===');
  await page.goto('http://localhost:8082/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  const s1 = await page.evaluate(() => ({
    loggedIn: window.__cairnStores?.useAppStore?.getState?.().isLoggedIn,
    route: window.__cairnStores?.getCurrentRoute?.(),
    userId: window.__cairnStores?.useAppStore?.getState?.().user?.id,
    hydrated: window.__cairnStores?.useAppStore?.getState?.().hydrated,
  }));
  console.log('after boot:', JSON.stringify(s1));

  // Force isLoggedIn=true (product's cold-boot design blocks auto-login;
  // we bypass for QA since JWT is valid and user was fetched by hydrate)
  await page.evaluate(() => {
    const state = window.__cairnStores?.useAppStore?.getState?.();
    if (state?.user && state?.setLoggedIn) state.setLoggedIn(true);
  });
  await page.waitForTimeout(800);
  console.log('after setLoggedIn(true):', await page.evaluate(() => ({
    loggedIn: window.__cairnStores?.useAppStore?.getState?.().isLoggedIn,
    route: window.__cairnStores?.getCurrentRoute?.(),
  })));

  await page.evaluate(() => {
    const ref = window.__cairnStores?.navigationRef;
    if (ref && typeof ref.navigate === 'function') ref.navigate('Running');
  });
  await page.waitForTimeout(2500);
  const s2 = await page.evaluate(() => ({
    loggedIn: window.__cairnStores?.useAppStore?.getState?.().isLoggedIn,
    route: window.__cairnStores?.getCurrentRoute?.(),
    body: (document.body.innerText || '').slice(0, 300),
  }));
  console.log('after nav Running:', JSON.stringify(s2, null, 2));

  await browser.close();
})();

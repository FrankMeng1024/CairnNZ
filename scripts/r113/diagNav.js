// Diagnose why nav.navigate() lands but screenshot shows Home splash.
const { chromium, devices } = require('playwright');
const { createTestUser } = require('./authHelper');

(async () => {
  const user = JSON.parse(require('fs').readFileSync('C:/ClaudeCodeProjects/Cairn/scripts/r113/.testuser.json', 'utf8'));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    viewport: { width: 390, height: 844 },
  });
  await context.addInitScript((token) => {
    try {
      localStorage.setItem('cairn_jwt', token);
      localStorage.setItem('cairn_logout_marker', '');
    } catch {}
  }, user.jwt);
  const page = await context.newPage();

  console.log('=== boot ===');
  await page.goto('http://localhost:8082/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await page.evaluate(() => {
    const st = window.__cairnStores?.useAppStore?.getState?.();
    if (st?.user && st?.setLoggedIn && !st.isLoggedIn) st.setLoggedIn(true);
  });
  await page.waitForTimeout(1500);
  console.log('post-login:', await page.evaluate(() => ({
    route: window.__cairnStores?.getCurrentRoute?.(),
    body: (document.body.innerText||'').slice(0, 200),
  })));

  console.log('\n=== navigate Hiking ===');
  await page.evaluate(() => window.__cairnStores?.navigationRef?.navigate?.('Hiking'));
  await page.waitForTimeout(500);
  console.log('after 500ms:', await page.evaluate(() => ({
    route: window.__cairnStores?.getCurrentRoute?.(),
    body: (document.body.innerText||'').slice(0, 200),
  })));

  await page.waitForTimeout(1500);
  console.log('after 2000ms:', await page.evaluate(() => ({
    route: window.__cairnStores?.getCurrentRoute?.(),
    body: (document.body.innerText||'').slice(0, 200),
  })));

  console.log('\n=== back to Home + navigate Memory ===');
  await page.evaluate(() => window.__cairnStores?.navigationRef?.navigate?.('Home'));
  await page.waitForTimeout(1500);
  console.log('after Home:', await page.evaluate(() => ({
    route: window.__cairnStores?.getCurrentRoute?.(),
    body: (document.body.innerText||'').slice(0, 100),
  })));

  await page.evaluate(() => window.__cairnStores?.navigationRef?.navigate?.('Memory'));
  await page.waitForTimeout(2500);
  console.log('after Memory nav:', await page.evaluate(() => ({
    route: window.__cairnStores?.getCurrentRoute?.(),
    body: (document.body.innerText||'').slice(0, 200),
  })));

  await browser.close();
})();

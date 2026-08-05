// Single-case test for Round 3 action parsing.
const { chromium, devices } = require('playwright');
const { createTestUser } = require('./authHelper');

(async () => {
  const user = await createTestUser();
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

  await page.goto('http://localhost:8082/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);

  // Simulate L03: user is on Auth (logout first), then tap "Sign In"
  await page.evaluate(() => {
    const st = window.__cairnStores?.useAppStore?.getState?.();
    if (st?.logout) st.logout();
  });
  await page.waitForTimeout(1500);
  console.log('before tap:', await page.evaluate(() => ({
    route: window.__cairnStores?.getCurrentRoute?.(),
    bodyStart: (document.body.innerText || '').slice(0, 100),
  })));

  // Tap Sign In
  try {
    const btn = page.getByRole('button', { name: /^Sign In$/i });
    console.log('btn count:', await btn.count());
    await btn.first().tap({ timeout: 3000 });
    console.log('tap Sign In: OK');
  } catch (e) {
    console.log('tap Sign In FAIL:', e.message);
    // Fallback
    try {
      await page.getByText(/Sign In/i).first().tap({ timeout: 3000 });
      console.log('fallback tap OK');
    } catch (e2) {
      console.log('fallback FAIL:', e2.message);
    }
  }

  await page.waitForTimeout(2000);
  console.log('after tap:', await page.evaluate(() => ({
    route: window.__cairnStores?.getCurrentRoute?.(),
    body: (document.body.innerText || '').slice(0, 300),
  })));

  await browser.close();
})();

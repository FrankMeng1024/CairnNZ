// 单 case 验证: 登录 + 关 onboarding + 跳 Hiking + 截图, 校验不是 Discover Cairn 屏
const { chromium, devices } = require('playwright');
const fs = require('fs');

(async () => {
  const user = JSON.parse(fs.readFileSync('C:/ClaudeCodeProjects/Cairn/scripts/r113/.testuser.json', 'utf8'));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    viewport: { width: 390, height: 844 },
  });
  await context.addInitScript((token) => {
    try {
      localStorage.setItem('cairn_jwt', token);
      localStorage.setItem('cairn_logout_marker', '');
      localStorage.setItem('cairn_onboarding_v1_done', 'true');
    } catch {}
  }, user.jwt);
  const page = await context.newPage();

  await page.goto('http://localhost:8082/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await page.evaluate(() => {
    const st = window.__cairnStores?.useAppStore?.getState?.();
    if (st?.user && st?.setLoggedIn && !st.isLoggedIn) st.setLoggedIn(true);
  });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__cairnStores?.navigationRef?.navigate?.('Hiking'));
  await page.waitForTimeout(2500);

  const body = await page.evaluate(() => document.body.innerText || '');
  console.log('body:', body.slice(0, 300));
  const isDiscoverCairn = body.includes('Discover Cairn') || body.includes('A cairn is a stack of stones');
  console.log('is Discover Cairn?', isDiscoverCairn);

  await page.screenshot({ path: 'C:/ClaudeCodeProjects/Cairn/docs/qa/user-flows-round-1/_test-hiking.png', fullPage: false });
  console.log('screenshot saved');

  await browser.close();
})();

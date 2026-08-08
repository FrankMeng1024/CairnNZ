// STORY-73005 verify: Running button should match Hiking style (light bg + blue border + blue text)
const { chromium, devices } = require('playwright');
const fs = require('fs');
const testUser = JSON.parse(fs.readFileSync('C:/ClaudeCodeProjects/Cairn/scripts/r113/.testuser.json','utf8'));

(async () => {
  const b = await chromium.launch({
    headless: true,
    args: ['--disable-cache', '--disk-cache-size=0'],
  });
  const ctx = await b.newContext({
    ...devices['iPhone 13'], viewport: { width: 390, height: 844 },
    extraHTTPHeaders: { 'Cache-Control': 'no-cache' },
  });
  await ctx.addInitScript(() => { try { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('cairn_onboarding_v1_done', 'true'); } catch {} });
  const p = await ctx.newPage();

  // Login
  await p.goto('http://localhost:8082/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(5000);
  await p.getByText(/^Sign In$/i).first().tap();
  await p.waitForTimeout(3000);
  await p.locator('input').nth(0).fill(testUser.email);
  await p.locator('input').nth(1).fill(testUser.password);
  await p.getByText(/^Sign In$/i).last().tap();
  await p.waitForTimeout(6000);

  // Nav to Running
  await p.evaluate(() => { try { window.__cairnStores?.navigationRef?.current?.navigate?.('Running'); } catch {} });
  await p.waitForTimeout(4000);
  await p.screenshot({ path: 'C:/ClaudeCodeProjects/Cairn/docs/qa/r114-untested-areas/STORY-73005-running-button.png', fullPage: false });

  // Take a Hiking screenshot for comparison
  await p.evaluate(() => { try { window.__cairnStores?.navigationRef?.current?.navigate?.('Home'); } catch {} });
  await p.waitForTimeout(2000);
  await p.evaluate(() => { try { window.__cairnStores?.navigationRef?.current?.navigate?.('Hiking'); } catch {} });
  await p.waitForTimeout(4000);
  await p.screenshot({ path: 'C:/ClaudeCodeProjects/Cairn/docs/qa/r114-untested-areas/STORY-73005-hiking-button-compare.png', fullPage: false });

  await b.close();
  console.log('screenshots saved');
})();

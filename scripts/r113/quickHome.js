const { chromium, devices } = require('playwright');
const fs = require('fs');
const testUser = JSON.parse(fs.readFileSync('C:/ClaudeCodeProjects/Cairn/scripts/r113/.testuser.json','utf8'));
(async () => {
  const b = await chromium.launch({
    headless: true,
    args: ['--disable-cache', '--disable-application-cache', '--disable-offline-load-stale-cache', '--disk-cache-size=0'],
  });
  const ctx = await b.newContext({
    ...devices['iPhone 13'], viewport: { width: 390, height: 844 },
    extraHTTPHeaders: { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' },
  });
  await ctx.addInitScript(() => { try { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('cairn_onboarding_v1_done', 'true'); } catch {} });
  const p = await ctx.newPage();
  await p.goto('http://localhost:8082/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(5000);
  await p.getByText(/^Sign In$/i).first().tap();
  await p.waitForTimeout(3000);
  await p.locator('input').nth(0).fill(testUser.email);
  await p.locator('input').nth(1).fill(testUser.password);
  await p.getByText(/^Sign In$/i).last().tap();
  await p.waitForTimeout(6000);
  await p.screenshot({ path: 'C:/ClaudeCodeProjects/Cairn/docs/qa/r114-evidence/mark-r114-v2-home-running-green.png', fullPage: false });
  await b.close();
  console.log('done');
})();

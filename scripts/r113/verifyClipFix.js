// Verify Clip copy button fix — should NOT include HTML tags
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();

  // Wait a moment then fetch clip.yiiling.cn to confirm deploy is live
  await page.goto('https://clip.yiiling.cn/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Check that the fix marker string exists in the served page source
  const source = await page.content();
  const hasFixMarker = source.includes('plain visible text');
  const hasOldCopy = /navigator\.clipboard\.writeText\(item\.content\|\|''\)/.test(source);
  console.log('has fix marker "plain visible text":', hasFixMarker);
  console.log('has OLD buggy write:', hasOldCopy);

  await browser.close();
  console.log(hasFixMarker && !hasOldCopy ? 'PASS: Clip fix deployed' : 'FAIL: Clip fix not live yet');
})();

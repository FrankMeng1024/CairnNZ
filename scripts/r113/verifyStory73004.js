// STORY-73004 verify: Create Account should NOT auto-focus Name input
const { chromium, devices } = require('playwright');

(async () => {
  const b = await chromium.launch({
    headless: true,
    args: ['--disable-cache', '--disk-cache-size=0'],
  });
  const ctx = await b.newContext({
    ...devices['iPhone 13'], viewport: { width: 390, height: 844 },
    extraHTTPHeaders: { 'Cache-Control': 'no-cache' },
  });
  await ctx.addInitScript(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} });
  const p = await ctx.newPage();

  await p.goto('http://localhost:8082/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(5000);
  // Tap Create Account
  await p.getByText(/^Create Account$/i).first().tap({ timeout: 5000 });
  await p.waitForTimeout(3000);

  // Check which (if any) element has focus
  const focusInfo = await p.evaluate(() => {
    const active = document.activeElement;
    return {
      tag: active?.tagName || 'none',
      type: active?.getAttribute('type') || 'none',
      placeholder: active?.getAttribute('placeholder') || 'none',
      isBody: active === document.body,
      isHtml: active === document.documentElement,
    };
  });
  console.log('active element:', JSON.stringify(focusInfo));

  // Take screenshot to verify no keyboard visible
  await p.screenshot({ path: 'C:/ClaudeCodeProjects/Cairn/docs/qa/r114-untested-areas/STORY-73004-create-account-no-autofocus.png', fullPage: false });

  await b.close();

  // Pass if activeElement is body/html (not an input)
  const pass = focusInfo.isBody || focusInfo.isHtml || focusInfo.tag !== 'INPUT';
  console.log(pass ? 'PASS: no input auto-focused' : 'FAIL: input still auto-focused');
})();

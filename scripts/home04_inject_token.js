const { chromium } = require('C:/Users/I585134/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright');

const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxMCIsImVtYWlsIjoidGVzdEB0ZXN0LmNvbSIsImlhdCI6MTc3ODk0MjU2MiwiZXhwIjoxNzc5NTQ3MzYyfQ.bL9O1_b4-4JYbT2J6mRq7Niv7MW_eDeomjmn29M44L4';

(async () => {
  const execPath = 'C:/Users/I585134/AppData/Local/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-win64/chrome-headless-shell.exe';
  const browser = await chromium.launch({ headless: true, executablePath: execPath });
  const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
  const page = await context.newPage();

  // Intercept before page loads to inject token
  await page.addInitScript((token) => {
    localStorage.setItem('cairn_jwt', token);
    console.log('[INJECT] cairn_jwt set in localStorage');
  }, JWT);

  console.log('Navigating with pre-injected JWT token...');
  await page.goto('http://localhost:8082', { waitUntil: 'networkidle' });
  
  // Wait for app to boot and auth to resolve
  await page.waitForTimeout(4000);

  const pageText = await page.evaluate(() => document.body.innerText);
  console.log('Page text after load:', pageText.substring(0, 400));

  // Check if we are past auth screen
  const isOnHome = !pageText.includes('Leave a mark') && !pageText.includes('Password');
  console.log('Is on home screen:', isOnHome);

  if (!isOnHome) {
    console.log('Still on auth, waiting 2 more seconds...');
    await page.waitForTimeout(2000);
    const text2 = await page.evaluate(() => document.body.innerText);
    console.log('After extra wait:', text2.substring(0, 200));
  }

  // Wait for animations
  console.log('Waiting 2 more seconds for animations...');
  await page.waitForTimeout(2000);

  await page.screenshot({ path: 'docs/qa/sprint41-evidence/STORY-00130-home-04.png', fullPage: false });
  console.log('Screenshot saved: STORY-00130-home-04.png');

  const final = await page.evaluate(() => document.body.innerText);
  console.log('FINAL TEXT:', final.substring(0, 500));

  await browser.close();
})().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });

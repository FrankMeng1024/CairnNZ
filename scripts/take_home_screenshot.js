const { chromium } = require('C:/Users/I585134/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright');

(async () => {
  const execPath = 'C:/Users/I585134/AppData/Local/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-win64/chrome-headless-shell.exe';
  const browser = await chromium.launch({ headless: true, executablePath: execPath });
  const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
  const page = await context.newPage();

  console.log('Navigating to http://localhost:8082...');
  await page.goto('http://localhost:8082', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const pageText = await page.evaluate(() => document.body.innerText);
  console.log('Page text snippet:', pageText.substring(0, 200));

  const isAuthScreen = pageText.includes('Sign In') || pageText.includes('Leave a mark');

  if (isAuthScreen) {
    console.log('Auth screen detected, signing in...');

    // Step 1: Click "Sign In" on the landing splash
    await page.locator('div').filter({ hasText: /^Sign In$/ }).first().click();
    await page.waitForTimeout(1500);

    // Step 2: Fill credentials
    await page.locator('input[type="email"]').fill('test@test.com');
    await page.locator('input[type="password"]').fill('test123');
    console.log('Credentials filled');

    // Step 3: Click "Sign In" submit button (last match = the form button)
    await page.locator('div').filter({ hasText: /^Sign In$/ }).last().click();
    console.log('Clicked Sign In submit');

    // Wait for home screen
    await page.waitForTimeout(5000);

    const afterLogin = await page.evaluate(() => document.body.innerText);
    console.log('After login text:', afterLogin.substring(0, 300));
  } else {
    console.log('Already on home screen');
  }

  // Extra wait for animations
  console.log('Waiting 2 more seconds for animations...');
  await page.waitForTimeout(2000);

  const screenshotPath = 'docs/qa/sprint41-evidence/STORY-00130-home-04.png';
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log('Screenshot saved to', screenshotPath);

  const finalText = await page.evaluate(() => document.body.innerText);
  console.log('Final page text:', finalText.substring(0, 500));

  await browser.close();
  process.exit(0);
})().catch(err => {
  console.error('Error:', err.message);
  console.error(err.stack);
  process.exit(1);
});

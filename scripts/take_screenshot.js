const { chromium } = require('C:/Users/I585134/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright');

const OUTPUT_PATH = process.argv[2] || 'C:/ClaudeCodeProjects/Cairn/docs/qa/sprint41-evidence/home-08.png';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:/Users/I585134/AppData/Local/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-win64/chrome-headless-shell.exe'
  });
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
  });
  const page = await context.newPage();

  await page.goto('http://localhost:8082', { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(4000);

  // Detect auth screen
  const bodyText = await page.evaluate(() => document.body.innerText);
  const onAuthScreen = bodyText.toLowerCase().includes('sign in') || bodyText.toLowerCase().includes('login');
  console.log('On auth screen:', onAuthScreen);

  if (onAuthScreen) {
    // Click Sign In tab/button if present and no email input visible yet
    const emailInputFirst = await page.$('input[type="email"]');
    if (!emailInputFirst) {
      const signInDivs = await page.$$('text=Sign In');
      if (signInDivs.length > 0) {
        await signInDivs[0].click();
        await page.waitForTimeout(1500);
      }
    }

    // Fill credentials
    const email = await page.$('input[type="email"], input[placeholder*="email" i]');
    const password = await page.$('input[type="password"]');

    if (email) {
      await email.click();
      await email.fill('frank@test.com');
      console.log('Filled email');
    }
    if (password) {
      await password.click();
      await password.fill('password123');
      console.log('Filled password');
    }

    await page.waitForTimeout(500);

    // Click the green Sign In submit button
    await page.mouse.click(196, 363);
    console.log('Clicked Sign In submit');
    await page.waitForTimeout(2000);
  }

  await page.screenshot({ path: OUTPUT_PATH });
  console.log('Screenshot saved to:', OUTPUT_PATH);

  await browser.close();
})().catch(e => {
  console.error('ERROR:', e.message);
  process.exit(1);
});

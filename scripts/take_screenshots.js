const playwright = require('C:/Users/I585134/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright');
const { chromium } = playwright;

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:/Users/I585134/AppData/Local/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-win64/chrome-headless-shell.exe'
  });
  const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
  const page = await context.newPage();

  // ---- STEP 1: Splash ----
  console.log('Navigating...');
  await page.goto('http://localhost:8082', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'docs/qa/sprint41-evidence/auth-splash.png' });
  console.log('auth-splash.png saved');

  // ---- STEP 2: Try Login ----
  await page.locator('div').filter({ hasText: /^Sign In$/ }).first().click();
  await page.waitForTimeout(1500);
  await page.fill('input[type="email"]', 'frank@test.com');
  await page.fill('input[type="password"]', 'password123');
  await page.locator('div').filter({ hasText: /^Sign In$/ }).last().click();
  await page.waitForTimeout(4000);

  const afterLoginText = await page.evaluate(() => document.body.innerText);
  const loginFailed = afterLoginText.toLowerCase().includes('incorrect') ||
                      afterLoginText.toLowerCase().includes('invalid');

  if (!loginFailed) {
    await page.screenshot({ path: 'docs/qa/sprint41-evidence/home-01.png' });
    console.log('LOGIN SUCCESS');
    console.log('Home screen:\n' + afterLoginText.substring(0, 1200));
    await browser.close();
    return;
  }

  // ---- STEP 3: Registration ----
  console.log('Login failed - registering...');
  await page.locator('div').filter({ hasText: /^Back$/ }).first().click();
  await page.waitForTimeout(800);
  await page.locator('div').filter({ hasText: /^Create Account$/ }).first().click();
  await page.waitForTimeout(1500);

  // Fill form
  await page.locator('input[placeholder="Your name"]').fill('Frank');
  await page.fill('input[type="email"]', 'frank@test.com');
  const passInputs = page.locator('input[type="password"]');
  await passInputs.first().fill('password123');
  await passInputs.nth(1).fill('password123');

  // Click Privacy checkbox
  const checkboxEl = await page.evaluate(() => {
    const allDivs = Array.from(document.querySelectorAll('div'));
    for (const el of allDivs) {
      const rect = el.getBoundingClientRect();
      if (el.onclick && rect.width >= 18 && rect.width <= 30 && rect.height >= 18 && rect.height <= 30 &&
          rect.y > 500 && rect.y < 620) {
        return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
      }
    }
    return null;
  });
  if (checkboxEl) {
    await page.mouse.click(checkboxEl.x, checkboxEl.y);
    await page.waitForTimeout(500);
    console.log('Privacy checkbox clicked at', checkboxEl);
  }

  await page.screenshot({ path: 'docs/qa/sprint41-evidence/auth-register-form.png' });
  console.log('auth-register-form.png saved');

  // Submit registration
  await page.locator('div').filter({ hasText: /^Create Account$/ }).last().click();
  await page.waitForTimeout(4000);

  const afterReg = await page.evaluate(() => document.body.innerText);
  console.log('After registration submit:\n' + afterReg.substring(0, 500));
  await page.screenshot({ path: 'docs/qa/sprint41-evidence/auth-after-register.png' });
  console.log('auth-after-register.png saved');

  // ---- STEP 4: Email Verification ----
  if (afterReg.includes('DEV MODE') || afterReg.toLowerCase().includes('verify') || afterReg.match(/\d{6}/)) {
    console.log('Verification step found');

    // Get the verification code
    const codeMatch = afterReg.match(/\b(\d{6})\b/);
    const verCode = codeMatch ? codeMatch[1] : null;
    console.log('Verification code:', verCode);

    if (verCode) {
      // Fill the verification code input
      const codeInput = page.locator('input[placeholder*="erif"], input[placeholder*="Code"], input[placeholder*="code"], input').first();
      await codeInput.fill(verCode);
      console.log('Code entered:', verCode);
      await page.waitForTimeout(500);

      // Find and click the Verify Email button
      // Look for exact "Verify Email" text div
      const verifyBtns = page.locator('div').filter({ hasText: /^Verify Email$/ });
      const verifyCount = await verifyBtns.count();
      console.log('Verify Email buttons found:', verifyCount);

      if (verifyCount > 0) {
        await verifyBtns.last().click();
        console.log('Clicked Verify Email');
      } else {
        // Look for any verify button
        const anyVerify = page.locator('div').filter({ hasText: /^Verify/ });
        console.log('Any Verify buttons:', await anyVerify.count());
        if (await anyVerify.count() > 0) {
          await anyVerify.last().click();
          console.log('Clicked Verify');
        }
      }
      await page.waitForTimeout(4000);
    }
  }

  const afterVerify = await page.evaluate(() => document.body.innerText);
  console.log('After verification:\n' + afterVerify.substring(0, 800));
  await page.screenshot({ path: 'docs/qa/sprint41-evidence/auth-verify.png' });
  console.log('auth-verify.png saved');

  // Check if we are now on the home screen
  const isHome = !afterVerify.toLowerCase().includes('verify') &&
                 !afterVerify.toLowerCase().includes('sign in') &&
                 !afterVerify.toLowerCase().includes('create account');

  if (!isHome) {
    // Maybe need to log in after verification
    console.log('Still not home - checking if login required...');
    if (afterVerify.toLowerCase().includes('sign in') || afterVerify.toLowerCase().includes('email')) {
      // Try logging in with the registered account
      await page.fill('input[type="email"]', 'frank@test.com');
      await page.fill('input[type="password"]', 'password123');
      await page.locator('div').filter({ hasText: /^Sign In$/ }).last().click();
      await page.waitForTimeout(4000);
    }
  }

  const finalText = await page.evaluate(() => document.body.innerText);
  console.log('FINAL HOME SCREEN:\n' + finalText.substring(0, 1200));
  await page.screenshot({ path: 'docs/qa/sprint41-evidence/home-01.png' });
  console.log('home-01.png saved');

  await browser.close();
  console.log('Done');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });

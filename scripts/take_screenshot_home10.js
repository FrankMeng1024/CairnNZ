const { chromium } = require('C:/Users/I585134/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright');

(async () => {
  const execPath = 'C:/Users/I585134/AppData/Local/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-win64/chrome-headless-shell.exe';
  const browser = await chromium.launch({ headless: true, executablePath: execPath });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 393, height: 852 });

  // Step 1 + 3: Navigate and wait
  console.log('Navigating to http://localhost:8082 ...');
  await page.goto('http://localhost:8082');
  await page.waitForTimeout(3000);

  // Step 4a: Click "Sign In" on landing page (div[tabindex="0"] with text "Sign In")
  console.log('Clicking landing Sign In...');
  const landingDivs = await page.$$('div[tabindex="0"]');
  for (const div of landingDivs) {
    const txt = await div.textContent().catch(() => '');
    if (txt.trim() === 'Sign In') {
      await div.click();
      console.log('Clicked landing Sign In div');
      break;
    }
  }
  await page.waitForTimeout(1000);

  // Verify we're on auth screen
  const text2 = await page.evaluate(() => document.body.innerText);
  console.log('Auth screen text (first 200):', text2.substring(0, 200));

  // Step 4b: Fill email
  console.log('Filling email...');
  await page.locator('input[type="email"]').fill('frank@test.com');

  // Step 4c: Fill password
  console.log('Filling password...');
  await page.locator('input[type="password"]').fill('password123');

  // Step 4d: Click the Sign In submit button on the auth form
  // On auth screen, there will be multiple div[tabindex="0"] — find "Sign In" that's the submit
  console.log('Clicking auth form submit...');
  const authDivs = await page.$$('div[tabindex="0"]');
  console.log('Auth screen divs with tabindex=0:', authDivs.length);
  for (const div of authDivs) {
    const txt = await div.textContent().catch(() => '');
    console.log('  div text:', JSON.stringify(txt.trim()));
  }

  // The submit Sign In button should contain an arrow icon + "Sign In" text
  // Click the first one that matches "Sign In" (not "Back", not social buttons)
  for (const div of authDivs) {
    const txt = await div.textContent().catch(() => '');
    const trimmed = txt.trim();
    if (trimmed.includes('Sign In') && !trimmed.includes('Google') && !trimmed.includes('Apple') && !trimmed.includes('Back')) {
      await div.click();
      console.log('Clicked auth submit:', trimmed);
      break;
    }
  }

  // Wait for navigation away from auth screen — wait for home screen content
  console.log('Waiting for home screen...');
  try {
    // Wait until the auth screen text disappears and home content appears
    await page.waitForFunction(() => {
      const text = document.body.innerText;
      return text.includes('Hiking') || text.includes('Explorer') || text.includes('Running');
    }, { timeout: 8000 });
    console.log('Home screen detected');
  } catch (e) {
    console.log('Timeout waiting for home screen, proceeding anyway:', e.message);
  }
  // Extra 1s for animations to settle
  await page.waitForTimeout(1000);

  const text3 = await page.evaluate(() => document.body.innerText);
  console.log('Post-login page text (first 500):', text3.substring(0, 500));

  // Take screenshot
  console.log('Taking screenshot...');
  await page.screenshot({ path: 'docs/qa/sprint41-evidence/home-10.png', fullPage: false });
  console.log('Screenshot saved.');

  await browser.close();
})().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});

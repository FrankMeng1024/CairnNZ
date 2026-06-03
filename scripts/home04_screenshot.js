const { chromium } = require('C:/Users/I585134/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright');

(async () => {
  const execPath = 'C:/Users/I585134/AppData/Local/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-win64/chrome-headless-shell.exe';
  const browser = await chromium.launch({ headless: true, executablePath: execPath });
  const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
  const page = await context.newPage();

  // Capture console errors
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('[CONSOLE ERR]', msg.text());
  });

  console.log('Navigating...');
  await page.goto('http://localhost:8082', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const pageText = await page.evaluate(() => document.body.innerText);
  console.log('Landing text:', pageText.substring(0, 100));

  // Step 1: Click "Sign In" tab on splash screen
  const allDivs = await page.$$('div[tabindex="0"]');
  console.log('tabindex=0 divs:', allDivs.length);
  for (const d of allDivs) {
    const t = await d.evaluate(el => el.textContent.trim());
    console.log('  div:', JSON.stringify(t));
    if (t === 'Sign In') {
      await d.click();
      console.log('Clicked Sign In (splash)');
      break;
    }
  }
  await page.waitForTimeout(1500);

  // Step 2: Fill email and password
  await page.locator('input[type="email"]').fill('test@test.com');
  await page.locator('input[type="password"]').fill('test123');
  console.log('Credentials filled');

  // Step 3: Find all divs with tabindex=0 again and log them
  const formDivs = await page.$$('div[tabindex="0"]');
  console.log('Form tabindex=0 divs:', formDivs.length);
  const clickTargets = [];
  for (const d of formDivs) {
    const t = await d.evaluate(el => el.textContent.trim());
    const rect = await d.evaluate(el => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    });
    console.log('  div text:', JSON.stringify(t), 'rect:', JSON.stringify(rect));
    if (t.includes('Sign In') && !t.includes('Continue') && !t.includes('Apple') && !t.includes('Google')) {
      clickTargets.push({ el: d, text: t, rect });
    }
  }

  // Click the last matching "Sign In" button (the form submit)
  if (clickTargets.length > 0) {
    const target = clickTargets[clickTargets.length - 1];
    console.log('Clicking submit:', JSON.stringify(target.text), 'at', JSON.stringify(target.rect));
    await target.el.click();
  }

  console.log('Waiting 5s for login...');
  await page.waitForTimeout(5000);

  const afterLogin = await page.evaluate(() => document.body.innerText);
  console.log('After login text:', afterLogin.substring(0, 300));

  // Check if still on auth
  if (afterLogin.includes('Password') || afterLogin.includes('Email')) {
    console.log('Still on auth - trying keyboard Enter');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(4000);
  }

  console.log('Waiting 2s for animations...');
  await page.waitForTimeout(2000);

  await page.screenshot({ path: 'docs/qa/sprint41-evidence/STORY-00130-home-04.png', fullPage: false });
  console.log('Screenshot saved: STORY-00130-home-04.png');

  const final = await page.evaluate(() => document.body.innerText);
  console.log('Final page text:', final.substring(0, 400));

  await browser.close();
})().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });

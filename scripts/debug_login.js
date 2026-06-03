const { chromium } = require('C:/Users/I585134/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright');

(async () => {
  const execPath = 'C:/Users/I585134/AppData/Local/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-win64/chrome-headless-shell.exe';
  const browser = await chromium.launch({ headless: true, executablePath: execPath });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 393, height: 852 });

  // Capture all network requests
  const requests = [];
  const responses = [];
  page.on('request', req => {
    requests.push({ url: req.url(), method: req.method() });
  });
  page.on('response', async res => {
    let body = '';
    try { body = await res.text(); } catch(e) {}
    responses.push({ url: res.url(), status: res.status(), body: body.substring(0, 200) });
  });

  // Capture console messages
  const consoleMsgs = [];
  page.on('console', msg => consoleMsgs.push({ type: msg.type(), text: msg.text() }));

  console.log('Navigating...');
  await page.goto('http://localhost:8082');
  await page.waitForTimeout(3000);

  // Click landing Sign In
  const landingDivs = await page.$$('div[tabindex="0"]');
  for (const div of landingDivs) {
    const txt = await div.textContent().catch(() => '');
    if (txt.trim() === 'Sign In') { await div.click(); break; }
  }
  await page.waitForTimeout(1000);

  // Fill credentials
  await page.locator('input[type="email"]').fill('frank@test.com');
  await page.locator('input[type="password"]').fill('password123');

  // Clear request log before submit
  requests.length = 0;
  responses.length = 0;

  // Click submit Sign In
  const authDivs = await page.$$('div[tabindex="0"]');
  for (const div of authDivs) {
    const txt = await div.textContent().catch(() => '');
    if (txt.trim() === 'Sign In') { await div.click(); break; }
  }

  console.log('Waiting 5s...');
  await page.waitForTimeout(5000);

  console.log('\n=== NETWORK REQUESTS AFTER SUBMIT ===');
  requests.forEach(r => console.log(r.method, r.url));

  console.log('\n=== NETWORK RESPONSES AFTER SUBMIT ===');
  responses.forEach(r => console.log(r.status, r.url, r.body.substring(0, 100)));

  console.log('\n=== CONSOLE MESSAGES ===');
  consoleMsgs.forEach(m => console.log('[' + m.type + ']', m.text));

  const finalText = await page.evaluate(() => document.body.innerText);
  console.log('\n=== FINAL PAGE TEXT ===');
  console.log(finalText.substring(0, 300));

  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });

const { chromium } = require('C:/Users/I585134/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright');

(async () => {
  const execPath = 'C:/Users/I585134/AppData/Local/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-win64/chrome-headless-shell.exe';
  const browser = await chromium.launch({ headless: true, executablePath: execPath });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 393, height: 852 });

  console.log('Navigating...');
  await page.goto('http://localhost:8082');
  await page.waitForTimeout(3000);

  // Dump all clickable/interactive elements on the landing page
  const elements = await page.evaluate(() => {
    const interactable = document.querySelectorAll('[role], [onclick], [data-testid], a, button, input, div[tabindex]');
    return Array.from(interactable).slice(0, 50).map(el => ({
      tag: el.tagName,
      role: el.getAttribute('role'),
      text: el.textContent ? el.textContent.trim().substring(0, 80) : '',
      testid: el.getAttribute('data-testid'),
      tabindex: el.getAttribute('tabindex'),
      cursor: window.getComputedStyle(el).cursor,
    }));
  });
  console.log('Interactable elements on landing:');
  elements.forEach((e, i) => console.log(i, JSON.stringify(e)));
})().catch(e => { console.error(e.message); process.exit(1); });

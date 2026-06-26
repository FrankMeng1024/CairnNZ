const { chromium } = require('C:/Users/I585134/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright');
const fs = require('fs');

const bbox = JSON.parse(fs.readFileSync('demo_bbox.json', 'utf8'));
const pngA = fs.readFileSync('demo_A_corridor.png');
const pngB = fs.readFileSync('demo_B_blob.png');
const pngC = fs.readFileSync('demo_C_combo.png');

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Users/I585134/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
    headless: true,
  });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });

  await ctx.route('**/demo_bbox.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bbox) }));
  await ctx.route('**/demo_A_corridor.png', r => r.fulfill({ status: 200, contentType: 'image/png', body: pngA }));
  await ctx.route('**/demo_B_blob.png', r => r.fulfill({ status: 200, contentType: 'image/png', body: pngB }));
  await ctx.route('**/demo_C_combo.png', r => r.fulfill({ status: 200, contentType: 'image/png', body: pngC }));

  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') console.error('PAGE:', m.text()); });
  await page.goto('file:///C:/ClaudeCodeProjects/Cairn/_spike/v333/demo_real_map.html');
  await page.waitForTimeout(5000);
  await page.screenshot({ path: 'demo_3styles_realmap.png', fullPage: false });
  console.log('saved demo_3styles_realmap.png');
  await browser.close();
})();

const { chromium } = require('C:/Users/I585134/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright');
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('F4_world_minus_circle.geojson', 'utf8'));

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Users/I585134/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
    headless: true,
  });
  const ctx = await browser.newContext({ viewport: { width: 800, height: 1200 } });
  await ctx.route('**/F4_world_minus_circle.geojson', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) }));
  const page = await ctx.newPage();
  await page.goto('file:///C:/ClaudeCodeProjects/Cairn/_spike/v331-pc/F4_test.html');
  await page.waitForFunction(() => window.map && window.map.isStyleLoaded && window.map.isStyleLoaded(), { timeout: 30000 });
  await page.waitForTimeout(3000);

  const zooms = [18, 16, 14, 12, 10, 8, 6, 4, 2];
  for (const z of zooms) {
    await page.evaluate((z) => window.map.setZoom(z), z);
    try { await page.waitForFunction(() => !window.map.isMoving() && window.map.areTilesLoaded(), { timeout: 8000 }); } catch(e) {}
    await page.waitForTimeout(800);
    const fn = `F4_z${z}.png`;
    await page.screenshot({ path: fn, fullPage: false });
    console.log('saved', fn);
  }
  await browser.close();
})();

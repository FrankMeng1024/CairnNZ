// F3 screenshot runner — raster ImageSource proof
const { chromium } = require('C:/Users/I585134/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Users/I585134/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
    headless: true,
  });
  const ctx = await browser.newContext({
    viewport: { width: 800, height: 1200 },
    deviceScaleFactor: 1,
  });

  // Inject both viewport.json and PNG via route interception
  const vp = JSON.parse(fs.readFileSync('F3_viewport.json', 'utf8'));
  const pngBytes = fs.readFileSync('F3_fog_mask.png');

  await ctx.route('**/F3_viewport.json', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(vp) });
  });
  await ctx.route('**/F3_fog_mask.png', (route) => {
    route.fulfill({ status: 200, contentType: 'image/png', body: pngBytes });
  });

  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.error('PAGE-ERR:', m.text()); });

  await page.goto('file:///C:/ClaudeCodeProjects/Cairn/_spike/v331-pc/F3_raster_proof.html');
  await page.waitForFunction(() => window.map && window.map.isStyleLoaded && window.map.isStyleLoaded(), { timeout: 30000 });
  await page.waitForTimeout(3000);

  const stats = await page.locator('#stats').innerText();
  console.log('stats:', stats);

  const zooms = [18, 16, 14, 12, 10, 8];

  for (const z of zooms) {
    await page.evaluate((z) => window.map.setZoom(z), z);
    try { await page.waitForFunction(() => !window.map.isMoving() && window.map.areTilesLoaded(), { timeout: 8000 }); }
    catch (e) {}
    await page.waitForTimeout(1000);
    const fn = `F3_raster_z${z}.png`;
    await page.screenshot({ path: fn, fullPage: false });
    console.log('saved', fn);
  }

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });

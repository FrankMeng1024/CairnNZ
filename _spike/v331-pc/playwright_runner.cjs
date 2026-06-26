// F1 matrix screenshot runner — inject geojson via route interception to bypass file:// fetch CORS
const { chromium } = require('C:/Users/I585134/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright');
const fs = require('fs');

const geojson = JSON.parse(fs.readFileSync('real_fog.geojson', 'utf8'));

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Users/I585134/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
    headless: true,
  });
  const ctx = await browser.newContext({
    viewport: { width: 800, height: 1200 },
    deviceScaleFactor: 1,
  });

  await ctx.route('**/real_fog.geojson', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(geojson) });
  });

  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.error('PAGE-ERR:', m.text()); });
  page.on('pageerror', (e) => console.error('PAGE-PAGEERR:', e.message));

  await page.goto('file:///C:/ClaudeCodeProjects/Cairn/_spike/v331-pc/F1_cairn_real_fog.html');
  await page.waitForFunction(() => window.map && window.map.isStyleLoaded && window.map.isStyleLoaded(), { timeout: 30000 });
  await page.waitForTimeout(3000);

  const stats = await page.locator('#stats').innerText();
  console.log('stats:', stats);

  const scenarios = ['v327', 'v328', 'v330', 'v331proposed'];
  const zooms = [14, 12, 10];

  for (const s of scenarios) {
    await page.evaluate((s) => window.setScenario(s), s);
    await page.waitForTimeout(500);
    for (const z of zooms) {
      await page.evaluate((z) => window.map.setZoom(z), z);
      try { await page.waitForFunction(() => !window.map.isMoving() && window.map.areTilesLoaded(), { timeout: 8000 }); }
      catch(e) {}
      await page.waitForTimeout(800);
      const fn = `F1_${s}_z${z}.png`;
      await page.screenshot({ path: fn, fullPage: false });
      console.log('saved', fn);
    }
  }

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });

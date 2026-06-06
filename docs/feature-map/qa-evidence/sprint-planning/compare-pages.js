/* Compare visible cards across page 2 and page 3 on remote */
const path = require('path');
const fs = require('fs');
const PW = require('C:/Users/I585134/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.js');

const URL = 'https://map.yiiling.cn/';
const OUT = __dirname;

const PW_DIR = 'C:/Users/I585134/AppData/Local/ms-playwright';
let executablePath = null;
for (const c of fs.readdirSync(PW_DIR).filter(d => d.startsWith('chromium-')).sort().reverse()) {
  for (const sub of ['chrome-win64', 'chrome-win']) {
    const p = path.join(PW_DIR, c, sub, 'chrome.exe');
    if (fs.existsSync(p)) { executablePath = p; break; }
  }
  if (executablePath) break;
}

(async () => {
  const browser = await PW.chromium.launch({ headless: true, executablePath });
  const page = await browser.newContext({ viewport: { width: 1440, height: 900 } }).then(c => c.newPage());

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // Page 2: collect all visible card data-id
  await page.click('.tab[data-view="view-story"]');
  await page.waitForTimeout(400);
  const page2cards = await page.locator('#view-story .card').evaluateAll(els =>
    els.map(e => ({ id: e.dataset.id, title: e.querySelector('.card-title')?.textContent || '' }))
  );
  console.log(`Page 2 visible cards: ${page2cards.length}`);

  // Page 3: collect all visible card data-id (excluding inbox? include all)
  await page.click('.tab[data-view="view-planning"]');
  await page.waitForTimeout(600);
  const page3cards = await page.locator('#view-planning .pl-card').evaluateAll(els =>
    els.map(e => ({ id: e.dataset.id, title: e.querySelector('.card-title')?.textContent || '' }))
  );
  console.log(`Page 3 visible cards: ${page3cards.length}`);

  const ids2 = new Set(page2cards.map(c => c.id));
  const ids3 = new Set(page3cards.map(c => c.id));
  const onlyOn3 = page3cards.filter(c => !ids2.has(c.id));
  const onlyOn2 = page2cards.filter(c => !ids3.has(c.id));
  console.log(`\nOn page 3 but NOT on page 2 (${onlyOn3.length}):`);
  onlyOn3.forEach(c => console.log(`  ${c.id}: ${c.title}`));
  console.log(`\nOn page 2 but NOT on page 3 (${onlyOn2.length}):`);
  onlyOn2.forEach(c => console.log(`  ${c.id}: ${c.title}`));

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });

/* QA smoke test for Planning view (Page 3).
   Run: node smoke.js
   Outputs screenshots + console errors to current directory.
*/
const path = require('path');
const PW = require('C:/Users/I585134/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.js');

const URL = process.env.URL || 'http://localhost:7788/';
const OUT = __dirname;

// Find an available chromium executable from already-installed versions
const fs = require('fs');
const PW_DIR = 'C:/Users/I585134/AppData/Local/ms-playwright';
const candidates = fs.readdirSync(PW_DIR)
  .filter(d => d.startsWith('chromium-'))
  .sort()
  .reverse();
let executablePath = null;
for (const c of candidates) {
  for (const sub of ['chrome-win64', 'chrome-win']) {
    const p = path.join(PW_DIR, c, sub, 'chrome.exe');
    if (fs.existsSync(p)) { executablePath = p; break; }
  }
  if (executablePath) break;
}
console.log('using chromium:', executablePath || 'default');

(async () => {
  const launchOpts = { headless: true };
  if (executablePath) launchOpts.executablePath = executablePath;
  const browser = await PW.chromium.launch(launchOpts);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const errors = [];
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error') errors.push('[console.error] ' + m.text());
  });

  console.log('→ navigate', URL);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  // 1. overview tab default
  await page.screenshot({ path: path.join(OUT, '01-overview-default.png'), fullPage: false });

  // 2. switch to story map
  await page.click('.tab[data-view="view-story"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '02-story-map.png'), fullPage: false });

  // 3. switch to planning
  await page.click('.tab[data-view="view-planning"]');
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, '03-planning-default.png'), fullPage: true });

  // 4. count visible elements
  const inboxCount = await page.locator('#pl-inbox .pl-card').count();
  const releaseRows = await page.locator('.pl-row').count();
  const slots = await page.locator('.pl-slot').count();
  const cards = await page.locator('.pl-card').count();
  console.log(`inbox=${inboxCount} releases=${releaseRows} slots=${slots} cards=${cards}`);

  // 5. cards per release
  const releaseIds = await page.locator('.pl-row').evaluateAll(els => els.map(e => e.dataset.releaseId));
  const cardsPerRelease = {};
  for (const rid of releaseIds) {
    cardsPerRelease[rid] = await page.locator(`.pl-row[data-release-id="${rid}"] .pl-card`).count();
  }
  console.log('cards per release:', JSON.stringify(cardsPerRelease));

  // 6. switch to light mode
  await page.click('#themeBtn');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '04-planning-light.png'), fullPage: true });

  // 7. switch back to dark
  await page.click('#themeBtn');
  await page.waitForTimeout(300);

  // 8. test the show-completed toggle
  await page.uncheck('#pl-show-completed').catch(() => {});
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '05-planning-hide-done.png'), fullPage: true });
  await page.check('#pl-show-completed').catch(() => {});
  await page.waitForTimeout(200);

  // 9. open card edit modal via dblclick
  const firstCard = page.locator('.pl-card').first();
  await firstCard.dblclick();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '06-card-edit-modal.png'), fullPage: false });
  // close modal
  await page.click('.modal-close');
  await page.waitForTimeout(200);

  // 10. switch back to story map and verify card is intact
  await page.click('.tab[data-view="view-story"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '07-story-map-after.png'), fullPage: false });

  // 11. data.js sanity: GET to verify planning fields exist
  const dataJsHasPlanning = await page.evaluate(async () => {
    const r = await fetch('/js/data.js?t=' + Date.now());
    const txt = await r.text();
    return txt.includes('"planning"') ? txt.match(/"planning":/g).length : 0;
  });
  console.log('data.js planning field count:', dataJsHasPlanning);

  // 12. mobile viewport
  await page.setViewportSize({ width: 720, height: 1024 });
  await page.click('.tab[data-view="view-planning"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '08-planning-mobile.png'), fullPage: true });

  console.log('errors:', errors.length === 0 ? 'NONE' : '\n' + errors.join('\n'));

  await browser.close();
  process.exit(errors.length > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

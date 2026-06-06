/* Test release row drag specifically */
const path = require('path');
const fs = require('fs');
const PW = require('C:/Users/I585134/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright/index.js');

const URL = process.env.URL || 'http://localhost:7788/';
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

  page.on('pageerror', e => console.log('[pageerror]', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text()); });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.click('.tab[data-view="view-planning"]');
  await page.waitForTimeout(800);

  // Inject DragDrop debug
  await page.evaluate(() => {
    window.__dragLog = [];
    const origBind = DragDrop.bind;
    DragDrop.bind = function(opts) {
      const tag = opts.itemSelector + '@' + opts.containerSelector;
      const wrap = (name, fn) => fn ? function(...args){ window.__dragLog.push(`${tag}.${name}`); return fn.apply(this, args); } : fn;
      const newOpts = { ...opts, onDrop: wrap('onDrop', opts.onDrop) };
      return origBind(newOpts);
    };
    // re-render to apply patch
    if (window.ViewPlanning) ViewPlanning.render();
  });
  await page.waitForTimeout(300);

  // Print initial release order
  const before = await page.locator('.pl-row .pl-row-name').allTextContents();
  console.log('BEFORE:', before);

  // Try to drag Phase 2 (3rd row) handle UP to before Phase 1 (1st row)
  const phase2Handle = page.locator('.pl-row[data-release-id="plr-p2"] .pl-row-handle');
  const phase1Row = page.locator('.pl-row[data-release-id="plr-p1"]');

  const fromBox = await phase2Handle.boundingBox();
  const toBox = await phase1Row.boundingBox();
  console.log('phase2 handle box:', fromBox);
  console.log('phase1 row box:', toBox);

  if (!fromBox || !toBox) { console.log('boxes not found'); await browser.close(); return; }

  // Simulate pointer drag manually
  await page.mouse.move(fromBox.x + fromBox.width/2, fromBox.y + fromBox.height/2);
  await page.mouse.down();
  await page.waitForTimeout(100);
  // move slowly to trigger drag start (>5px threshold)
  await page.mouse.move(fromBox.x + fromBox.width/2, fromBox.y + fromBox.height/2 - 20, { steps: 5 });
  await page.waitForTimeout(100);
  await page.mouse.move(toBox.x + 50, toBox.y + 10, { steps: 10 });
  await page.waitForTimeout(200);
  await page.mouse.up();
  await page.waitForTimeout(500);

  const after = await page.locator('.pl-row .pl-row-name').allTextContents();
  console.log('AFTER:', after);
  console.log('changed:', JSON.stringify(before) !== JSON.stringify(after));

  const log = await page.evaluate(() => window.__dragLog);
  console.log('drag log:', log);

  const stateInfo = await page.evaluate(() => {
    const r = Store.get().planning.releases;
    return r.map(x => ({ id: x.id, name: x.name, order: x.order }));
  });
  console.log('state.planning.releases:', stateInfo);

  await page.screenshot({ path: path.join(__dirname, 'drag-test-result.png'), fullPage: true });

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });

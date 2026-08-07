// Phase I - untested areas walkthrough. Takes screenshots of each surface
// so subagent reviewers can inspect them.
const { chromium, devices } = require('playwright');
const fs = require('fs');
const testUser = JSON.parse(fs.readFileSync('C:/ClaudeCodeProjects/Cairn/scripts/r113/.testuser.json','utf8'));
const OUT_DIR = 'C:/ClaudeCodeProjects/Cairn/docs/qa/r114-untested-areas';

async function shot(page, name) {
  await page.screenshot({ path: `${OUT_DIR}/${name}`, fullPage: false });
  console.log('    saved', name);
}

async function nav(page, route) {
  await page.evaluate((r) => {
    try { window.__cairnStores?.navigationRef?.current?.navigate?.(r); } catch {}
  }, route);
  await page.waitForTimeout(3000);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const consoleErrors = [];
  const pageErrors = [];
  const b = await chromium.launch({
    headless: true,
    args: ['--disable-cache', '--disk-cache-size=0'],
  });
  const ctx = await b.newContext({
    ...devices['iPhone 13'], viewport: { width: 390, height: 844 },
    extraHTTPHeaders: { 'Cache-Control': 'no-cache' },
  });
  await ctx.addInitScript(() => {
    try { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('cairn_onboarding_v1_done', 'true'); } catch {}
  });
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') consoleErrors.push({ text: m.text().slice(0,300), url: p.url() }); });
  p.on('pageerror', e => pageErrors.push({ msg: e.message, stack: (e.stack||'').slice(0,300) }));

  // Login
  console.log('[login]');
  await p.goto('http://localhost:8082/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(5000);
  await p.getByText(/^Sign In$/i).first().tap();
  await p.waitForTimeout(3000);
  await p.locator('input').nth(0).fill(testUser.email);
  await p.locator('input').nth(1).fill(testUser.password);
  await p.getByText(/^Sign In$/i).last().tap();
  await p.waitForTimeout(6000);
  const s0 = await p.evaluate(() => window.__cairnStores?.useAppStore?.getState?.().isLoggedIn);
  console.log('    logged in:', s0);

  // Area 1: Trails (Routes screen — subtab Activities/Routes/Cairns)
  console.log('[trails]');
  await nav(p, 'Routes');
  await shot(p, 'area01-trails-activities.png');
  await p.getByText(/^Routes$/i).first().tap({ timeout: 3000 }).catch(()=>{});
  await p.waitForTimeout(2500);
  await shot(p, 'area01-trails-routes-tab.png');
  await p.getByText(/^Cairns$/i).first().tap({ timeout: 3000 }).catch(()=>{});
  await p.waitForTimeout(2500);
  await shot(p, 'area01-trails-cairns-tab.png');

  // Tap a specific activity to see detail (nav 导航 test)
  console.log('[nav — activity detail]');
  await p.getByText(/^Activities$/i).first().tap({ timeout: 3000 }).catch(()=>{});
  await p.waitForTimeout(2000);
  await p.getByText(/^Seed hike 1$/i).first().tap({ timeout: 3000 }).catch(()=>{});
  await p.waitForTimeout(3000);
  await shot(p, 'area02-nav-activity-detail.png');
  await p.goBack().catch(()=>{});
  await p.waitForTimeout(2000);

  // Area 3: Friends
  console.log('[friends]');
  await nav(p, 'Home');
  await nav(p, 'Friends');
  await shot(p, 'area03-friends-list.png');

  // Area 4: Memory (already tested in Phase F but include for completeness)
  console.log('[memory]');
  await nav(p, 'Home');
  await nav(p, 'Memory');
  await shot(p, 'area04-memory-map.png');
  await p.getByText(/^Got it$/i).first().tap({ timeout: 3000 }).catch(()=>{});
  await p.waitForTimeout(2000);
  await shot(p, 'area04-memory-post-dismiss.png');
  await p.getByText(/^Friends$/i).first().tap({ timeout: 3000 }).catch(()=>{});
  await p.waitForTimeout(2000);
  await shot(p, 'area04-memory-friends-tab.png');

  // Area 5: Mark detail screen (tap first mark from Cairns list)
  console.log('[mark detail]');
  await nav(p, 'Home');
  await nav(p, 'Routes');
  await p.getByText(/^Cairns$/i).first().tap({ timeout: 3000 }).catch(()=>{});
  await p.waitForTimeout(2500);
  await p.getByText(/^Left fork$/i).first().tap({ timeout: 3000 }).catch(()=>{});
  await p.waitForTimeout(3500);
  await shot(p, 'area05-mark-detail-public-junction.png');
  await p.goBack().catch(()=>{});
  await p.waitForTimeout(2000);

  // Area 6: Plant flow (all 3 steps if possible)
  console.log('[plant flow]');
  await nav(p, 'Home');
  await nav(p, 'Plant');
  await shot(p, 'area06-plant-01-gps-lock.png');
  await p.waitForTimeout(6000);
  await shot(p, 'area06-plant-02-pin-adjust.png');
  // Try confirming pin
  await p.getByText(/Confirm this spot/i).first().tap({ timeout: 3000 }).catch(()=>{});
  await p.waitForTimeout(3000);
  await shot(p, 'area06-plant-03-content-step.png');

  // Area 7: Settings deep — profile edit, preferences
  console.log('[settings deep]');
  await nav(p, 'Home');
  await nav(p, 'Settings');
  await shot(p, 'area07-settings-top.png');
  // Scroll bottom to see all sections
  await p.evaluate(() => window.scrollBy(0, 800));
  await p.waitForTimeout(1500);
  await shot(p, 'area07-settings-middle.png');
  await p.evaluate(() => window.scrollBy(0, 800));
  await p.waitForTimeout(1500);
  await shot(p, 'area07-settings-bottom.png');
  // Tap Edit name
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(1500);
  await p.getByText(/Edit name/i).first().tap({ timeout: 3000 }).catch(()=>{});
  await p.waitForTimeout(3000);
  await shot(p, 'area07-settings-edit-name-modal.png');

  // Area 8: Auth screens variations
  console.log('[auth screens]');
  // Sign out first via Settings
  await nav(p, 'Settings');
  await p.evaluate(() => window.scrollBy(0, 1600));
  await p.waitForTimeout(1500);
  await p.getByText(/^Sign out$/i).first().tap({ timeout: 3000 }).catch(()=>{});
  await p.waitForTimeout(2000);
  await p.getByText(/^Sign out$/i).last().tap({ timeout: 3000 }).catch(()=>{}); // confirm
  await p.waitForTimeout(4000);
  await shot(p, 'area08-auth-landing-post-signout.png');
  // Tap Create Account
  await p.getByText(/^Create Account$/i).first().tap({ timeout: 3000 }).catch(()=>{});
  await p.waitForTimeout(3000);
  await shot(p, 'area08-auth-create-account.png');
  // Back to landing, tap Sign In
  await p.goBack().catch(()=>{});
  await p.waitForTimeout(2000);
  await p.getByText(/^Sign In$/i).first().tap({ timeout: 3000 }).catch(()=>{});
  await p.waitForTimeout(3000);
  await shot(p, 'area08-auth-signin-subscreen.png');

  await b.close();

  const summary = {
    generatedAt: new Date().toISOString(),
    loggedIn: s0,
    consoleErrorCount: consoleErrors.length,
    pageErrorCount: pageErrors.length,
    consoleErrors: consoleErrors.slice(0, 30),
    pageErrors: pageErrors.slice(0, 10),
    coveredAreas: [
      'trails (Routes tab: Activities/Routes/Cairns)',
      'navigation (activity detail drilldown)',
      'friends',
      'memory (Mine/Friends)',
      'mark detail (public junction)',
      'plant flow (gps/pin/content)',
      'settings (top/middle/bottom + edit name)',
      'auth (landing/create/signin)',
    ],
  };
  fs.writeFileSync(`${OUT_DIR}/phase-i-summary.json`, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
})();

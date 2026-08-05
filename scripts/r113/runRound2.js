// R113 Round 2 runner — re-tests Round 1 FAIL cases with proper navigation.
//
// Round 1 gap fixed here:
// 1. Real backend user (created via authHelper) + JWT injected — removes Playwright
//    bypass problem where fake user id=0 got 401 from any user-scoped API → auto-logout.
// 2. Per-tab route mapping — jump to target screen using navigationRef.navigate().
// 3. Sim-walker enabled for K/R/E/C.
// 4. L cases explicitly logout to reach AuthScreen.

const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const { createTestUser } = require('./authHelper');

const DATA_JSON = 'C:/ClaudeCodeProjects/Cairn/docs/feature-map/flows/data.json';
const EVIDENCE_DIR = 'C:/ClaudeCodeProjects/Cairn/docs/qa/user-flows-round-1';
const BASE_URL = 'http://localhost:8082/';
const ALIYUN_URL_PREFIX = 'https://map.yiiling.cn/flows/screenshots/round-1/';

// Per-tab prefix → route + optional setup steps.
// The runner reloads to BASE_URL then uses __cairnStores.navigationRef to jump.
const TAB_ROUTES = {
  N: { route: null, setup: 'clearOnboarding' },  // N = onboarding modal on Home
  L: { route: 'Auth', setup: 'logout' },
  H: { route: 'Home' },
  K: { route: 'Hiking', setup: 'simWalker' },
  R: { route: 'Running', setup: 'simWalker' },
  M: { route: 'Map' },
  E: { route: 'Memory' },
  T: { route: 'Routes' },  // Trails tab lives inside Routes screen
  P: { route: 'Routes' },
  C: { route: 'Plant', setup: 'simWalker' },
  F: { route: 'Friends' },
  S: { route: 'Settings' },
  V: { route: 'MapHistory' },
  D: { route: 'MarkerDetail' },
  A: { route: null },  // AR — skipped
  G: { route: 'Home' },
};

async function setupForCase(page, tabPrefix) {
  const cfg = TAB_ROUTES[tabPrefix] || {};

  // For non-L cases we programmatically flip isLoggedIn=true post-boot.
  // Cold boot deliberately keeps isLoggedIn=false even with valid JWT (product
  // design — see useAppStore.ts:235 — always show Auth screen at cold boot,
  // user taps Sign In to advance). For QA we bypass that by directly setting
  // the store state, since hydrate() already fetched user profile via getMe().
  if (tabPrefix !== 'L') {
    try {
      await page.evaluate(() => {
        const stores = window.__cairnStores;
        if (stores?.useAppStore) {
          const state = stores.useAppStore.getState();
          if (state.user && state.setLoggedIn && !state.isLoggedIn) {
            state.setLoggedIn(true);
          }
        }
      });
      await page.waitForTimeout(800);
    } catch {}
  }

  if (cfg.setup === 'clearOnboarding') {
    await page.evaluate(() => {
      try { localStorage.removeItem('cairn_onboarding_v1_done'); } catch {}
    });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
  } else if (cfg.setup === 'logout') {
    await page.evaluate(() => {
      try {
        const stores = window.__cairnStores;
        if (stores?.useAppStore) {
          const state = stores.useAppStore.getState();
          if (state?.logout) state.logout();
        }
      } catch {}
    });
    await page.waitForTimeout(1000);
  } else if (cfg.setup === 'simWalker') {
    await page.evaluate(() => {
      try {
        const stores = window.__cairnStores;
        if (stores?.useSimWalkerStore) {
          stores.useSimWalkerStore.getState()?.setActive?.(true);
        }
        if (stores?.useSettingsStore) {
          const s = stores.useSettingsStore.getState();
          s?.setDebugMode?.(true);
        }
        if (stores?.gpsInjector?.push) {
          stores.gpsInjector.push({ lat: -36.8485, lng: 174.7633, ts: Date.now() });
        }
      } catch {}
    });
  }

  if (cfg.route) {
    try {
      await page.evaluate((routeName) => {
        const stores = window.__cairnStores;
        if (stores?.navigationRef?.navigate) {
          stores.navigationRef.navigate(routeName);
        }
      }, cfg.route);
      await page.waitForTimeout(1500);
    } catch {}
  }
}

function extractExpectedTokens(expect) {
  const tokens = [];
  const curlyDouble = /\u201c([^\u201c\u201d]{2,80})\u201d/g;
  const curlySingle = /\u2018([^\u2018\u2019]{2,80})\u2019/g;
  const straightDouble = /"([^"]{2,80})"/g;
  const straightSingle = /'([^']{2,80})'/g;
  for (const re of [curlyDouble, curlySingle, straightDouble, straightSingle]) {
    let m;
    while ((m = re.exec(expect)) !== null) {
      const t = m[1].trim();
      if (/[a-zA-Z0-9]{2,}/.test(t)) tokens.push(t);
    }
  }
  return [...new Set(tokens)];
}

function norm(s) {
  return (s || '')
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2014\u2013]/g, '-')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

async function runCase(page, row, tabPrefix, results) {
  const id = row.id;
  const screenshotPath = path.join(EVIDENCE_DIR, `${id}-1.png`);
  const aliyunUrl = ALIYUN_URL_PREFIX + `${id}-1.png`;

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);

    try {
      await page.waitForFunction(
        () => typeof window.__cairnStores !== 'undefined',
        null,
        { timeout: 20000 }
      );
    } catch {
      row.ai_status = 'fail';
      row.ai_reason = 'Round 2: boot timeout — hooks not exposed';
      row.ai_tested_at = new Date().toISOString();
      results.fail++;
      console.log(`[${id}] FAIL: boot timeout`);
      return;
    }

    await setupForCase(page, tabPrefix);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: screenshotPath, fullPage: false });

    const bodyText = await page.evaluate(() => document.body.innerText || '');
    const bodyNorm = norm(bodyText);
    const expectedTokens = extractExpectedTokens(row.expect);
    const foundTokens = expectedTokens.filter(t => bodyNorm.includes(norm(t)));
    const missingTokens = expectedTokens.filter(t => !bodyNorm.includes(norm(t)));

    let status, reason;
    if (expectedTokens.length === 0) {
      status = 'needs_manual';
      reason = `R2: No quoted tokens in expect. Body sample: "${bodyText.slice(0, 120)}"`;
    } else if (foundTokens.length === expectedTokens.length) {
      status = 'pass';
      reason = `R2: All ${expectedTokens.length} tokens found: ${foundTokens.map(t => `"${t}"`).join(', ')}`;
    } else if (foundTokens.length > 0) {
      status = 'needs_manual';
      reason = `R2: Partial ${foundTokens.length}/${expectedTokens.length}. Missing: ${missingTokens.map(t => `"${t}"`).join(', ')}`;
    } else {
      status = 'fail';
      reason = `R2: None of ${expectedTokens.length} tokens found. Missing: ${missingTokens.map(t => `"${t}"`).join(', ')}. Body: "${bodyText.slice(0, 200)}"`;
    }

    row.ai_status = status;
    row.ai_reason = reason;
    row.ai_screenshots = [aliyunUrl];
    row.ai_tested_at = new Date().toISOString();

    if (status === 'pass') results.pass++;
    else if (status === 'fail') results.fail++;
    else results.needs_manual++;

    console.log(`[${id}] ${status.toUpperCase()}: ${reason.slice(0, 100)}`);
  } catch (err) {
    row.ai_status = 'fail';
    row.ai_reason = `R2: runner error: ${String(err).slice(0, 200)}`;
    row.ai_tested_at = new Date().toISOString();
    results.fail++;
    console.log(`[${id}] FAIL (err): ${String(err).slice(0, 80)}`);
  }
}

async function saveData(data) {
  fs.writeFileSync(DATA_JSON, JSON.stringify(data, null, 2));
}

(async () => {
  const data = JSON.parse(fs.readFileSync(DATA_JSON, 'utf8'));

  // Collect only Round 1 FAIL cases for Round 2
  const toRun = [];
  for (const screen of data.screens) {
    for (const row of screen.rows) {
      if (row.ai_status === 'fail') {
        toRun.push({ row, tabPrefix: row.id.charAt(0) });
      }
    }
  }
  console.log(`Round 2: re-running ${toRun.length} FAIL cases from Round 1`);

  // Create ONE real backend user via yiiling API (used for all non-L cases).
  // L cases will explicitly logout in setupForCase.
  console.log('[setup] creating shared R2 test user...');
  const testUser = await createTestUser();
  console.log('[setup] test user id:', testUser.user?.id, 'jwt length:', testUser.jwt?.length);
  const jwt = testUser.jwt;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    viewport: { width: 390, height: 844 },
  });
  // Inject JWT before every navigation. Set logout marker to empty so
  // hydrate() actually attempts token-based login instead of bypass fake user.
  await context.addInitScript((token) => {
    try {
      localStorage.clear();
      localStorage.setItem('cairn_jwt', token);
      localStorage.setItem('cairn_logout_marker', '');
    } catch {}
  }, jwt);
  const page = await context.newPage();

  const results = { pass: 0, fail: 0, needs_manual: 0 };
  let n = 0;
  for (const { row, tabPrefix } of toRun) {
    await runCase(page, row, tabPrefix, results);
    n++;
    if (n % 10 === 0) {
      await saveData(data);
      console.log(`[progress] ${n}/${toRun.length} — pass=${results.pass} fail=${results.fail} manual=${results.needs_manual}`);
    }
  }

  await saveData(data);
  await browser.close();

  console.log('\n=== R113 Round 2 Runner Summary ===');
  console.log(`Total re-run: ${n}`);
  console.log(`  PASS (moved from fail): ${results.pass}`);
  console.log(`  Still FAIL: ${results.fail}`);
  console.log(`  Now NEEDS_MANUAL: ${results.needs_manual}`);
})().catch(err => {
  console.error('[runner R2] fatal:', err);
  process.exit(1);
});

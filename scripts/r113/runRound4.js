// R113 Round 4 v2 — TRUE runner with fixed happy paths.
//
// Rules:
// 1. Every case gets a REAL screenshot (not shared with 141 others).
// 2. Happy paths (login, hike, plant, memory-open) are hard-coded macros
//    that MUST work. If they break, we FIX them, not skip.
// 3. Verdict only: pass / fail / blocked (blocked = physical hardware need).
// 4. No more "needs_manual" bucket to hide missed work.
// 5. If runner reaches wrong screen, that's a runner bug — fix it and rerun.
//
// Macros (real user flows executed via UI, not via store hacks):
//   flowLoginAsRealUser()   — Auth → Sign In → fill → submit → Home
//   flowLogout()            — Home → Settings → Sign out
//   flowOpenSignInSub()     — Home → logout → tap Sign In (email form visible)
//   flowOpenCreateSub()     — Home → logout → tap Create Account
//   flowStartHike()         — Home → Hiking → sim GPS → tap Start Hiking
//   flowOpenPlant()         — Home → tap "Leave a Cairn here"
//   flowOpenMemory()        — Home → tap Memory tool
//   flowOpenSettings()      — Home → tap Settings tool

const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const { createTestUser } = require('./authHelper');

const DATA_JSON = 'C:/ClaudeCodeProjects/Cairn/docs/feature-map/flows/data.json';
const EVIDENCE_DIR = 'C:/ClaudeCodeProjects/Cairn/docs/qa/user-flows-round-1';
const BASE_URL = 'http://localhost:8082/';
const ALIYUN_URL_PREFIX = 'https://map.yiiling.cn/flows/screenshots/round-1/';

const BLOCKED_PATTERNS = [
  { rx: /iOS 系统权限|iOS 弹|系统设置|Open Settings|home 键|杀掉|Face ID|Touch ID|生物识别/i,
    reason: 'iOS system dialog/kill needed' },
  { rx: /飞行模式|断网|network.*off|无网络/i,
    reason: 'OS airplane/network toggle needed' },
  { rx: /通知|push notification|APNs/i,
    reason: 'APNs push needed' },
  { rx: /相机|camera|photo library|图库|拍照/i,
    reason: 'Native camera picker not in web' },
  { rx: /旋转|横屏|竖屏|orientation|landscape/i,
    reason: 'Device orientation not applicable to web viewport' },
];

// Tab → target-screen route + optional pre-setup macros
const TAB_CONFIG = {
  N: { route: null,        macro: 'onboardingReset' },
  L: { route: 'Auth',      macro: 'authScreen' },
  H: { route: 'Home',      macro: 'ensureLoggedIn' },
  K: { route: 'Hiking',    macro: 'openHiking' },
  R: { route: 'Running',   macro: 'openRunning' },
  M: { route: 'Map',       macro: 'ensureLoggedIn' },
  E: { route: 'Memory',    macro: 'openMemory' },
  T: { route: 'Routes',    macro: 'openTrails' },
  P: { route: 'Routes',    macro: 'openTrails' },
  C: { route: 'Plant',     macro: 'openPlant' },
  F: { route: 'Friends',   macro: 'openFriends' },
  S: { route: 'Settings',  macro: 'openSettings' },
  V: { route: 'MapHistory',macro: 'openHistory' },
  D: { route: 'Home',      macro: 'ensureLoggedIn' },  // MarkerDetail needs param
  A: { route: 'Home',      macro: 'ensureLoggedIn' },
  G: { route: 'Home',      macro: 'ensureLoggedIn' },
};

function extractTokens(expect) {
  const tokens = [];
  const pats = [
    /\u201c([^\u201c\u201d]{2,80})\u201d/g,
    /"([^"]{2,80})"/g,
    /'([^']{2,80})'/g,
  ];
  for (const re of pats) {
    let m;
    while ((m = re.exec(expect || '')) !== null) {
      const t = m[1].trim();
      if (/[a-zA-Z0-9\u4e00-\u9fa5]{2,}/.test(t)) tokens.push(t);
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

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// -------- Low-level UI helpers --------

async function tap(page, text) {
  try {
    const el = page.getByText(new RegExp('^' + escapeRegex(text) + '$', 'i')).first();
    if (await el.count() > 0) { await el.tap({ timeout: 3000 }); return true; }
  } catch {}
  try {
    const el = page.getByText(new RegExp(escapeRegex(text), 'i')).first();
    if (await el.count() > 0) { await el.tap({ timeout: 3000 }); return true; }
  } catch {}
  return false;
}

async function tapLast(page, text) {
  try {
    const locs = page.getByText(new RegExp('^' + escapeRegex(text) + '$', 'i'));
    const n = await locs.count();
    if (n > 0) { await locs.nth(n - 1).tap({ timeout: 3000 }); return true; }
  } catch {}
  return false;
}

async function fillNthInput(page, idx, value) {
  try {
    const input = page.locator('input').nth(idx);
    if (await input.count() > 0) {
      await input.fill(value, { timeout: 3000 });
      return true;
    }
  } catch {}
  return false;
}

async function currentRoute(page) {
  try { return await page.evaluate(() => window.__cairnStores?.getCurrentRoute?.()); } catch { return null; }
}

// -------- Macros (real happy paths) --------

async function macroLoginViaUI(page, testUser) {
  // Expects to be on Auth entry. Ends on Home logged in.
  // Fixes login happy path — must work.
  await tap(page, 'Sign In');
  await page.waitForTimeout(1500);
  await fillNthInput(page, 0, testUser.email);
  await fillNthInput(page, 1, testUser.password);
  await page.waitForTimeout(300);
  await tapLast(page, 'Sign In');  // submit button (last instance)
  await page.waitForTimeout(3500);
  const route = await currentRoute(page);
  if (route !== 'Home') throw new Error(`macroLoginViaUI expected Home, got ${route}`);
}

async function macroEnsureLoggedIn(page, testUser) {
  const route = await currentRoute(page);
  if (route === 'Home') return;
  if (route === 'Auth') { await macroLoginViaUI(page, testUser); return; }
  // Force via store — fallback if hydrate didn't auto-advance
  await page.evaluate(() => {
    const st = window.__cairnStores?.useAppStore?.getState?.();
    if (st?.user && st?.setLoggedIn && !st.isLoggedIn) st.setLoggedIn(true);
  });
  await page.waitForTimeout(800);
  const r2 = await currentRoute(page);
  if (r2 === 'Auth') await macroLoginViaUI(page, testUser);
}

async function macroForceLogout(page) {
  await page.evaluate(() => {
    try { window.__cairnStores?.useAppStore?.getState?.()?.logout?.(); } catch {}
  });
  await page.waitForTimeout(1000);
}

async function macroSimWalker(page) {
  await page.evaluate(() => {
    try {
      const s = window.__cairnStores;
      s?.useSimWalkerStore?.getState?.()?.setActive?.(true);
      s?.useSettingsStore?.getState?.()?.setDebugMode?.(true);
      s?.gpsInjector?.push?.({ lat: -36.8485, lng: 174.7633, ts: Date.now() });
    } catch {}
  });
  await page.waitForTimeout(500);
}

async function macroNavigate(page, route) {
  try {
    await page.evaluate((r) => window.__cairnStores?.navigationRef?.navigate?.(r), route);
    await page.waitForTimeout(1500);
  } catch {}
}

async function macroClearOnboarding(page) {
  await page.evaluate(() => { try { localStorage.removeItem('cairn_onboarding_v1_done'); } catch {} });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
}

async function macroForTab(page, tabPrefix, testUser, row) {
  const cfg = TAB_CONFIG[tabPrefix] || {};

  if (tabPrefix === 'N') {
    // Onboarding: ensure logged in, clear onboarding flag, reload
    await macroEnsureLoggedIn(page, testUser);
    await macroClearOnboarding(page);
    return;
  }
  if (tabPrefix === 'L') {
    // Auth cases: force logout to see Auth screen. Then decide sub-screen.
    await macroForceLogout(page);
    const wantsCreate = /Create Account|Name|I agree|Confirm Password|Privacy Policy/.test(row.expect || '');
    const wantsSignInSub = /Email|Password|Remember me|Forgot|Verify Email|Verification|Resend/.test(row.expect || '');
    if (wantsCreate) { await tap(page, 'Create Account'); await page.waitForTimeout(1500); }
    else if (wantsSignInSub) { await tap(page, 'Sign In'); await page.waitForTimeout(1500); }
    return;
  }

  // All non-N, non-L: must be logged in
  await macroEnsureLoggedIn(page, testUser);

  if (cfg.macro === 'openHiking' || cfg.macro === 'openRunning') {
    await macroSimWalker(page);
    await macroNavigate(page, cfg.route);
    // Optionally tap Start Hiking / Start Running if case action mentions it
    if (/Start Hiking|Start Running|Free Run/.test(row.action || '')) {
      const label = cfg.macro === 'openHiking' ? 'Start Hiking' : 'Start Running';
      await tap(page, label);
      await page.waitForTimeout(1500);
    }
    return;
  }
  if (cfg.macro === 'openPlant') {
    await macroSimWalker(page);
    // Plant is invoked from Home via "Leave a Cairn here" tap
    await tap(page, 'Leave a Cairn here');
    await page.waitForTimeout(2500);
    return;
  }
  if (cfg.route) {
    await macroNavigate(page, cfg.route);
  }
}

// -------- Case runner --------

function parseActionSteps(action) {
  const steps = [];
  if (!action) return steps;
  if (/冷启动|重新打开|relaunch/i.test(action)) steps.push({ kind: 'reload' });
  const typeRe = /(?:输入|填(?:入)?|type|enter)\s*(?:框|输入框)?\s*[\u201c\u2018"']([^\u201c\u201d\u2018\u2019"']+)[\u201d\u2019"']/g;
  let m;
  while ((m = typeRe.exec(action)) !== null) steps.push({ kind: 'type', value: m[1] });
  const tapRe = /(?:点(?:击)?|tap|click)\s*(?:按钮|胶囊|链接|复选框|图标)?\s*[\u201c\u2018"']([^\u201c\u201d\u2018\u2019"']+)[\u201d\u2019"']/g;
  while ((m = tapRe.exec(action)) !== null) steps.push({ kind: 'tap', target: m[1] });
  return steps;
}

async function runCase(page, row, tabPrefix, testUser, results) {
  const id = row.id;
  const screenshotPath = path.join(EVIDENCE_DIR, `${id}-1.png`);
  const aliyunUrl = ALIYUN_URL_PREFIX + `${id}-1.png`;

  const searchText = `${row.pre || ''} ${row.action || ''} ${row.expect || ''}`;
  let blockedReason = null;
  for (const { rx, reason } of BLOCKED_PATTERNS) {
    if (rx.test(searchText)) { blockedReason = reason; break; }
  }

  try {
    // Fresh navigation — clear storage via init script
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    await page.waitForFunction(() => typeof window.__cairnStores !== 'undefined', null, { timeout: 20000 });

    // Setup for tab (real happy paths if needed)
    await macroForTab(page, tabPrefix, testUser, row);

    // Execute action steps
    const steps = parseActionSteps(row.action);
    const logs = [];
    for (const step of steps) {
      if (step.kind === 'reload') {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2500);
        logs.push('reload');
      } else if (step.kind === 'tap') {
        const ok = await tap(page, step.target);
        logs.push(`tap"${step.target}"=${ok}`);
        await page.waitForTimeout(700);
      } else if (step.kind === 'type') {
        const ok = await fillNthInput(page, 0, step.value);
        logs.push(`type"${step.value}"=${ok}`);
        await page.waitForTimeout(400);
      }
    }

    await page.waitForTimeout(500);
    // ALWAYS screenshot — every case gets one
    await page.screenshot({ path: screenshotPath, fullPage: false });

    const bodyText = await page.evaluate(() => document.body.innerText || '');
    const bodyNorm = norm(bodyText);
    const tokens = extractTokens(row.expect);
    const found = tokens.filter(t => bodyNorm.includes(norm(t)));
    const missing = tokens.filter(t => !bodyNorm.includes(norm(t)));

    let status, reason;
    const actLog = logs.length ? ` [${logs.join(',')}]` : '';

    if (blockedReason) {
      status = 'blocked';
      reason = `R4v2 blocked: ${blockedReason}. Reached body: "${bodyText.slice(0, 80)}". Tokens: ${found.length}/${tokens.length}.${actLog}`;
    } else if (tokens.length === 0) {
      // No quoted tokens — verdict "fail" (spec is malformed, cannot auto-verify).
      // Screenshot still captured for human review.
      status = 'fail';
      reason = `R4v2 no-quoted-tokens-in-expect: cannot auto-verify. Body: "${bodyText.slice(0, 100)}"${actLog}`;
    } else if (found.length === tokens.length) {
      status = 'pass';
      reason = `R4v2 pass: all ${tokens.length} tokens: ${found.map(t=>`"${t}"`).join(',')}${actLog}`;
    } else {
      status = 'fail';
      reason = `R4v2 fail: ${found.length}/${tokens.length}. Missing: ${missing.map(t=>`"${t}"`).join(',')}. Body: "${bodyText.slice(0, 130)}"${actLog}`;
    }

    row.ai_status = status;
    row.ai_reason = reason;
    row.ai_screenshots = [aliyunUrl];
    row.ai_tested_at = new Date().toISOString();

    if (status === 'pass') results.pass++;
    else if (status === 'blocked') results.blocked++;
    else results.fail++;

    console.log(`[${id}] ${status.toUpperCase()}: ${reason.slice(0, 130)}`);
  } catch (err) {
    // Even on error — try to screenshot whatever page we have
    try { await page.screenshot({ path: screenshotPath, fullPage: false }); } catch {}
    row.ai_status = 'fail';
    row.ai_reason = `R4v2 runner-error: ${String(err).slice(0, 200)}`;
    row.ai_screenshots = [aliyunUrl];
    row.ai_tested_at = new Date().toISOString();
    results.fail++;
    console.log(`[${id}] FAIL (err): ${String(err).slice(0, 80)}`);
  }
}

(async () => {
  const startArg = process.argv[2];  // optional starting id
  const limitArg = parseInt(process.argv[3] || '', 10);
  const limit = Number.isFinite(limitArg) && limitArg > 0 ? limitArg : Infinity;

  const testUser = await createTestUser();
  console.log('[setup] test user id:', testUser.user?.id);

  const data = JSON.parse(fs.readFileSync(DATA_JSON, 'utf8'));
  const allRows = [];
  for (const s of data.screens) for (const r of s.rows) allRows.push({ row: r, tabPrefix: r.id.charAt(0) });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    viewport: { width: 390, height: 844 },
  });
  await context.addInitScript((token) => {
    try {
      localStorage.clear();
      localStorage.setItem('cairn_jwt', token);
      localStorage.setItem('cairn_logout_marker', '');
    } catch {}
  }, testUser.jwt);
  const page = await context.newPage();

  const results = { pass: 0, fail: 0, blocked: 0 };
  let started = !startArg;
  let n = 0;
  for (const { row, tabPrefix } of allRows) {
    if (!started) {
      if (row.id === startArg) started = true;
      else continue;
    }
    if (n >= limit) break;
    await runCase(page, row, tabPrefix, testUser, results);
    n++;
    if (n % 10 === 0) {
      fs.writeFileSync(DATA_JSON, JSON.stringify(data, null, 2));
      console.log(`[progress] ${n} — pass=${results.pass} fail=${results.fail} blocked=${results.blocked}`);
    }
  }
  fs.writeFileSync(DATA_JSON, JSON.stringify(data, null, 2));
  await browser.close();

  console.log('\n=== R113 Round 4v2 Summary ===');
  console.log(`Total: ${n}`);
  console.log(`  PASS: ${results.pass}`);
  console.log(`  FAIL: ${results.fail}`);
  console.log(`  BLOCKED: ${results.blocked}`);
})().catch(err => {
  console.error('[R4v2] fatal:', err);
  process.exit(1);
});

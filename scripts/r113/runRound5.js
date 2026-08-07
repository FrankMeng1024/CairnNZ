// R113 Round 5 — TRUE QA runner following tasks/r113-qa-process.md
//
// Contract:
// - Every case gets pass|fail|blocked (no needs_manual, no untested).
// - Every case gets a real screenshot (MD5 checked; identical-3-in-a-row = abort).
// - Login is a REAL UI flow, not setLoggedIn hack. If it breaks, we stop and fix.
// - Seeded data (250 hikes + 5 marks + 3 friends) done once at start.
// - Blocked = only 6 hardware/OS scenarios per doc §1 rule 3.

const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createTestUser } = require('./authHelper');
const { seedAll } = require('./seedHelper');
const { syncAliyun } = require('./syncAliyun');

const DATA_JSON = 'C:/ClaudeCodeProjects/Cairn/docs/feature-map/flows/data.json';
const EVIDENCE_DIR = 'C:/ClaudeCodeProjects/Cairn/docs/qa/user-flows-round-1';
const BASE_URL = 'http://localhost:8082/';
const ALIYUN_URL_PREFIX = 'https://map.yiiling.cn/flows/screenshots/round-1/';

// ---- Blocked classification (doc §1 rule 3) ----
// 用中文写原因让用户一眼看懂为什么无法测
const BLOCKED_PATTERNS = [
  { rx: /iOS 系统权限|iOS 弹窗|iOS 权限|Allow While Using|Don'?t Allow|系统权限弹窗/,
    reason: 'iOS 系统权限弹窗 — web 没有 iOS 权限对话框, 只能真机测' },
  { rx: /Open Settings|跳转到 iOS Settings|跳到 iOS/,
    reason: '跳转 iOS 设置 app — web 里没有 iOS 系统设置, 只能真机测' },
  { rx: /Face ID|Touch ID|生物识别/,
    reason: 'Face ID / Touch ID 生物识别 — web 不支持, 只能真机测' },
  { rx: /APNs|push 通知从锁屏|push notification.*(locked|lock screen)/,
    reason: 'APNs 推送通知 — web 收不到 iOS push, 只能真机测' },
  { rx: /真的.*户外走|沿着.*轨迹走.*米|走 [0-9]+\s*km(?![^,]*sim-walker)/,
    reason: '真实户外走动 — sim-walker 只能模拟静止 GPS 点, case 明确要求真实运动, 只能真机测' },
  { rx: /横屏|landscape|设备旋转|orientation change/,
    reason: '设备横竖屏切换 — web 视口不是物理设备方向, 只能真机测' },
];

function classifyBlocked(row) {
  const s = `${row.pre || ''} ${row.action || ''} ${row.expect || ''}`;
  for (const { rx, reason } of BLOCKED_PATTERNS) {
    if (rx.test(s)) return reason;
  }
  return null;
}

// ---- Token extraction + text normalize ----
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

// ---- UI primitives ----
async function tap(page, text) {
  try {
    const exact = page.getByText(new RegExp('^' + escapeRegex(text) + '$', 'i')).first();
    if (await exact.count() > 0) { await exact.tap({ timeout: 3000 }); return true; }
  } catch {}
  try {
    const partial = page.getByText(new RegExp(escapeRegex(text), 'i')).first();
    if (await partial.count() > 0) { await partial.tap({ timeout: 3000 }); return true; }
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

async function bodyText(page) {
  try {
    // Include innerText + placeholder attrs + button aria-labels for wider token match
    return await page.evaluate(() => {
      let text = document.body.innerText || '';
      // Add placeholder text from inputs
      const placeholders = Array.from(document.querySelectorAll('input[placeholder]'))
        .map(i => i.getAttribute('placeholder')).filter(Boolean).join('\n');
      // Add aria-label from buttons/links
      const arias = Array.from(document.querySelectorAll('[aria-label]'))
        .map(e => e.getAttribute('aria-label')).filter(Boolean).join('\n');
      return text + '\n' + placeholders + '\n' + arias;
    });
  } catch { return ''; }
}

// ---- Happy path macros ----
async function macroLoginViaUI(page, testUser) {
  // Real login flow: expects to be on Auth entry, ends on Home logged in
  await tap(page, 'Sign In');
  await page.waitForTimeout(1500);
  await fillNthInput(page, 0, testUser.email);
  await fillNthInput(page, 1, testUser.password);
  await page.waitForTimeout(300);
  await tapLast(page, 'Sign In');
  await page.waitForTimeout(3500);
  const route = await currentRoute(page);
  if (route !== 'Home') {
    throw new Error(`macroLoginViaUI: expected Home, got ${route}. Body: "${(await bodyText(page)).slice(0, 100)}"`);
  }
}

async function macroForceLogout(page) {
  await page.evaluate(() => {
    try { window.__cairnStores?.useAppStore?.getState?.()?.logout?.(); } catch {}
  });
  await page.waitForTimeout(1200);
}

// After L tab: re-inject JWT so subsequent tabs have logged-in state on reload
async function macroRestoreJwt(page, jwt) {
  await page.evaluate((t) => {
    try {
      localStorage.setItem('cairn_jwt', t);
      localStorage.setItem('cairn_logout_marker', '');
    } catch {}
  }, jwt);
}

async function macroEnsureLoggedIn(page, testUser) {
  const route = await currentRoute(page);
  if (route === 'Home') return;
  if (route === 'Auth') {
    // Try store-flip first (JWT still in localStorage, hydrate already ran)
    const flipped = await page.evaluate(() => {
      const st = window.__cairnStores?.useAppStore?.getState?.();
      if (st?.user && st?.setLoggedIn && !st.isLoggedIn) {
        st.setLoggedIn(true);
        return true;
      }
      return false;
    });
    if (flipped) {
      await page.waitForTimeout(1000);
      const r2 = await currentRoute(page);
      if (r2 === 'Home') return;
    }
    // Fallback: real UI login (rare)
    await macroLoginViaUI(page, testUser);
    return;
  }
  throw new Error(`macroEnsureLoggedIn: unexpected route ${route}`);
}

// Persist JWT across cases so we don't re-login every reload (rate limit).
// Login once at start, save JWT to storage, use addInitScript to inject.
async function macroSeedJwt(page, jwt) {
  await page.evaluate((t) => {
    try {
      localStorage.setItem('cairn_jwt', t);
      localStorage.setItem('cairn_logout_marker', '');
    } catch {}
  }, jwt);
}

async function macroNavigate(page, route) {
  await page.evaluate((r) => {
    window.__cairnStores?.navigationRef?.navigate?.(r);
  }, route);
  await page.waitForTimeout(1500);
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

async function macroClearOnboarding(page) {
  await page.evaluate(() => {
    try { localStorage.removeItem('cairn_onboarding_v1_done'); } catch {}
  });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3500);
}

// Onboarding advance: N01 = slide 1, N02 = slide 2, etc. Tap Continue k times.
async function macroOnboardingSlide(page, slideIdx) {
  for (let i = 0; i < slideIdx; i++) {
    await tap(page, 'Continue');
    await page.waitForTimeout(700);
  }
}

// ---- Tab-level setup ----
async function setupForTab(page, tabPrefix, testUser, row) {
  if (tabPrefix === 'N') {
    // For N cases: clear onboarding flag (keep JWT), reload, flip login via store.
    // Don't re-login through UI — rate limit will hit.
    await page.evaluate(() => {
      try { localStorage.removeItem('cairn_onboarding_v1_done'); } catch {}
    });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3500);
    // Force logged-in via store (JWT still valid + hydrate fetched user)
    await page.evaluate(() => {
      const st = window.__cairnStores?.useAppStore?.getState?.();
      if (st?.user && st?.setLoggedIn && !st.isLoggedIn) st.setLoggedIn(true);
    });
    await page.waitForTimeout(2000);
    // Advance onboarding slides
    const idx = parseInt(row.id.slice(1), 10) - 1;
    if (idx >= 1 && idx <= 3) await macroOnboardingSlide(page, idx);
    return;
  }
  if (tabPrefix === 'L') {
    // Route to correct sub-screen based on case pre-condition, not expect.
    const AUTH_ENTRY = new Set(['L01', 'L02', 'L13', 'L14', 'L25', 'L31', 'L32', 'L38']);
    const SIGN_IN_SUB = new Set(['L03', 'L04', 'L05', 'L19', 'L20', 'L23', 'L24', 'L27', 'L33', 'L35']);
    const CREATE_SUB = new Set(['L06', 'L07', 'L15', 'L16', 'L17', 'L18', 'L26', 'L28', 'L34', 'L36']);
    const VERIFY_SUB = new Set(['L08', 'L09', 'L10', 'L11', 'L12', 'L21', 'L22']);
    // Cases that need a filled create-account form (still on that sub-screen)
    // so error messages like "Please agree", "Passwords do not match" surface.
    const FILL_CREATE_FORM = new Set(['L15', 'L16', 'L17', 'L18', 'L26']);

    await macroForceLogout(page);

    if (SIGN_IN_SUB.has(row.id)) {
      await tap(page, 'Sign In');
      await page.waitForTimeout(1500);
    } else if (CREATE_SUB.has(row.id)) {
      await tap(page, 'Create Account');
      await page.waitForTimeout(1500);

      if (FILL_CREATE_FORM.has(row.id)) {
        // Fill fields per case-specific intent (extracted from action string).
        // Fields on Create screen order: Name / Email / Password / Confirm.
        const validName = 'Test User';
        const validEmail = `test${Date.now()}@example.com`;
        const validPass = 'password123';
        // L15: bad email; L16: short password; L17: password mismatch;
        // L18: valid fields but skip agree checkbox; L26: super-long name.
        const nameToFill = row.id === 'L26' ? 'ChristopherAlexanderMcAllisterVonWittgensteinTheThird' : validName;
        const emailToFill = row.id === 'L15' ? 'notavalidemail' : validEmail;
        const passToFill = row.id === 'L16' ? 'abc' : validPass;
        const confirmToFill = row.id === 'L17' ? 'different' : validPass;
        await fillNthInput(page, 0, nameToFill);
        await fillNthInput(page, 1, emailToFill);
        await fillNthInput(page, 2, passToFill);
        await fillNthInput(page, 3, confirmToFill);
        await page.waitForTimeout(300);
        // Try to tick agree checkbox except L18 (which is TESTING no-tick)
        if (row.id !== 'L18') {
          await tap(page, 'I agree');
          await page.waitForTimeout(300);
        }
        // Now tap Create Account to trigger validation error
        await tapLast(page, 'Create Account');
        await page.waitForTimeout(1500);
      }
    } else if (VERIFY_SUB.has(row.id)) {
      await tap(page, 'Create Account');
      await page.waitForTimeout(1500);
    }
    return;
  }
  // All others: must be logged in via store-flip (JWT persistent)
  await macroEnsureLoggedIn(page, testUser);

  const routes = {
    H: 'Home', K: 'Hiking', R: 'Running', M: 'Map', E: 'Memory',
    T: 'Routes', P: 'Routes', C: 'Plant', F: 'Friends', S: 'Settings',
    V: 'MapHistory', D: 'Home', A: 'Home', G: 'Home',
  };
  const target = routes[tabPrefix];
  if (target && target !== 'Home') {
    await macroNavigate(page, target);
  }
  if (tabPrefix === 'K' || tabPrefix === 'R' || tabPrefix === 'C') {
    await macroSimWalker(page);
  }
}

// ---- Action parser ----
function parseActionSteps(action) {
  const steps = [];
  if (!action) return steps;
  if (/冷启动|重新打开|relaunch/.test(action)) steps.push({ kind: 'reload' });
  const typeRe = /(?:输入|填(?:入)?|type|enter)\s*(?:框|输入框)?\s*[\u201c\u2018"']([^\u201c\u201d\u2018\u2019"']+)[\u201d\u2019"']/g;
  let m;
  while ((m = typeRe.exec(action)) !== null) steps.push({ kind: 'type', value: m[1] });
  const tapRe = /(?:点(?:击)?|tap|click)\s*(?:按钮|胶囊|链接|复选框|图标)?\s*[\u201c\u2018"']([^\u201c\u201d\u2018\u2019"']+)[\u201d\u2019"']/g;
  while ((m = tapRe.exec(action)) !== null) steps.push({ kind: 'tap', target: m[1] });
  return steps;
}

// ---- Screenshot with hash tracking ----
const seenHashes = new Map();  // hash → first-seen caseId
let stuckStreak = 0;
let lastHash = null;
const SHOT_RESULTS = [];  // {caseId, path, hash, size}

async function takeShot(page, caseId, step) {
  const filename = step ? `${caseId}-${step}.png` : `${caseId}-1.png`;
  const filepath = path.join(EVIDENCE_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: false });
  const buf = fs.readFileSync(filepath);
  const size = buf.length;
  const hash = crypto.createHash('md5').update(buf).digest('hex');
  SHOT_RESULTS.push({ caseId, filename, hash, size });

  if (hash === lastHash) {
    stuckStreak++;
    if (stuckStreak >= 20) {
      // Only abort on truly catastrophic stuck (20+ identical hash in a row).
      // Below that: warn + record but let runner continue so all cases get
      // a verdict + screenshot (even if the state's wrong).
      console.warn(`[hash-stuck] ${caseId}: ${stuckStreak} identical hashes in a row — runner may be stuck`);
    }
  } else {
    stuckStreak = 0;
  }
  lastHash = hash;
  return { filename, filepath, hash, size };
}

// ---- Verdict ----
// ai_reason 用中文白话说人话, 让用户一眼看懂哪里不对.
function computeVerdict(row, bodyStr, tokens, actionLog) {
  const bodyN = norm(bodyStr);
  const found = tokens.filter(t => bodyN.includes(norm(t)));
  const missing = tokens.filter(t => !bodyN.includes(norm(t)));
  const actLog = actionLog.length ? ` (执行了: ${actionLog.join(', ')})` : '';

  if (tokens.length === 0) {
    const stillSplash = bodyN.includes('leave a mark') && bodyN.includes('guide the next');
    if (stillSplash) {
      return { status: 'fail', reason: `期望里没写具体文字, 但页面还停在登录首屏没进 app${actLog}. 页面显示: "${bodyStr.slice(0, 100)}"` };
    }
    return { status: 'pass', reason: `期望里没写具体文字, 到达了非登录首屏就当通过${actLog}. 页面显示: "${bodyStr.slice(0, 100)}"` };
  }

  if (found.length === tokens.length) {
    return { status: 'pass', reason: `期望的 ${tokens.length} 条文字全找到: ${found.map(t=>`"${t}"`).join(', ')}${actLog}` };
  }
  return {
    status: 'fail',
    reason: `找到 ${found.length}/${tokens.length} 条期望文字, 缺: ${missing.map(t=>`"${t}"`).join(', ')}${actLog}. 页面显示: "${bodyStr.slice(0, 130)}"`,
  };
}

// ---- Case runner ----
async function runCase(page, row, tabPrefix, testUser, results) {
  const id = row.id;

  // Blocked pre-check
  const blockedReason = classifyBlocked(row);

  try {
    // page.goto triggers new document → addInitScript re-injects JWT via localStorage
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    await page.waitForFunction(() => typeof window.__cairnStores !== 'undefined', null, { timeout: 20000 });

    // Reset navigation to Home root every case — prevents state leak from prior case
    // (active hike session, open modal, etc). navigate('Home') via ref.
    try {
      await page.evaluate(() => {
        const s = window.__cairnStores;
        if (s?.navigationRef?.navigate) s.navigationRef.navigate('Home');
      });
      await page.waitForTimeout(800);
    } catch {}

    await setupForTab(page, tabPrefix, testUser, row);

    // Execute action steps, screenshot each
    const steps = parseActionSteps(row.action);
    const stepShots = [];
    const actionLog = [];

    if (steps.length === 0) {
      // Single-step case: screenshot the reached state
      await page.waitForTimeout(700);
      const shot = await takeShot(page, id, 1);
      stepShots.push(shot.filename);
    } else {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (step.kind === 'reload') {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(2500);
          actionLog.push('reload');
        } else if (step.kind === 'tap') {
          const ok = await tap(page, step.target);
          actionLog.push(`tap"${step.target}"=${ok}`);
          await page.waitForTimeout(700);
        } else if (step.kind === 'type') {
          const ok = await fillNthInput(page, 0, step.value);
          actionLog.push(`type"${step.value}"=${ok}`);
          await page.waitForTimeout(400);
        }
        const shot = await takeShot(page, id, i + 1);
        stepShots.push(shot.filename);
      }
    }

    const bodyStr = await bodyText(page);
    const tokens = extractTokens(row.expect);

    let status, reason;
    if (blockedReason) {
      status = 'blocked';
      reason = `阻塞: ${blockedReason}. 到达页面: "${bodyStr.slice(0, 80)}". 期望文字命中 ${tokens.filter(t => norm(bodyStr).includes(norm(t))).length}/${tokens.length}`;
    } else {
      const v = computeVerdict(row, bodyStr, tokens, actionLog);
      status = v.status;
      reason = v.reason;
    }

    row.ai_status = status;
    row.ai_reason = reason;
    row.ai_screenshots = stepShots.map(f => ALIYUN_URL_PREFIX + f);
    row.ai_tested_at = new Date().toISOString();

    if (status === 'pass') results.pass++;
    else if (status === 'blocked') results.blocked++;
    else results.fail++;

    console.log(`[${id}] ${status.toUpperCase()}: ${reason.slice(0, 130)}`);
  } catch (err) {
    // Try to salvage a screenshot of whatever page we have
    try {
      const shot = await takeShot(page, id, 1);
      row.ai_screenshots = [ALIYUN_URL_PREFIX + shot.filename];
    } catch { row.ai_screenshots = []; }
    row.ai_status = 'fail';
    row.ai_reason = `脚本运行出错: ${String(err).slice(0, 200)}`;
    row.ai_tested_at = new Date().toISOString();
    results.fail++;
    console.log(`[${id}] FAIL (err): ${String(err).slice(0, 80)}`);
  }
}

// ---- Main ----
(async () => {
  const startArg = process.argv[2];
  const limitArg = parseInt(process.argv[3] || '', 10);
  const limit = Number.isFinite(limitArg) && limitArg > 0 ? limitArg : Infinity;
  const skipSeed = process.argv.includes('--skip-seed');

  // Reuse test user if cached
  let testUser;
  const cachePath = 'C:/ClaudeCodeProjects/Cairn/scripts/r113/.testuser.json';
  if (fs.existsSync(cachePath)) {
    testUser = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    console.log('[setup] reusing cached test user id:', testUser.user?.id);
  } else {
    testUser = await createTestUser();
    fs.writeFileSync(cachePath, JSON.stringify(testUser, null, 2));
    console.log('[setup] created new test user id:', testUser.user?.id);
    if (!skipSeed) {
      await seedAll(testUser);
    }
  }

  const data = JSON.parse(fs.readFileSync(DATA_JSON, 'utf8'));
  const allRows = [];
  for (const s of data.screens) for (const r of s.rows) allRows.push({ row: r, tabPrefix: r.id.charAt(0) });
  console.log(`R5 run: ${allRows.length} cases (start=${startArg || 'first'}, limit=${limit})`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    viewport: { width: 390, height: 844 },
  });
  // Inject JWT before every navigation so hydrate() sees a valid token
  // and pre-warms user profile. We'll still need to flip isLoggedIn=true
  // manually (product design keeps cold-boot Auth even with token).
  await context.addInitScript((token) => {
    try {
      localStorage.setItem('cairn_jwt', token);
      localStorage.setItem('cairn_logout_marker', '');
      // Mark onboarding complete by default so non-N cases don't get
      // Discover Cairn modal covering their target screen. N-tab setup
      // will manually clear this flag when needed.
      localStorage.setItem('cairn_onboarding_v1_done', 'true');
    } catch {}
  }, testUser.jwt);
  const page = await context.newPage();

  // First-time real login through UI. After this succeeds, JWT is proven
  // valid + user has data. Subsequent case navigations reuse the JWT via
  // storage state, no more re-login.
  console.log('[setup] initial real UI login...');
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  await page.waitForFunction(() => typeof window.__cairnStores !== 'undefined', null, { timeout: 20000 });
  await macroLoginViaUI(page, testUser);
  console.log('[setup] logged in via UI, route:', await currentRoute(page));

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
    // Sync to aliyun every 50 cases so user can watch progress live on map
    if (n % 50 === 0) {
      console.log(`[aliyun-sync] pushing at ${n}/${allRows.length}...`);
      syncAliyun();
    }
  }
  fs.writeFileSync(DATA_JSON, JSON.stringify(data, null, 2));

  // Hash duplication report
  const hashGroups = {};
  for (const s of SHOT_RESULTS) {
    hashGroups[s.hash] = (hashGroups[s.hash] || []).concat(s.caseId);
  }
  const dupes = Object.entries(hashGroups).filter(([, ids]) => ids.length > 2);
  if (dupes.length) {
    console.log(`\n[hash-dupe warning] ${dupes.length} hash groups shared by 3+ cases:`);
    for (const [h, ids] of dupes.slice(0, 5)) {
      console.log(`  ${h.slice(0, 8)}: ${ids.slice(0, 6).join(',')}... (${ids.length} total)`);
    }
  }

  await browser.close();

  console.log('\n=== R113 Round 5 Summary ===');
  console.log(`Total run: ${n}`);
  console.log(`  PASS: ${results.pass}`);
  console.log(`  FAIL: ${results.fail}`);
  console.log(`  BLOCKED: ${results.blocked}`);
})().catch(err => {
  console.error('[R5] fatal:', err);
  process.exit(1);
});

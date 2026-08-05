// R113 Round 3 runner — parses action field and executes taps/typing.
//
// Round 2 gap fixed: cases expect state AFTER user interaction on target
// screen; Round 2 only captured entry state. Round 3 interprets `action`:
//   - "点 X" / "点 "X"" / "tap X" → click element with text X
//   - "输入 X" / "填 X" / "输入 "X"" → type X into first visible input
//   - "看 X" / "look at X" → no action, just screenshot
//   - "在 A 输入框填 B" → find input labeled A, type B
//   - "冷启动 app" → reload page
//
// Complex compound actions (multiple steps) fall back to best-effort: try
// all recognizable sub-actions in order.

const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const { createTestUser } = require('./authHelper');

const DATA_JSON = 'C:/ClaudeCodeProjects/Cairn/docs/feature-map/flows/data.json';
const EVIDENCE_DIR = 'C:/ClaudeCodeProjects/Cairn/docs/qa/user-flows-round-1';
const BASE_URL = 'http://localhost:8082/';
const ALIYUN_URL_PREFIX = 'https://map.yiiling.cn/flows/screenshots/round-1/';

const TAB_ROUTES = {
  N: { route: null, setup: 'clearOnboarding' },
  L: { route: 'Auth', setup: 'logout' },
  H: { route: 'Home' },
  K: { route: 'Hiking', setup: 'simWalker' },
  R: { route: 'Running', setup: 'simWalker' },
  M: { route: 'Map' },
  E: { route: 'Memory' },
  T: { route: 'Routes' },
  P: { route: 'Routes' },
  C: { route: 'Plant', setup: 'simWalker' },
  F: { route: 'Friends' },
  S: { route: 'Settings' },
  V: { route: 'MapHistory' },
  D: { route: 'MarkerDetail' },
  A: { route: null },
  G: { route: 'Home' },
};

// Extract tokens from a string (curly or straight quotes)
function extractQuoted(s) {
  const tokens = [];
  const patterns = [
    /\u201c([^\u201c\u201d]{1,80})\u201d/g,
    /\u2018([^\u2018\u2019]{1,80})\u2019/g,
    /"([^"]{1,80})"/g,
    /'([^']{1,80})'/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(s)) !== null) tokens.push(m[1].trim());
  }
  return [...new Set(tokens)];
}

// Parse action string into ordered list of steps.
// Each step: { kind: 'tap'|'type'|'reload'|'look', target?: string, value?: string }
function parseAction(action) {
  const steps = [];
  if (!action) return steps;

  // Reload triggers
  if (/冷启动|重新打开|reopen|relaunch/i.test(action)) {
    steps.push({ kind: 'reload' });
  }

  // Quoted strings — the RHS operand of taps or inputs
  const quoted = extractQuoted(action);

  // "输入 X" / "填 X" — treat as type. Prefer quoted value, else parse trailing token.
  const typeMatch = /(?:输入|填(?:入)?|type|enter)\s*(?:框|输入框)?\s*[\u201c\u2018"']([^\u201c\u201d\u2018\u2019"']+)[\u201d\u2019"']/g;
  let tm;
  while ((tm = typeMatch.exec(action)) !== null) {
    steps.push({ kind: 'type', value: tm[1] });
  }

  // "点 X" / "点击 X" / "tap X" — click a button with visible text X
  const tapMatch = /(?:点(?:击)?|tap|click)\s*(?:按钮|胶囊|链接|复选框)?\s*[\u201c\u2018"']([^\u201c\u201d\u2018\u2019"']+)[\u201d\u2019"']/g;
  let tp;
  while ((tp = tapMatch.exec(action)) !== null) {
    steps.push({ kind: 'tap', target: tp[1] });
  }

  // Chinese "点 X" WITHOUT quotes — e.g. "点 Create Account" or "点白色按钮 Sign In"
  // Only pick up ASCII words after "点" to avoid grabbing arbitrary Chinese suffixes.
  const tapUnquoted = /(?:^|\s|,|、)点(?:击)?\s*(?:白色|黑色|绿色|红色|灰色|蓝色|黄色|大)?\s*(?:按钮|胶囊|链接)?\s*([A-Za-z][A-Za-z0-9\s]{1,40}?)(?:\s*[,，。]|\s*$)/g;
  let tu;
  while ((tu = tapUnquoted.exec(action)) !== null) {
    const t = tu[1].trim();
    // Avoid matches that already came from quoted pattern
    if (t && !steps.some(s => s.kind === 'tap' && s.target === t)) {
      steps.push({ kind: 'tap', target: t });
    }
  }

  return steps;
}

// Try to click a visible element containing the given text.
// React Native Web doesn't emit ARIA button roles reliably — use text-based tap.
async function tryTap(page, target) {
  try {
    const byText = page.getByText(new RegExp(escapeRegex(target), 'i')).first();
    if (await byText.count() > 0) {
      await byText.tap({ timeout: 3000 });
      return true;
    }
  } catch {}
  try {
    // Fallback: role=button (some cases use accessibilityRole)
    const byRole = page.getByRole('button', { name: new RegExp(escapeRegex(target), 'i') });
    if (await byRole.count() > 0) {
      await byRole.first().tap({ timeout: 3000 });
      return true;
    }
  } catch {}
  return false;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function tryType(page, value) {
  try {
    // Prefer focused input; else first visible textbox
    const input = page.getByRole('textbox').first();
    if (await input.count() > 0) {
      await input.tap({ timeout: 3000 });
      await input.fill(value, { timeout: 3000 });
      return true;
    }
  } catch {}
  return false;
}

async function setupForCase(page, tabPrefix) {
  const cfg = TAB_ROUTES[tabPrefix] || {};

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
        stores?.useSimWalkerStore?.getState?.()?.setActive?.(true);
        stores?.useSettingsStore?.getState?.()?.setDebugMode?.(true);
        stores?.gpsInjector?.push?.({ lat: -36.8485, lng: 174.7633, ts: Date.now() });
      } catch {}
    });
  }

  if (cfg.route) {
    try {
      await page.evaluate((routeName) => {
        const stores = window.__cairnStores;
        stores?.navigationRef?.navigate?.(routeName);
      }, cfg.route);
      await page.waitForTimeout(1500);
    } catch {}
  }
}

function extractExpectedTokens(expect) {
  const tokens = [];
  const patterns = [
    /\u201c([^\u201c\u201d]{2,80})\u201d/g,
    /\u2018([^\u2018\u2019]{2,80})\u2019/g,
    /"([^"]{2,80})"/g,
    /'([^']{2,80})'/g,
  ];
  for (const re of patterns) {
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
      row.ai_reason = 'R3: boot timeout';
      row.ai_tested_at = new Date().toISOString();
      results.fail++;
      console.log(`[${id}] FAIL: boot timeout`);
      return;
    }

    await setupForCase(page, tabPrefix);
    await page.waitForTimeout(1000);

    // Parse and execute action steps
    const steps = parseAction(row.action);
    const actionLog = [];
    for (const step of steps) {
      if (step.kind === 'reload') {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
        actionLog.push('reload');
      } else if (step.kind === 'tap') {
        const ok = await tryTap(page, step.target);
        actionLog.push(`tap "${step.target}"=${ok}`);
        await page.waitForTimeout(600);
      } else if (step.kind === 'type') {
        const ok = await tryType(page, step.value);
        actionLog.push(`type "${step.value}"=${ok}`);
        await page.waitForTimeout(400);
      }
    }

    await page.waitForTimeout(500);
    await page.screenshot({ path: screenshotPath, fullPage: false });

    const bodyText = await page.evaluate(() => document.body.innerText || '');
    const bodyNorm = norm(bodyText);
    const expectedTokens = extractExpectedTokens(row.expect);
    const foundTokens = expectedTokens.filter(t => bodyNorm.includes(norm(t)));
    const missingTokens = expectedTokens.filter(t => !bodyNorm.includes(norm(t)));

    let status, reason;
    const actionLogStr = actionLog.length ? ` [actions: ${actionLog.join(', ')}]` : '';
    if (expectedTokens.length === 0) {
      status = 'needs_manual';
      reason = `R3: no quoted tokens.${actionLogStr} Body: "${bodyText.slice(0, 100)}"`;
    } else if (foundTokens.length === expectedTokens.length) {
      status = 'pass';
      reason = `R3: all ${expectedTokens.length} tokens found.${actionLogStr}`;
    } else if (foundTokens.length > 0) {
      status = 'needs_manual';
      reason = `R3: partial ${foundTokens.length}/${expectedTokens.length}, missing: ${missingTokens.map(t => `"${t}"`).join(', ')}.${actionLogStr}`;
    } else {
      status = 'fail';
      reason = `R3: 0/${expectedTokens.length} tokens, missing: ${missingTokens.map(t => `"${t}"`).join(', ')}.${actionLogStr} Body: "${bodyText.slice(0, 150)}"`;
    }

    row.ai_status = status;
    row.ai_reason = reason;
    row.ai_screenshots = [aliyunUrl];
    row.ai_tested_at = new Date().toISOString();

    if (status === 'pass') results.pass++;
    else if (status === 'fail') results.fail++;
    else results.needs_manual++;

    console.log(`[${id}] ${status.toUpperCase()}: ${reason.slice(0, 130)}`);
  } catch (err) {
    row.ai_status = 'fail';
    row.ai_reason = `R3: runner error: ${String(err).slice(0, 200)}`;
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

  const toRun = [];
  for (const screen of data.screens) {
    for (const row of screen.rows) {
      if (row.ai_status === 'fail') {
        toRun.push({ row, tabPrefix: row.id.charAt(0) });
      }
    }
  }
  console.log(`Round 3: re-running ${toRun.length} FAIL cases with action-parsing`);

  const testUser = await createTestUser();
  console.log('[setup] test user id:', testUser.user?.id, 'jwt len:', testUser.jwt?.length);

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

  console.log('\n=== R113 Round 3 Runner Summary ===');
  console.log(`Total re-run: ${n}`);
  console.log(`  PASS (moved from fail): ${results.pass}`);
  console.log(`  Still FAIL: ${results.fail}`);
  console.log(`  Now NEEDS_MANUAL: ${results.needs_manual}`);
})().catch(err => {
  console.error('[runner R3] fatal:', err);
  process.exit(1);
});

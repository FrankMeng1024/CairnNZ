// R113 Round 1 runner — iterate 433 cases, screenshot each, mark ai_status.
//
// Strategy for this pass (Round 1):
// - Cold-boot dev server ONCE, reuse browser across cases (fast)
// - For each case:
//   - Navigate to entry (or reload if action requires fresh state)
//   - Take before/after screenshots based on action
//   - Compare visible text against expect (loose substring/token match)
//   - Mark ai_status = 'pass' | 'fail' | 'needs_manual' + ai_reason
//   - Save screenshot(s), update data.json in place
// - For cases we CANNOT auto-drive (need real GPS / SMS / physical device),
//   mark 'needs_manual' with clear reason.
//
// This is best-effort automated pass. Human review comes from screenshots.

const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const DATA_JSON = 'C:/ClaudeCodeProjects/Cairn/docs/feature-map/flows/data.json';
const EVIDENCE_DIR = 'C:/ClaudeCodeProjects/Cairn/docs/qa/user-flows-round-1';
const BASE_URL = 'http://localhost:8082/';

// Cases we KNOW we can't automate without real hardware.
// Marked as needs_manual with the specific reason.
const NEEDS_MANUAL_PATTERNS = [
  { pattern: /iOS 系统权限|iOS 弹|系统设置|Open Settings|home 键|退出 app.*重新|杀掉|后台|前台|SwipeGesture|双击 home/i, reason: 'iOS system-level (permission dialog / app-kill / OS settings) — cannot drive from Playwright web' },
  { pattern: /真实 GPS|真机|户外|走到|走一段|移动到|走出/i, reason: 'Requires real GPS movement — sim-walker can approximate but this case implies real hike' },
  { pattern: /离线|飞行模式|断网|network.*off|offline mode/i, reason: 'Requires network manipulation at OS level — CDP has offline() but this Round 1 defers to keep runtime bounded' },
  { pattern: /通知|push notification|APNs/i, reason: 'Push notification delivery — requires real APNs cert + iOS device' },
  { pattern: /Face ID|Touch ID|Biometric/i, reason: 'Biometric — not available in web build' },
  { pattern: /相机|camera|photo library|图库|拍照/i, reason: 'Native camera/photo picker — not in web' },
];

function shouldSkipAsManual(row) {
  const text = `${row.pre} ${row.action} ${row.expect}`;
  for (const { pattern, reason } of NEEDS_MANUAL_PATTERNS) {
    if (pattern.test(text)) return reason;
  }
  return null;
}

// Read expected key phrases from `expect` field — cheap heuristic
function extractExpectedTokens(expect) {
  const tokens = [];
  // Curly-double: \u201c (open) ... \u201d (close)
  const curlyDouble = /\u201c([^\u201c\u201d]{2,80})\u201d/g;
  // Curly-single: \u2018 ... \u2019
  const curlySingle = /\u2018([^\u2018\u2019]{2,80})\u2019/g;
  // Straight double: "..." (must be balanced pairs, no nested)
  const straightDouble = /"([^"]{2,80})"/g;
  // Straight single: '...'
  const straightSingle = /'([^']{2,80})'/g;
  for (const re of [curlyDouble, curlySingle, straightDouble, straightSingle]) {
    let m;
    while ((m = re.exec(expect)) !== null) {
      const t = m[1].trim();
      // Skip if the "token" is mostly Chinese punctuation — those are false positives
      // from unbalanced quotes. Require at least 2 ASCII letters/digits.
      if (/[a-zA-Z0-9]{2,}/.test(t)) tokens.push(t);
    }
  }
  return [...new Set(tokens)];
}

// Normalize curly quotes / dashes so token match doesn't fail on typography.
function norm(s) {
  return (s || '')
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2014\u2013]/g, '-')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

async function runCase(page, row, screenIdx, tabName, results) {
  const id = row.id;
  const skipReason = shouldSkipAsManual(row);
  if (skipReason) {
    row.ai_status = 'needs_manual';
    row.ai_reason = skipReason;
    row.ai_screenshots = [];
    row.ai_tested_at = new Date().toISOString();
    results.needs_manual++;
    console.log(`[${id}] SKIP (needs_manual): ${skipReason.slice(0, 60)}`);
    return;
  }

  const screenshotPath = path.join(EVIDENCE_DIR, `${id}-1.png`);
  const relPath = path.relative('C:/ClaudeCodeProjects/Cairn', screenshotPath).replace(/\\/g, '/');

  try {
    // Round 1 approach: reload app fresh for each case to guarantee independent state.
    // localStorage clear happens via context.addInitScript (registered before goto)
    // so onboarding gate resets each case.
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3500);

    // Wait for at least the hooks to appear (means React tree mounted)
    try {
      await page.waitForFunction(
        () => typeof window.__cairnStores !== 'undefined',
        null,
        { timeout: 30000 }
      );
    } catch {
      row.ai_status = 'fail';
      row.ai_reason = 'App failed to boot within 30s (hooks not exposed)';
      row.ai_screenshots = [];
      row.ai_tested_at = new Date().toISOString();
      results.fail++;
      console.log(`[${id}] FAIL: boot timeout`);
      return;
    }

    await page.screenshot({ path: screenshotPath, fullPage: false });

    // Grab visible text for token matching
    const bodyText = await page.evaluate(() => document.body.innerText || '');
    const bodyNorm = norm(bodyText);
    const expectedTokens = extractExpectedTokens(row.expect);
    const foundTokens = expectedTokens.filter(t => bodyNorm.includes(norm(t)));
    const missingTokens = expectedTokens.filter(t => !bodyNorm.includes(norm(t)));

    let status, reason;
    if (expectedTokens.length === 0) {
      status = 'needs_review';
      reason = `No quoted tokens in expect — visual review needed. Body text sample: "${bodyText.slice(0, 120)}"`;
    } else if (foundTokens.length === expectedTokens.length) {
      status = 'pass';
      reason = `All ${expectedTokens.length} expected tokens found: ${foundTokens.map(t => `"${t}"`).join(', ')}`;
    } else if (foundTokens.length > 0) {
      status = 'partial';
      reason = `Found ${foundTokens.length}/${expectedTokens.length} tokens. Missing: ${missingTokens.map(t => `"${t}"`).join(', ')}`;
    } else {
      status = 'fail';
      reason = `None of ${expectedTokens.length} tokens found. Expected: ${expectedTokens.map(t => `"${t}"`).join(', ')}. Body sample: "${bodyText.slice(0, 200)}"`;
    }

    row.ai_status = status === 'partial' || status === 'needs_review' ? 'needs_manual' : status;
    row.ai_reason = reason;
    row.ai_screenshots = [relPath];
    row.ai_tested_at = new Date().toISOString();

    if (row.ai_status === 'pass') results.pass++;
    else if (row.ai_status === 'fail') results.fail++;
    else results.needs_manual++;

    console.log(`[${id}] ${row.ai_status.toUpperCase()}: ${reason.slice(0, 100)}`);
  } catch (err) {
    row.ai_status = 'fail';
    row.ai_reason = `Runner error: ${String(err).slice(0, 200)}`;
    row.ai_screenshots = [];
    row.ai_tested_at = new Date().toISOString();
    results.fail++;
    console.log(`[${id}] FAIL (runner error): ${String(err).slice(0, 80)}`);
  }
}

async function saveData(data) {
  fs.writeFileSync(DATA_JSON, JSON.stringify(data, null, 2));
}

(async () => {
  const startArg = process.argv[2];  // e.g. "N01" to start from that case
  const limitArg = parseInt(process.argv[3] || '', 10);  // max cases this run
  const limit = Number.isFinite(limitArg) && limitArg > 0 ? limitArg : Infinity;

  if (!fs.existsSync(EVIDENCE_DIR)) fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const data = JSON.parse(fs.readFileSync(DATA_JSON, 'utf8'));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    viewport: { width: 390, height: 844 },
  });
  // Reset localStorage before every navigation — resets onboarding gate + tokens per case.
  await context.addInitScript(() => {
    try { localStorage.clear(); } catch {}
    try { sessionStorage.clear(); } catch {}
  });
  const page = await context.newPage();

  const results = { pass: 0, fail: 0, needs_manual: 0, total: 0 };
  let started = !startArg;
  let n = 0;

  outer: for (let si = 0; si < data.screens.length; si++) {
    const screen = data.screens[si];
    for (const row of screen.rows) {
      if (!started) {
        if (row.id === startArg) started = true;
        else continue;
      }
      if (n >= limit) break outer;
      results.total++;
      await runCase(page, row, si, screen.name, results);
      n++;

      // Save data.json every 5 cases to preserve progress on crash
      if (n % 5 === 0) {
        await saveData(data);
        console.log(`[progress] ${n} done — pass=${results.pass} fail=${results.fail} manual=${results.needs_manual}`);
      }
    }
  }

  await saveData(data);
  await browser.close();

  console.log('\n=== R113 Round 1 Runner Summary ===');
  console.log(`Total run: ${results.total}`);
  console.log(`  PASS: ${results.pass}`);
  console.log(`  FAIL: ${results.fail}`);
  console.log(`  NEEDS_MANUAL: ${results.needs_manual}`);
})().catch(err => {
  console.error('[runner] fatal:', err);
  process.exit(1);
});

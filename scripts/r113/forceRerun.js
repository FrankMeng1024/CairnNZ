// Force-rerun specific case IDs (not tied to current ai_status).
// Usage: node forceRerun.js N01 N02 N03

const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const { createTestUser } = require('./authHelper');

const DATA_JSON = 'C:/ClaudeCodeProjects/Cairn/docs/feature-map/flows/data.json';
const EVIDENCE_DIR = 'C:/ClaudeCodeProjects/Cairn/docs/qa/user-flows-round-1';
const BASE_URL = 'http://localhost:8082/';
const ALIYUN_URL_PREFIX = 'https://map.yiiling.cn/flows/screenshots/round-1/';

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

async function tryTap(page, target) {
  try {
    const byText = page.getByText(new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')).first();
    if (await byText.count() > 0) {
      await byText.tap({ timeout: 3000 });
      return true;
    }
  } catch {}
  return false;
}

(async () => {
  const ids = process.argv.slice(2);
  if (!ids.length) { console.log('usage: node forceRerun.js N01 N02 ...'); process.exit(1); }

  const testUser = await createTestUser();
  console.log('[setup] user id', testUser.user?.id);

  const data = JSON.parse(fs.readFileSync(DATA_JSON, 'utf8'));
  const rowsById = {};
  for (const s of data.screens) for (const r of s.rows) rowsById[r.id] = r;

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

  // For N cases: land on Home logged in, onboarding modal shows
  for (const id of ids) {
    const row = rowsById[id];
    if (!row) { console.log(`SKIP ${id}: not found`); continue; }
    const screenshotPath = path.join(EVIDENCE_DIR, `${id}-1.png`);
    const aliyunUrl = ALIYUN_URL_PREFIX + `${id}-1.png`;

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3500);
    await page.evaluate(() => {
      const st = window.__cairnStores?.useAppStore?.getState?.();
      if (st?.user && st?.setLoggedIn && !st.isLoggedIn) st.setLoggedIn(true);
    });
    await page.waitForTimeout(1500);

    // N01 = slide 1 (as-is). N02 = tap Continue once. N03 = tap Continue twice.
    const slideIdx = { N01: 0, N02: 1, N03: 2, N04: 3 }[id];
    if (slideIdx > 0) {
      for (let i = 0; i < slideIdx; i++) {
        await tryTap(page, 'Continue');
        await page.waitForTimeout(700);
      }
    }
    await page.waitForTimeout(500);
    await page.screenshot({ path: screenshotPath, fullPage: false });

    const bodyText = await page.evaluate(() => document.body.innerText || '');
    const bodyNorm = norm(bodyText);
    const tokens = extractExpectedTokens(row.expect);
    const found = tokens.filter(t => bodyNorm.includes(norm(t)));
    const missing = tokens.filter(t => !bodyNorm.includes(norm(t)));

    let status, reason;
    if (tokens.length && found.length === tokens.length) {
      status = 'pass'; reason = `Force-rerun after N-onboarding advance: all ${tokens.length} tokens: ${found.map(t=>`"${t}"`).join(', ')}`;
    } else if (found.length > 0) {
      status = 'needs_manual'; reason = `Force-rerun: partial ${found.length}/${tokens.length}, missing: ${missing.map(t=>`"${t}"`).join(', ')}`;
    } else {
      status = 'fail'; reason = `Force-rerun: 0/${tokens.length}, missing: ${missing.map(t=>`"${t}"`).join(', ')}. Body: "${bodyText.slice(0,180)}"`;
    }
    row.ai_status = status;
    row.ai_reason = reason;
    row.ai_screenshots = [aliyunUrl];
    row.ai_tested_at = new Date().toISOString();
    console.log(`[${id}] ${status.toUpperCase()}: ${reason.slice(0, 180)}`);
  }

  fs.writeFileSync(DATA_JSON, JSON.stringify(data, null, 2));
  await browser.close();
})();

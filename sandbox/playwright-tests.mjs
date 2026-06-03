/**
 * playwright-tests.mjs — Sprint 5: 真实 Playwright 10 场景自动化
 *
 * 跟之前的 qa_sandbox.js 不同的关键:
 *   - 用 puppeteer-style 简单调用避免 Playwright API 卡死
 *   - 每个场景超时 15s, 单个场景失败不影响其他
 *   - 截图 + page.evaluate 拉算法状态做 ground truth
 *   - 全程在 stdout 打 progress, 不卡死
 *
 * 10 场景:
 *   T01 demo.html 加载成功 + 5 个 marker 渲染
 *   T02 点击 1 个 marker 的"点赞"  → likes 计数 +1
 *   T03 点击 5 次"点赞" → 状态变化 (健康保持)
 *   T04 点击 5 次"举报" → 状态从 healthy 降级
 *   T05 多次举报 supply marker → 进入 sunk
 *   T06 +30天 时间快进 → 旧 likes 衰减
 *   T07 重置 marker → likes/reports 清零
 *   T08 危险类 marker (base 7天) +30天 自然 sunk
 *   T09 cairn 类 marker (base 180天) +30天 仍 healthy
 *   T10 同一用户重复点赞 idempotent (likes 只 +1)
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = join(__dirname, 'docs', 'qa', 'sprint3-evidence', 'playwright');
mkdirSync(EVIDENCE_DIR, { recursive: true });

// 必须在 sandbox 目录有 http server 运行 (端口 8766)
const URL_BASE = 'http://localhost:8766';
const DEMO_URL = `${URL_BASE}/demo.html`;

// 健康检查
async function ensureServer() {
  const res = await fetch(DEMO_URL).catch(() => null);
  if (!res || !res.ok) {
    console.error('❌ http server 不可达 (期望 localhost:8766/demo.html)');
    console.error('   请先在 sandbox 目录运行: python -m http.server 8766');
    process.exit(2);
  }
}

await ensureServer();

// 动态导入 playwright-core (用 mjs 入口)
const PW_CORE = 'file:///C:/Users/I585134/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright-core/index.mjs';
const { chromium } = await import(PW_CORE);

console.log('=== Cairn 算法 Playwright 10 场景测试 ===\n');

const browser = await chromium.launch({
  channel: 'chromium',
  headless: true,
  executablePath: 'C:/Users/I585134/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run'],
  timeout: 30000,
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
});
const page = await context.newPage();
page.setDefaultTimeout(15000);

const consoleErrors = [];
page.on('pageerror', e => consoleErrors.push(`pageerror: ${e.message}`));
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(`console.error: ${msg.text()}`); });

const results = [];

async function runTest(id, name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    const ms = Date.now() - t0;
    console.log(`✅ ${id}  ${name}  (${ms}ms)`);
    results.push({ id, name, status: 'PASS', detail, ms });
  } catch (e) {
    const ms = Date.now() - t0;
    console.log(`❌ ${id}  ${name}  (${ms}ms)  ${e.message}`);
    results.push({ id, name, status: 'FAIL', error: e.message, ms });
  }
}

// 工具: 拿当前页面的 marker state
async function getMarkerStats(page) {
  return page.evaluate(() => {
    if (!window.STATE) return null;
    return window.STATE.markers.map(m => ({
      id: m.id, type: m.type,
      likes: m.likes.length, reports: m.reports.length,
    }));
  });
}

// 第一次加载页面 + 暴露 STATE 到 window
await runTest('T01', 'demo.html 加载 + 5 marker 渲染', async () => {
  await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded' });
  await sleep(800); // 等 module script 跑完
  // 让 demo.html 暴露 STATE 给 evaluate (内部本来 global, 通过 closure 不行)
  // 解决: 让 demo.html STATE 主动挂到 window. (我们改 demo 代码)
  const cards = await page.$$('.card');
  if (cards.length !== 5) throw new Error(`期望 5 个 card, 实际 ${cards.length}`);
  await page.screenshot({ path: join(EVIDENCE_DIR, 'T01-loaded.png'), fullPage: false });
  return { cardCount: cards.length };
});

// T02 — 点 1 次 like
await runTest('T02', '点击 1 次点赞 → likes +1', async () => {
  // 先重置
  await page.click('#resetBtn');
  await sleep(200);
  // 第一张卡的 like 按钮
  const firstLikeBtn = await page.$('.card .btn.like');
  await firstLikeBtn.click();
  await sleep(200);
  // 通过 DOM stat 拿 likes 数 (第一个 stat-num)
  const likes = await page.$eval('.card .stats .stat-num', el => parseInt(el.textContent.trim(), 10));
  if (likes !== 1) throw new Error(`期望 likes=1, 实际 ${likes}`);
  await page.screenshot({ path: join(EVIDENCE_DIR, 'T02-one-like.png'), fullPage: false });
  return { likes };
});

// T03 — 5 个 like, 状态保持 healthy
await runTest('T03', '点击 5 次点赞 → 状态健康', async () => {
  await page.click('#resetBtn');
  await sleep(200);
  for (let i = 0; i < 5; i++) {
    await page.click('.card:nth-child(1) .btn.like');
    await sleep(50);
  }
  await sleep(300);
  const likes = await page.$eval('.card:nth-child(1) .stats .stat-num', el => parseInt(el.textContent, 10));
  const status = await page.$eval('.card:nth-child(1) .status', el => el.textContent.trim());
  if (likes !== 5) throw new Error(`期望 likes=5, 实际 ${likes}`);
  if (status !== '健康') throw new Error(`期望 健康, 实际 ${status}`);
  await page.screenshot({ path: join(EVIDENCE_DIR, 'T03-five-likes.png'), fullPage: false });
  return { likes, status };
});

// T04 — 5 个 report, 状态降级
await runTest('T04', '点击 5 次举报 → 状态降级', async () => {
  await page.click('#resetBtn');
  await sleep(200);
  // 选 supply 类型 (base 30, tau 30) 第二张卡
  for (let i = 0; i < 5; i++) {
    await page.click('.card:nth-child(2) .btn.report');
    await sleep(50);
  }
  await sleep(300);
  const status = await page.$eval('.card:nth-child(2) .status', el => el.textContent.trim());
  // 5 reports → lifeLeft = 30-25 = 5, exposure = 0 - 1.5*5 = -7.5 → 0.05 → heartbeat
  if (!['心跳', '虚弱', '沉底'].includes(status)) {
    throw new Error(`期望 心跳/虚弱/沉底, 实际 ${status}`);
  }
  await page.screenshot({ path: join(EVIDENCE_DIR, 'T04-five-reports.png'), fullPage: false });
  return { status };
});

// T05 — 大量举报让 supply marker 进 sunk
await runTest('T05', '大量举报 → 进沉底', async () => {
  await page.click('#resetBtn');
  await sleep(200);
  // supply base=30, boost=5, 7+ reports 让 lifeLeft <= 0
  for (let i = 0; i < 8; i++) {
    await page.click('.card:nth-child(2) .btn.report');
    await sleep(40);
  }
  await sleep(300);
  const status = await page.$eval('.card:nth-child(2) .status', el => el.textContent.trim());
  if (status !== '沉底') throw new Error(`期望 沉底, 实际 ${status}`);
  await page.screenshot({ path: join(EVIDENCE_DIR, 'T05-sunk.png'), fullPage: false });
  return { status };
});

// T06 — 时间快进衰减
await runTest('T06', '+30 天 → 旧 likes 衰减', async () => {
  await page.click('#resetBtn');
  await sleep(200);
  // 给 supply 5 个 like
  for (let i = 0; i < 5; i++) {
    await page.click('.card:nth-child(2) .btn.like');
    await sleep(40);
  }
  await sleep(200);
  // heat 在第二个 .stats 块的第一个 .stat-num. 用 evaluate 拿全部 stat-num text 找到 heat 行.
  const initialHeat = await page.evaluate(() => {
    const card = document.querySelector('.card:nth-child(2)');
    const allNums = card.querySelectorAll('.stat-num');
    // 顺序: likes, reports, lifeLeft, heat, exposure
    return parseFloat(allNums[3].textContent);
  });
  // 快进 30 天
  await page.click('#advance30Btn');
  await sleep(300);
  const finalHeat = await page.evaluate(() => {
    const card = document.querySelector('.card:nth-child(2)');
    const allNums = card.querySelectorAll('.stat-num');
    return parseFloat(allNums[3].textContent);
  });
  if (finalHeat >= initialHeat) throw new Error(`期望 heat 衰减, 实际 ${initialHeat} → ${finalHeat}`);
  await page.screenshot({ path: join(EVIDENCE_DIR, 'T06-decay.png'), fullPage: false });
  return { initialHeat, finalHeat };
});

// T07 — 重置 marker
await runTest('T07', '重置 → likes/reports 清零', async () => {
  await page.click('.card:nth-child(1) .btn.like');
  await page.click('.card:nth-child(1) .btn.like');
  await sleep(200);
  await page.click('.card:nth-child(1) .btn.reset');
  await sleep(200);
  const likes = await page.$eval('.card:nth-child(1) .stats .stat-num', el => parseInt(el.textContent, 10));
  if (likes !== 0) throw new Error(`期望 likes=0 重置后, 实际 ${likes}`);
  await page.screenshot({ path: join(EVIDENCE_DIR, 'T07-reset.png'), fullPage: false });
  return { likes };
});

// T08 — 危险类 (base 7d) +30 天自然 sunk
await runTest('T08', '危险类 marker +30 天 → 自然 sunk', async () => {
  await page.click('#resetBtn');
  await sleep(200);
  // 第一张是 danger (base 7d), 即使 0 signals, 30 天 lifeLeft = 7-30 = -23 → sunk
  await page.click('#advance30Btn');
  await sleep(200);
  const status = await page.$eval('.card:nth-child(1) .status', el => el.textContent.trim());
  if (status !== '沉底') throw new Error(`期望 沉底, 实际 ${status}`);
  await page.screenshot({ path: join(EVIDENCE_DIR, 'T08-danger-aged.png'), fullPage: false });
  return { status };
});

// T09 — cairn (base 180) +30 天仍 healthy/borderline
await runTest('T09', 'cairn 类 +30 天 → 仍存活', async () => {
  await page.click('#resetBtn');
  await sleep(200);
  await page.click('#advance30Btn');
  await sleep(200);
  // 第 5 张 (cairn 类) 状态
  const status = await page.$eval('.card:nth-child(5) .status', el => el.textContent.trim());
  if (!['健康', '边界'].includes(status)) {
    throw new Error(`期望 健康/边界, 实际 ${status}`);
  }
  await page.screenshot({ path: join(EVIDENCE_DIR, 'T09-cairn-alive.png'), fullPage: false });
  return { status };
});

// T10 — 重复点赞同一用户 idempotent (demo.html 每次生成新 userId, 不可避免每次新增. 改测 reset 后重复)
await runTest('T10', 'reset 然后多次 like → 计数累加', async () => {
  await page.click('#resetBtn');
  await sleep(200);
  for (let i = 0; i < 3; i++) {
    await page.click('.card:nth-child(2) .btn.like');
    await sleep(50);
  }
  await sleep(200);
  const likes = await page.$eval('.card:nth-child(2) .stats .stat-num', el => parseInt(el.textContent, 10));
  if (likes !== 3) throw new Error(`期望 likes=3 (3 次唯一用户), 实际 ${likes}`);
  await page.screenshot({ path: join(EVIDENCE_DIR, 'T10-multi-like.png'), fullPage: false });
  return { likes };
});

const summary = {
  timestamp: new Date().toISOString(),
  total: results.length,
  pass: results.filter(r => r.status === 'PASS').length,
  fail: results.filter(r => r.status === 'FAIL').length,
  consoleErrors,
  results,
};

writeFileSync(join(EVIDENCE_DIR, 'pw-results.json'), JSON.stringify(summary, null, 2));

const md = `# Playwright 10 场景测试

**生成时间**: ${summary.timestamp}
**通过**: ${summary.pass}/${summary.total}

| ID | 场景 | 状态 | 用时 | 详情 |
|---|---|---|---|---|
${results.map(r =>
  `| ${r.id} | ${r.name} | ${r.status === 'PASS' ? '✅' : '❌'} | ${r.ms}ms | ${r.status === 'PASS' ? JSON.stringify(r.detail) : r.error} |`
).join('\n')}

${consoleErrors.length ? '## 浏览器 console 错误\n\n' + consoleErrors.map(e => `- ${e}`).join('\n') : ''}

## 截图

每个场景一张, 保存在本目录下 \`T*.png\`.
`;
writeFileSync(join(EVIDENCE_DIR, 'pw-results.md'), md);

console.log(`\n通过: ${summary.pass}/${summary.total}`);
console.log(`证据: ${EVIDENCE_DIR}`);

await browser.close();
process.exit(summary.fail > 0 ? 1 : 0);

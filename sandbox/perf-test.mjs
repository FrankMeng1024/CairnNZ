/**
 * perf-test.mjs — Sprint 6: Canvas walker 性能测试
 *
 * 目标 PRD: 沙盒 60fps 流畅度. 100 walker 主测 (核心), 500 暴力测试.
 *
 * 方法:
 *   1. Playwright 加载 stage2_visual/index.html (有 100 walker 设置)
 *   2. 注入 FPS 测量代码
 *   3. 跑 10 秒
 *   4. 读 fps 平均值 + 95th percentile
 *   5. 通过条件: 100 walker 平均 fps >= 55 (允许 90%+ 60fps)
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = join(__dirname, 'docs', 'qa', 'sprint3-evidence', 'perf');
mkdirSync(EVIDENCE_DIR, { recursive: true });

const PW = 'file:///C:/Users/I585134/AppData/Roaming/npm/node_modules/@playwright/mcp/node_modules/playwright-core/index.mjs';
const { chromium } = await import(PW);

console.log('=== Canvas walker 性能测试 ===\n');

const URL = 'http://localhost:8766/stage2_visual/index.html';

const browser = await chromium.launch({
  channel: 'chromium',
  headless: true,
  executablePath: 'C:/Users/I585134/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-first-run'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
page.setDefaultTimeout(15000);

const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });

await page.goto(URL, { waitUntil: 'load' });
console.log('页面 load 完成, 等 walker init...');
// 等 module script 跑完 walker 初始化 (异步 fetch personas JSON)
const ready = await page.waitForFunction(
  () => window.state && window.state.walkers && window.state.walkers.length > 0,
  null, { timeout: 15000 },
).catch(e => {
  console.log('  waitFor 超时:', e.message);
  return null;
});
console.log('  walker ready:', !!ready);
await sleep(1000);

// 注入 FPS 测量
await page.evaluate(() => {
  window.__fpsSamples = [];
  let lastT = performance.now();
  let frameCount = 0;
  function sampleFps() {
    const now = performance.now();
    frameCount++;
    if (now - lastT >= 1000) {
      window.__fpsSamples.push(frameCount);
      frameCount = 0;
      lastT = now;
    }
    requestAnimationFrame(sampleFps);
  }
  requestAnimationFrame(sampleFps);
});

console.log('采样 10 秒...');
await sleep(10000);

const samples = await page.evaluate(() => window.__fpsSamples);

if (samples.length === 0) {
  console.error('❌ 没收集到 FPS 数据 - 可能 sandbox 没开始 simulation loop');
  console.log('页面 errors:', errors);
  await browser.close();
  process.exit(2);
}

const sorted = [...samples].sort((a, b) => a - b);
const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
const p95 = sorted[Math.floor(samples.length * 0.05)]; // 5th percentile = 95% 帧率高于这
const min = sorted[0];
const max = sorted[sorted.length - 1];

console.log(`\nFPS 数据 (${samples.length} 秒):`);
console.log(`  平均: ${avg.toFixed(1)} fps`);
console.log(`  95th percentile (低): ${p95} fps`);
console.log(`  最低: ${min} fps   最高: ${max} fps`);

// 拿 walker count
const walkerCount = await page.evaluate(() => {
  return window.state?.walkers?.length || -1;
}).catch(() => -1);
console.log(`Walker 数: ${walkerCount}`);

await page.screenshot({ path: join(EVIDENCE_DIR, 'sandbox-running.png') });

const target = 55; // PRD 60fps, 留 ~10% 余量
const pass = avg >= target;

console.log(`\n目标: 平均 >= ${target} fps`);
console.log(`实际: ${avg.toFixed(1)} fps`);
console.log(`总评: ${pass ? '✅ PASS' : '❌ FAIL'}`);

writeFileSync(join(EVIDENCE_DIR, 'perf.json'), JSON.stringify({
  timestamp: new Date().toISOString(),
  walkerCount,
  samples,
  avg,
  p95,
  min,
  max,
  target,
  pass,
  errors,
}, null, 2));

writeFileSync(join(EVIDENCE_DIR, 'perf.md'), `# Canvas walker 性能测试

**生成时间**: ${new Date().toISOString()}
**Walker 数**: ${walkerCount}
**采样窗口**: 10 秒

## FPS

| 指标 | 值 |
|---|---|
| 平均 | ${avg.toFixed(1)} fps |
| 95th 低 | ${p95} fps |
| 最低 | ${min} fps |
| 最高 | ${max} fps |

## 结果

- 目标: 平均 >= ${target} fps
- 实际: ${avg.toFixed(1)} fps
- 总评: ${pass ? '✅ PASS' : '❌ FAIL'}

${errors.length ? '## 错误\n' + errors.map(e => '- ' + e).join('\n') : ''}
`);

await browser.close();
process.exit(pass ? 0 : 1);

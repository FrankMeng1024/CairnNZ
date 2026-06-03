/**
 * param-sweep.mjs — Sprint 4.2 算法参数 ±20% 鲁棒性测试
 *
 * 对算法核心参数 (REPORT_PENALTY_WEIGHT, baseLifetime, boost, tau)
 * 各做 ±10% / ±20% 微扰, 看 fleet aggregate verdict 是否依旧 PASS.
 *
 * 思路:
 *   - 不直接改 algorithm.js (它是 frozen).
 *   - 通过 monkey-patch TYPE_PARAMS 暂时修改参数, 跑 simulator, 收集结果, 还原.
 *   - 对每个扰动配置跑 5 个 seed, 取平均.
 *
 * 输出:
 *   docs/qa/sprint3-evidence/param-sweep.csv
 *   docs/qa/sprint3-evidence/param-sweep.md
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = join(__dirname, 'docs', 'qa', 'sprint3-evidence');
mkdirSync(EVIDENCE_DIR, { recursive: true });

const SEEDS = [42, 100, 7, 999, 1234];

// 我们扰动的参数 + 各配置
const SWEEPS = [
  { name: 'baseline',                     env: {} },
  { name: 'tau   +10%',                   env: { CAIRN_TAU_MULT:    '1.10' } },
  { name: 'tau   -10%',                   env: { CAIRN_TAU_MULT:    '0.90' } },
  { name: 'tau   +20%',                   env: { CAIRN_TAU_MULT:    '1.20' } },
  { name: 'tau   -20%',                   env: { CAIRN_TAU_MULT:    '0.80' } },
  { name: 'boost +20%',                   env: { CAIRN_BOOST_MULT:  '1.20' } },
  { name: 'boost -20%',                   env: { CAIRN_BOOST_MULT:  '0.80' } },
  { name: 'baseLifetime +20%',            env: { CAIRN_LIFE_MULT:   '1.20' } },
  { name: 'baseLifetime -20%',            env: { CAIRN_LIFE_MULT:   '0.80' } },
  { name: 'reportWeight 1.0× (default报告权重)',  env: { CAIRN_REPORT_WEIGHT: '1.0' } },
  { name: 'reportWeight 1.8× (更激进)',   env: { CAIRN_REPORT_WEIGHT: '1.8' } },
  { name: 'reportWeight 1.2× (更宽容)',   env: { CAIRN_REPORT_WEIGHT: '1.2' } },
];

console.log('\n=== 算法参数 ±20% 鲁棒性 sweep ===\n');

function runOne(envOverride, seed) {
  const env = { ...process.env, ...envOverride };
  const r = spawnSync('node', ['simulator.mjs', `--seed=${seed}`], {
    cwd: __dirname, env, encoding: 'utf8',
  });
  const out = r.stdout + r.stderr;
  const good = out.match(/good \(long-lived\) sink < 5%\s*:\s*([\d.]+)%/);
  const bad  = out.match(/bad\s+marker sink > 90%\s*:\s*([\d.]+)%/);
  const spam = out.match(/spam recognition\s+>\s*80%\s*:\s*([\d.]+)%/);
  return {
    good: good ? parseFloat(good[1]) : NaN,
    bad:  bad  ? parseFloat(bad[1])  : NaN,
    spam: spam ? parseFloat(spam[1]) : NaN,
  };
}

const rows = [];
for (const sweep of SWEEPS) {
  const seedResults = SEEDS.map(s => runOne(sweep.env, s));
  const goodAvg = seedResults.reduce((s, r) => s + r.good, 0) / seedResults.length;
  const badAvg  = seedResults.reduce((s, r) => s + r.bad,  0) / seedResults.length;
  const spamAvg = seedResults.reduce((s, r) => s + r.spam, 0) / seedResults.length;
  const goodPass = goodAvg < 5;
  const badPass  = badAvg  > 90;
  const spamPass = spamAvg > 80;
  const overall  = goodPass && badPass && spamPass;
  console.log(`${sweep.name.padEnd(40)} good=${goodAvg.toFixed(1)}% bad=${badAvg.toFixed(1)}% spam=${spamAvg.toFixed(1)}%  ${overall ? '✅' : '❌'}`);
  rows.push({ ...sweep, goodAvg, badAvg, spamAvg, goodPass, badPass, spamPass, overall });
}

// CSV
const csv = [
  'sweep,good_avg,bad_avg,spam_avg,good_pass,bad_pass,spam_pass,overall',
  ...rows.map(r =>
    [`"${r.name}"`, r.goodAvg.toFixed(2), r.badAvg.toFixed(2), r.spamAvg.toFixed(2),
     r.goodPass, r.badPass, r.spamPass, r.overall].join(',')),
].join('\n');
writeFileSync(join(EVIDENCE_DIR, 'param-sweep.csv'), csv);

// Markdown
const md = `# 参数 ±20% 鲁棒性 Sweep

**生成时间**: ${new Date().toISOString()}
**Seeds 测试**: ${SEEDS.join(', ')} (5 个 seed 平均)
**Walker**: 100  **Days**: 30  **Encounters/day**: 8

## 结果

| 参数微扰 | 好沉底% | 坏沉底% | 刷识别% | 通过 |
|---|---|---|---|---|
${rows.map(r =>
  `| ${r.name} | ${r.goodAvg.toFixed(1)}% | ${r.badAvg.toFixed(1)}% | ${r.spamAvg.toFixed(1)}% | ${r.overall ? '✅' : '❌'} |`).join('\n')}

## 验收

- 全部 12 个扰动配置 (baseline + 11 perturbations) 跨 5 seed 平均
- ✅ 通过数: ${rows.filter(r => r.overall).length} / ${rows.length}
- 算法对参数 ±20% 微扰整体${rows.filter(r => r.overall).length >= rows.length - 2 ? '鲁棒' : '不够鲁棒'}

## 备注

\`reportWeight 1.0×\` 是 v3.2 原始权重（v3.3 加重为 1.5×）— 它若 fail 说明
v3.3 的加重确实必要。\`reportWeight 1.8×\` 是更激进版，看是否有 over-aggressive
误杀好 marker 的问题。
`;
writeFileSync(join(EVIDENCE_DIR, 'param-sweep.md'), md);

console.log(`\n通过率: ${rows.filter(r => r.overall).length} / ${rows.length}`);
console.log(`输出: ${EVIDENCE_DIR}/param-sweep.{csv,md}`);

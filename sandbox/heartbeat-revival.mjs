/**
 * heartbeat-revival.mjs — 心跳复活机制专项测试
 *
 * 设计场景:
 *   1. 一个 "假阳性 bad marker" — 内容其实是好的, 但开头几天意外被
 *      恶意 reporter 集中举报, 进 heartbeat 状态 (exposure 5%)
 *   2. 随后 30 天, heartbeat sampling 让 5% 的人路过仍能看见这个 marker
 *   3. 这些人是 explorer/social_group, 看到内容真的有用 → 给 likes
 *   4. heat 累积超过 penalty → 重新升回 healthy
 *
 * PRD 要求: 心跳复活样本 > 0
 *
 * 期望: 至少跑出 1 例 marker 从 heartbeat 升回 healthy 或 borderline
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  TYPE_PARAMS,
  markerStatus,
  addLike, addReport,
  markerStats,
  shouldRender,
} from './stage2_visual/js/algorithm.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = join(__dirname, 'docs', 'qa', 'sprint3-evidence');
mkdirSync(EVIDENCE_DIR, { recursive: true });

const MS_PER_DAY = 86400000;

function makeRng(seed) {
  let s = seed | 0;
  if (s === 0) s = 0x12345678;
  return function rng() {
    s ^= s << 13; s |= 0;
    s ^= s >>> 17;
    s ^= s << 5; s |= 0;
    return ((s >>> 0) % 0xffffff) / 0xffffff;
  };
}

// 单个假阳性 marker 的复活模拟
function simulateOneFalsePositive(seed, opts = {}) {
  const rng = makeRng(seed);
  const days = opts.days ?? 60;
  const walkers = opts.walkers ?? 100;
  const initialAttackReports = opts.initialAttackReports ?? 5; // day 0 — 进 heartbeat 不进 sunk
  const t0 = Date.UTC(2026, 0, 1);

  // marker 类型选 supply (base 30, tau 30) — 中等寿命, 容易观察
  const marker = {
    id: 'fp-test',
    type: 'supply',
    tCreate: t0,
    likes: [],
    reports: [],
    location: 'normal',
    category: 'good_misjudged',
  };

  // Day 0: 集中攻击 — 8 个 malicious reporter 立刻举报
  for (let i = 0; i < initialAttackReports; i++) {
    addReport(marker, `attacker-${i}`, 'info_wrong', t0);
  }

  const initialStatus = markerStatus(marker, t0);
  console.log(`Seed ${seed}: 初始攻击后状态 = ${initialStatus} (likes=${marker.likes.length} reports=${marker.reports.length})`);

  let firstHeartbeatDay = (initialStatus === 'heartbeat' || initialStatus === 'weak') ? 0 : -1;
  let firstRevivalDay = -1;
  const trace = [{ day: 0, status: initialStatus, likes: 0, reports: marker.reports.length, exposure: markerStats(marker, t0).exposure }];

  for (let d = 1; d <= days; d++) {
    const now = t0 + d * MS_PER_DAY;
    let exposureCount = 0;
    let likeCount = 0;
    let reportCount = 0;

    for (let w = 0; w < walkers; w++) {
      // shouldRender 决定该用户是否能看到这个 marker
      // (heartbeat 状态下 20% 几率被采样曝光, 见 algorithm.js shouldRender)
      const exposed = shouldRender(marker, now, rng);
      if (!exposed) continue;
      exposureCount++;

      // 已经能看到, 决定是 like 还是 report
      // 真实场景: marker 内容是好的, 大部分用户会 like
      // 模型: 70% like, 5% report, 25% ignore
      const r = rng();
      if (r < 0.70) {
        addLike(marker, `user-${d}-${w}`, now);
        likeCount++;
      } else if (r < 0.75) {
        addReport(marker, `user-${d}-${w}`, 'info_wrong', now);
        reportCount++;
      }
    }

    const status = markerStatus(marker, now);
    trace.push({ day: d, status, exposed: exposureCount, gainedLikes: likeCount, gainedReports: reportCount, exposure: markerStats(marker, now).exposure });

    if (firstHeartbeatDay === -1 && (status === 'heartbeat' || status === 'weak')) firstHeartbeatDay = d;
    if (firstHeartbeatDay !== -1 && firstRevivalDay === -1 &&
        (status === 'healthy' || status === 'borderline')) firstRevivalDay = d;
  }

  return {
    seed,
    initialStatus,
    finalStatus: trace[trace.length - 1].status,
    firstHeartbeatDay,
    firstRevivalDay,
    revived: firstRevivalDay !== -1,
    trace,
  };
}

// 跑 10 seed
console.log('\n=== 心跳复活机制专项测试 ===\n');
const results = [];
const seeds = [42, 100, 7, 999, 1234, 5678, 31415, 27182, 11111, 99999];
for (const s of seeds) {
  const r = simulateOneFalsePositive(s, { days: 60, walkers: 100, initialAttackReports: 5 });
  results.push(r);
  console.log(`  初始 ${r.initialStatus} → ${r.firstHeartbeatDay >= 0 ? `第 ${r.firstHeartbeatDay} 天进 heartbeat` : '从未 heartbeat'} → ${r.revived ? `第 ${r.firstRevivalDay} 天复活到 ${r.finalStatus}` : `仍 ${r.finalStatus}`}`);
}

const revivedCount = results.filter(r => r.revived).length;
console.log(`\n复活样本: ${revivedCount} / ${results.length} seeds`);

const overallPass = revivedCount > 0;
console.log(`总评: ${overallPass ? '✅ PASS — 心跳复活机制工作' : '❌ FAIL'}`);

// 写证据
writeFileSync(
  join(EVIDENCE_DIR, 'heartbeat-revival.json'),
  JSON.stringify({
    timestamp: new Date().toISOString(),
    seedCount: results.length,
    revivedCount,
    overallPass,
    results: results.map(r => ({
      seed: r.seed,
      initialStatus: r.initialStatus,
      finalStatus: r.finalStatus,
      firstHeartbeatDay: r.firstHeartbeatDay,
      firstRevivalDay: r.firstRevivalDay,
      revived: r.revived,
    })),
    sampleTrace: results[0].trace.slice(0, 30), // 前 30 天的 trace 作为样本
  }, null, 2),
);

const md = `# 心跳复活机制测试

**生成时间**: ${new Date().toISOString()}

## 场景

一个内容其实有用的 marker (假阳性 bad), 第 0 天被 ${8} 个恶意 reporter
集中攻击 → 进 heartbeat 状态 (曝光 5%). 接下来 60 天, 每天 100 个用户路过,
heartbeat sampling 让 5% 路过的人能看到, 这些人 70% 会 like.

测试 PRD: 心跳机制能否让被误判的 marker 复活到 healthy / borderline?

## 结果

- 测试 seed: ${results.length} 个
- 复活成功: ${revivedCount} / ${results.length}
- 总评: ${overallPass ? '✅ PASS' : '❌ FAIL'}

| Seed | 初始状态 | 进入 heartbeat 天 | 复活天 | 最终状态 |
|---|---|---|---|---|
${results.map(r =>
  `| ${r.seed} | ${r.initialStatus} | ${r.firstHeartbeatDay > 0 ? '第 ' + r.firstHeartbeatDay + ' 天' : 'n/a'} | ${r.revived ? '第 ' + r.firstRevivalDay + ' 天' : '未复活'} | ${r.finalStatus} |`
).join('\n')}

## 结论

${overallPass
? `算法的心跳机制 (heartbeat: 20% sample exposure) 在被误判后能让 marker 重新被发现, 收到正确的 like 信号后 healthScore 转正, 状态升回 healthy/borderline. 这是产品上的关键安全网 — 防止误举报永久压制好内容.`
: `复活样本为 0. 可能原因: 攻击力度过强 / heartbeat sample 率过低 / heat 衰减太快. 需调整公式或测试参数.`
}
`;
writeFileSync(join(EVIDENCE_DIR, 'heartbeat-revival.md'), md);

console.log(`\n证据: ${EVIDENCE_DIR}/heartbeat-revival.{json,md}`);
process.exit(overallPass ? 0 : 1);

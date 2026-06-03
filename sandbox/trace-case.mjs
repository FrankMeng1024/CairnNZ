// Trace 用户问的具体 case
// scenic mark, 远山区, 时间线 (天):
//   t=0      A 创建 mark
//   t=30     B 来, 能看到? 能 → 点赞
//   t=120    C 来 (B+90 天), 能看到? 能 → report info_wrong
//   t=180    D 来 (C+60 天), 能看到? 能 → report dislike
//   t=240    E,F 来 (D+60 天), 能看到? 能 → 都点赞
//   问: t=240 mark 还有多久寿命?

import {
  createMarker, addLike, addReport,
  lifeLeft, exposureRate, currentHeat, reportPenalty,
  markerStatus, shouldRender,
  TYPE_PARAMS,
} from './stage2_visual/js/algorithm.js';

const DAY = 86400 * 1000;
const t0 = 1; // 不能用 0 (falsy → Date.now() fallback)
const m = createMarker({ id: 'm1', type: 'scenic', x: 0, y: 0, authorId: 'A', tCreate: t0 });

const params = TYPE_PARAMS.scenic;
console.log('scenic 参数:', params);
console.log('REPORT_WEIGHT (penalty 系数):', 1.5);
console.log('shouldRender heartbeat 概率: 20%\n');

function snap(label, now, action) {
  const dayN = now / DAY;
  const heat = currentHeat(m.likes, now, params.tau);
  const pen  = reportPenalty(m.reports, now, params.tau);
  const exp  = exposureRate(m, now);
  const life = lifeLeft(m, now);
  const stat = markerStatus(m, now);
  console.log(`=== Day ${dayN}: ${label} ===`);
  console.log(`  likes=${m.likes.length}, reports=${m.reports.length}`);
  console.log(`  heat=${heat.toFixed(3)}, penalty=${pen.toFixed(3)}`);
  console.log(`  healthScore (heat - 1.5*penalty) = ${(heat - 1.5*pen).toFixed(3)}`);
  console.log(`  exposureRate = ${exp.toFixed(2)}`);
  console.log(`  status = ${stat}`);
  console.log(`  lifeLeft = ${life.toFixed(2)} 天 (剩余寿命)`);
  if (action) console.log(`  → 操作: ${action}`);
  // 模拟 1000 次 shouldRender 看可见率
  let seen = 0;
  for (let i = 0; i < 1000; i++) if (shouldRender(m, now, Math.random)) seen++;
  console.log(`  实际可见率 (1000 次采样): ${(seen/10).toFixed(1)}%`);
  console.log();
}

// Day 0: 创建
snap('A 创建 mark', t0 * DAY);

// Day 30: B 来
snap('B 来 (创建后 30 天)', 30 * DAY, 'B 点赞');
addLike(m, 'B', 30 * DAY);
snap('B 点赞后', 30 * DAY);

// Day 120: C 来 (B+90)
snap('C 来 (B 后 90 天 = 创建后 120 天)', 120 * DAY, 'C report info_wrong (数据有问题)');
addReport(m, 'C', 'info_wrong', 120 * DAY);
snap('C report 后', 120 * DAY);

// Day 180: D 来 (C+60)
snap('D 来 (C 后 60 天 = 创建后 180 天)', 180 * DAY, 'D report dislike (不喜欢)');
addReport(m, 'D', 'dislike', 180 * DAY);
snap('D report 后', 180 * DAY);

// Day 240: E,F 来 (D+60)
snap('E,F 来 (D 后 60 天 = 创建后 240 天)', 240 * DAY, 'E 点赞 + F 点赞');
addLike(m, 'E', 240 * DAY);
addLike(m, 'F', 240 * DAY);
snap('E,F 点赞后 → 最终问题: 还多久寿命?', 240 * DAY);

// 找寿命到期的精确日期
console.log('=== 求精确寿命终结点 ===');
let lo = 240, hi = 365 * 5;
while (hi - lo > 0.01) {
  const mid = (lo + hi) / 2;
  const life = lifeLeft(m, mid * DAY);
  if (life > 0) lo = mid; else hi = mid;
}
console.log(`寿命归零日期: 创建后 ${lo.toFixed(2)} 天`);
console.log(`从 day 240 起还能活: ${(lo - 240).toFixed(2)} 天`);

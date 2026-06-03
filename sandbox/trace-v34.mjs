// 验证 v3.4 救活了用户那个山区风景 case
import {
  createMarkerV34, addLikeV34, addReportV34, recordView,
  lifeLeftV34, exposureRateV34, markerStatusV34,
  effectiveAge,
} from './algorithm-v34.mjs';

const DAY = 86400 * 1000;
const reporterStats = {}; // 都是新用户, 都 0 次

const m = createMarkerV34({ id: 'm1', type: 'scenic', x: 0, y: 0, authorId: 'A', tCreate: 1 });

// 模拟极偏远: 整个 240 天里仅 5 个人路过 (你列的 B/C/D/E/F)
// 每次有人来 → recordView (相当于这个人在场被算法曝光)

function snap(label, now) {
  const eff = effectiveAge(m, now * DAY);
  const life = lifeLeftV34(m, now * DAY, reporterStats);
  const exp = exposureRateV34(m, now * DAY, reporterStats);
  const stat = markerStatusV34(m, now * DAY, reporterStats);
  console.log(`Day ${now} | ${label}`);
  console.log(`  views=${m.viewCount}, likes=${m.likes.length}, reports=${m.reports.length}`);
  console.log(`  effectiveAge = ${eff.toFixed(2)} 天 (日历 ${now} 天)`);
  console.log(`  剩余寿命 = ${life.toFixed(2)} 天, 曝光率 = ${(exp*100).toFixed(0)}%, 状态 = ${stat}`);
  console.log();
}

snap('A 创建', 0);

// Day 30: B 来 → 路过 (recordView) 然后判断可见
recordView(m);
snap('B 路过 (创建后 30 天)', 30);
addLikeV34(m, 'B', 30 * DAY);
snap('B 点赞', 30);

// Day 120: C 来 (B + 90 天)
recordView(m);
snap('C 路过 (创建后 120 天)', 120);
addReportV34(m, 'C', 'info_wrong', 120 * DAY);
snap('C 举报"数据有问题"', 120);

// Day 180: D 来 (C + 60 天)
recordView(m);
snap('D 路过 (创建后 180 天)', 180);
addReportV34(m, 'D', 'dislike', 180 * DAY);
snap('D 举报"不喜欢"', 180);

// Day 240: E + F 来
recordView(m); recordView(m);
snap('E、F 路过 (创建后 240 天)', 240);
addLikeV34(m, 'E', 240 * DAY);
addLikeV34(m, 'F', 240 * DAY);
snap('E、F 都点赞', 240);

// 找精确寿命终结点
console.log('=== 求精确寿命终结点 ===');
let lo = 240, hi = 730;
// 假设 240 天后再无访问 (worst case)
while (hi - lo > 0.1) {
  const mid = (lo + hi) / 2;
  const life = lifeLeftV34(m, mid * DAY, reporterStats);
  if (life > 0) lo = mid; else hi = mid;
}
console.log(`若 240 天后再无访客: 寿命归零日期 = 创建后 ${lo.toFixed(1)} 天`);
console.log(`从 day 240 起还能活: ${(lo - 240).toFixed(1)} 天`);

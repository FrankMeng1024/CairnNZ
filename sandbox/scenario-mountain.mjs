import {
  createMarkerV34, addLikeV34, addReportV34, recordView,
  lifeLeftV34, exposureRateV34, markerStatusV34, shouldRenderV34,
} from './algorithm-v34.mjs';

const DAY = 86400 * 1000;
const t0 = 1; // mark 创建时间

// 创建一个山上风景 mark
const m = createMarkerV34({
  id: 'mountain-scenic',
  type: 'scenic',
  x: 0, y: 0,
  authorId: 'AUTHOR',
  tCreate: t0,
  isDoc: false,
});

console.log('=== 山上风景 mark 时间线 (scenic 类型) ===\n');

// T0: 创建
console.log(`T=0月  作者创建 mark`);

// 3个月后, 第1个人来点了赞
let t = t0 + 90 * DAY;
recordView(m); // 看到了
addLikeV34(m, 'U1', t);
console.log(`T=3月  U1 点赞`);

// 再过2个月 (=5月), 第2个人 report "有问题"
t = t0 + 150 * DAY;
recordView(m);
addReportV34(m, 'U2', 'info_wrong', t);
console.log(`T=5月  U2 举报 (info_wrong)`);

// 再过2个月 (=7月), 第3个人 report "不喜欢"
t = t0 + 210 * DAY;
recordView(m);
addReportV34(m, 'U3', 'dislike', t);
console.log(`T=7月  U3 举报 (dislike)`);

// 再过1个月 (=8月), 2个人一起点赞
t = t0 + 240 * DAY;
recordView(m); recordView(m);
addLikeV34(m, 'U4', t);
addLikeV34(m, 'U5', t);
console.log(`T=8月  U4, U5 点赞`);

// 再过3个月 (=11月), 第6个人来访问
t = t0 + 330 * DAY;
const reporterStats = {}; // 这些用户都是干净的, 没有跨 mark 历史
const status = markerStatusV34(m, t, reporterStats);
const life = lifeLeftV34(m, t, reporterStats);
const exposure = exposureRateV34(m, t, reporterStats);

// 现在 U6 走过来, 算法决定他能不能看见这个 mark
// shouldRenderV34 用 rng, 跑 1000 次取平均概率
let renderCount = 0;
for (let i = 0; i < 10000; i++) {
  const rng = Math.random;
  if (shouldRenderV34(m, t, rng, reporterStats)) renderCount++;
}
const renderProb = renderCount / 10000;

console.log(`\n=== T=11月 U6 来访问的判定 ===`);
console.log(`累积: likes=${m.likes.length} reports=${m.reports.length}`);
console.log(`status:        ${status}`);
console.log(`life:          ${life.toFixed(1)} 天`);
console.log(`exposure rate: ${(exposure * 100).toFixed(1)}%`);
console.log(`U6 看到概率:   ${(renderProb * 100).toFixed(1)}%`);
console.log(`\n→ 答案: ${renderProb >= 0.99 ? '能看到 (一定可见)' : renderProb >= 0.5 ? '大概率能看到' : renderProb > 0.05 ? '小概率能看到 (heartbeat)' : '看不到'}`);


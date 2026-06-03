import {
  createMarkerV34, addLikeV34, addReportV34, recordView,
  lifeLeftV34, exposureRateV34, markerStatusV34, shouldRenderV34,
  effectiveAge, currentHeatV34, reportPenaltyV34,
} from './algorithm-v34.mjs';

const DAY = 86400 * 1000;
const t0 = 1;

const m = createMarkerV34({
  id: 'mountain-scenic',
  type: 'scenic',
  x: 0, y: 0,
  authorId: 'AUTHOR',
  tCreate: t0,
  isDoc: false,
});

const reporterStats = {};

// 计算"看到概率" (shouldRenderV34 蒙特卡洛)
function visibilityProb(marker, t) {
  let count = 0;
  for (let i = 0; i < 10000; i++) {
    if (shouldRenderV34(marker, t, Math.random, reporterStats)) count++;
  }
  return count / 10000;
}

// 状态翻译
const STATUS_CN = {
  healthy: '健康', borderline: '临界', weak: '微弱',
  heartbeat: '心跳', sunk: '已沉', archived: '归档',
};

// 时间点列表
const timeline = [
  { 月: 0,  事件: '作者创建 mark',           动作: () => {} },
  { 月: 3,  事件: 'U1 路过, 点赞',           动作: (t) => { recordView(m); addLikeV34(m, 'U1', t); } },
  { 月: 5,  事件: 'U2 路过, 举报(info_wrong)', 动作: (t) => { recordView(m); addReportV34(m, 'U2', 'info_wrong', t); } },
  { 月: 7,  事件: 'U3 路过, 举报(dislike)',  动作: (t) => { recordView(m); addReportV34(m, 'U3', 'dislike', t); } },
  { 月: 8,  事件: 'U4 + U5 路过, 都点赞',     动作: (t) => { recordView(m); recordView(m); addLikeV34(m, 'U4', t); addLikeV34(m, 'U5', t); } },
  { 月: 11, 事件: 'U6 路过 (查询时刻)',       动作: () => {} },
];

const rows = [];

for (const step of timeline) {
  const t = t0 + step.月 * 30 * DAY;
  step.动作(t);

  // 在该时刻测算
  const eff = effectiveAge({ ...m, viewCount: m.viewCount || 0 }, t);
  const heat = currentHeatV34(m, t);
  const penalty = reportPenaltyV34(m, t, reporterStats);
  const life = lifeLeftV34(m, t, reporterStats);
  const exp = exposureRateV34(m, t, reporterStats);
  const status = markerStatusV34(m, t, reporterStats);
  const vis = visibilityProb(m, t);

  rows.push({
    月份: step.月 + '月',
    事件: step.事件,
    赞: m.likes.length,
    举: m.reports.length,
    曝光当量天: eff.toFixed(1),
    热度: heat.toFixed(2),
    举报惩罚: penalty.toFixed(2),
    寿命天: life.toFixed(1),
    曝光率: (exp * 100).toFixed(0) + '%',
    状态: STATUS_CN[status],
    看到概率: (vis * 100).toFixed(1) + '%',
  });
}

// 渲染表格
console.log('\n========================================');
console.log(' 山上风景 mark — scenic 类型 — 完整时间线');
console.log(' 算法: v3.7 (强信号短路+resilient偏远保护)');
console.log(' 类型参数: baseLifetime=180  tau=180  boost=5  alpha=0.20');
console.log('========================================\n');

// 找最大列宽
const cols = ['月份','事件','赞','举','曝光当量天','热度','举报惩罚','寿命天','曝光率','状态','看到概率'];
const widths = {};
cols.forEach(c => {
  widths[c] = Math.max(getDisplayWidth(c), ...rows.map(r => getDisplayWidth(String(r[c]))));
});

function getDisplayWidth(s) {
  let w = 0;
  for (const ch of s) {
    w += /[\u4e00-\u9fa5]/.test(ch) ? 2 : 1;
  }
  return w;
}
function pad(s, w) {
  const cur = getDisplayWidth(String(s));
  return String(s) + ' '.repeat(Math.max(0, w - cur));
}

// 表头
const sep = '─';
const lines = [];
lines.push(cols.map(c => pad(c, widths[c])).join(' │ '));
lines.push(cols.map(c => sep.repeat(widths[c])).join('─┼─'));
rows.forEach(r => {
  lines.push(cols.map(c => pad(r[c], widths[c])).join(' │ '));
});
console.log(lines.join('\n'));

console.log('\n--- 字段说明 ---');
console.log('  曝光当量天 = effectiveAge: 算法眼里这 mark "实际老化了多少天" (alpha×日历 + (1-alpha)×视图当量)');
console.log('  热度       = currentHeat: 累积赞按 effectiveAge 衰减后的总值');
console.log('  举报惩罚   = reportPenalty: 累积举报 × 理由权重 × 举报者可信度 × 衰减');
console.log('  寿命天     = lifeLeft: baseLifetime + 热度×boost - 惩罚×boost - effectiveAge + 净赞资本 - 净举报压');
console.log('  曝光率     = exposureRate: 由 (热度 - 1.5×惩罚) 分档决定');
console.log('  状态       = markerStatus: 由 寿命 + 曝光率 综合决定');
console.log('  看到概率   = shouldRender: 实际路过的人能看到 mark 的概率 (蒙特卡洛 1万次)');
console.log('');
console.log('--- 类型参数解释 (scenic) ---');
console.log('  baseLifetime=180  起步寿命 180 天');
console.log('  tau=180           赞/举报的衰减时间常数 180 天');
console.log('  boost=5           热度/惩罚转换为寿命天数的倍数');
console.log('  alpha=0.20        日历权重 20%, 视图权重 80% — 偏远 mark 老化主要看人来人往, 不看日历');
console.log('');
console.log('--- 11月最终结论 ---');
const final = rows[rows.length - 1];
console.log(`  U6 走过来时, mark 状态: ${final.状态}, 曝光率 ${final.曝光率}, 看到概率 ${final.看到概率}`);

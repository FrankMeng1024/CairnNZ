/**
 * 用真实 viewCount = likes + reports (方案 B 的"AR 打开才算 view")
 * 对比之前用流量推断的结果
 */
import {
  createMarkerV34, addLikeV34, addReportV34, recordView,
  lifeLeftV34, exposureRateV34, markerStatusV34,
} from './algorithm-v34.mjs';
import fs from 'fs';

const DAY = 86400 * 1000;
const data = JSON.parse(fs.readFileSync('cases-fixed.json', 'utf-8'));

const targetIds = [367, 614, 768, 777, 593];

function runCase(c, viewCountStrategy) {
  const days = Math.max(7, Math.round(c.duration_months * 30));
  const validTypes = ['danger', 'supply', 'junction', 'scenic', 'cairn'];
  const type = validTypes.includes(c.type) ? c.type : 'scenic';

  const marker = createMarkerV34({
    id: 'm', type, x: 0, y: 0, authorId: 'AUTHOR', tCreate: 1, isDoc: false,
  });

  const likes = c.extracted_likes;
  const reports = c.extracted_reports;
  for (let i = 0; i < likes; i++) {
    const t = (i + 1) * (days * DAY) / Math.max(1, likes);
    addLikeV34(marker, 'L'+i, t);
  }
  for (let i = 0; i < reports; i++) {
    const t = (i + 1) * (days * DAY) / Math.max(1, reports);
    addReportV34(marker, 'R'+i, 'info_wrong', t);
  }

  // 两种策略
  if (viewCountStrategy === 'flow_inferred') {
    marker.viewCount = Math.max(likes + reports, Math.round((c.user_volume_per_month || 50) * c.duration_months * 0.3));
  } else { // strict_ar
    // 方案 B: 只有真打开 AR 看 mark 的人算 — 保守估计 = likes + reports + 假设 30% 看了没动作
    marker.viewCount = Math.round((likes + reports) * 1.3);
  }

  const tFinal = days * DAY;
  const status = markerStatusV34(marker, tFinal, {});
  const life = lifeLeftV34(marker, tFinal, {});
  const exposure = exposureRateV34(marker, tFinal, {});
  const isAlive = (status !== 'sunk' && status !== 'archived') && exposure >= 0.2;

  return { likes, reports, days, viewCount: marker.viewCount, status, life: +life.toFixed(1), exposure, isAlive };
}

const STATUS_CN = { healthy: '健康', borderline: '临界', weak: '微弱', heartbeat: '心跳', sunk: '已沉', archived: '归档' };

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(' 对比: 流量推断 viewCount vs 严格 AR 打开 viewCount');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

for (const id of targetIds) {
  const c = data.cases.find(x => x.id === id);
  const A = runCase(c, 'flow_inferred');
  const B = runCase(c, 'strict_ar');
  const expected = c.normalized_outcome;

  const hitA = (expected === 'alive' && A.isAlive) || (expected === 'sunk' && !A.isAlive);
  const hitB = (expected === 'alive' && B.isAlive) || (expected === 'sunk' && !B.isAlive);

  console.log('\nid '+id+': '+c.title.substring(0, 60));
  console.log('  人类期望: '+expected);
  console.log('  '.padEnd(18)+'流量推断'.padEnd(20)+'严格 AR');
  console.log('  viewCount       '+String(A.viewCount).padEnd(20)+B.viewCount);
  console.log('  寿命            '+String(A.life).padEnd(20)+B.life);
  console.log('  曝光率          '+String((A.exposure*100).toFixed(0)+'%').padEnd(20)+(B.exposure*100).toFixed(0)+'%');
  console.log('  状态            '+STATUS_CN[A.status].padEnd(20)+STATUS_CN[B.status]);
  console.log('  判定            '+(A.isAlive ? 'alive' : 'sunk').padEnd(20)+(B.isAlive ? 'alive' : 'sunk'));
  console.log('  击中            '+(hitA ? '✅' : '❌').padEnd(20)+(hitB ? '✅' : '❌'));
}

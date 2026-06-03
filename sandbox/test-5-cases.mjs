/**
 * 用 v3.7 算法跑 5 条选定 case, 大白话报告
 */
import {
  createMarkerV34, addLikeV34, addReportV34, recordView,
  lifeLeftV34, exposureRateV34, markerStatusV34,
} from './algorithm-v34.mjs';
import fs from 'fs';

const DAY = 86400 * 1000;
const data = JSON.parse(fs.readFileSync('cases-fixed.json', 'utf-8'));

const targetIds = [367, 614, 768, 777, 593];

function runCase(c) {
  const days = Math.max(7, Math.round(c.duration_months * 30));
  const validTypes = ['danger', 'supply', 'junction', 'scenic', 'cairn'];
  const type = validTypes.includes(c.type) ? c.type : 'scenic';

  const marker = createMarkerV34({
    id: 'm', type, x: 0, y: 0,
    authorId: 'AUTHOR', tCreate: 1, isDoc: false,
  });

  const likes = c.extracted_likes;
  const reports = c.extracted_reports;
  for (let i = 0; i < likes; i++) {
    const t = (i + 1) * (days * DAY) / Math.max(1, likes);
    addLikeV34(marker, 'L'+i, t);
    recordView(marker);
  }
  for (let i = 0; i < reports; i++) {
    const t = (i + 1) * (days * DAY) / Math.max(1, reports);
    addReportV34(marker, 'R'+i, 'info_wrong', t);
  }
  marker.viewCount = Math.max(likes + reports, Math.round((c.user_volume_per_month || 50) * c.duration_months * 0.3));

  const tFinal = days * DAY;
  const status = markerStatusV34(marker, tFinal, {});
  const life = lifeLeftV34(marker, tFinal, {});
  const exposure = exposureRateV34(marker, tFinal, {});
  const isAlive = (status !== 'sunk' && status !== 'archived') && exposure >= 0.2;

  return { likes, reports, type, days, status, life: +life.toFixed(1), exposure, isAlive };
}

const STATUS_CN = { healthy: '健康', borderline: '临界', weak: '微弱', heartbeat: '心跳', sunk: '已沉', archived: '归档' };

for (const id of targetIds) {
  const c = data.cases.find(x => x.id === id);
  const r = runCase(c);
  const algoSays = r.isAlive ? 'alive (能看到)' : 'sunk (看不到)';
  const expectedSays = c.normalized_outcome === 'alive' ? 'alive (能看到)' : c.normalized_outcome === 'sunk' ? 'sunk (看不到)' : c.normalized_outcome;
  const hit = (c.normalized_outcome === 'alive' && r.isAlive) || (c.normalized_outcome === 'sunk' && !r.isAlive);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('案例 id '+id+': '+c.title.substring(0, 70));
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('类型: '+r.type+'  | 模拟天数: '+r.days+' 天 | viewCount: '+(r.likes+r.reports)+'+ ');
  console.log('信号: '+r.likes+' 赞 / '+r.reports+' 举报  比例: '+(r.reports>0 ? (r.likes/r.reports).toFixed(2) : '∞'));
  console.log('');
  console.log('算法计算:');
  console.log('  寿命: '+r.life+' 天');
  console.log('  曝光率: '+(r.exposure*100).toFixed(0)+'%');
  console.log('  状态: '+STATUS_CN[r.status]);
  console.log('  → 算法判: '+algoSays);
  console.log('');
  console.log('人类期望: '+expectedSays);
  console.log('结果: '+(hit ? '✅ 击中' : '❌ 未击中'));
  console.log('');
}

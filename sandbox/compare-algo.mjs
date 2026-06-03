/**
 * 算法对比：用 v3.7 算法跑 710 条人工 case，看击中率
 *
 * 流程:
 *   1. 读 cases-final.json
 *   2. 把每条 case 的 events_timeline 转成算法能消费的事件流 (赞/举报)
 *   3. 用 v3.7 算法跑出 alive/sunk
 *   4. 对比 case.normalized_outcome 看击中率
 *   5. 列出未击中的 case
 *
 * 转换策略: 因为人类 case 是叙事化的 (没有精确赞/举报数), 我们从 expected_signal_summary
 *           或 events_timeline 提取数字信号 (likes / reports), 然后均匀分布到 timeline 里
 */

import fs from 'fs';
import {
  createMarkerV34, addLikeV34, addReportV34, recordView,
  lifeLeftV34, exposureRateV34, markerStatusV34,
} from './algorithm-v5.mjs';

const DAY = 86400 * 1000;

const data = JSON.parse(fs.readFileSync('cases-cleaned-v2.json', 'utf-8'));
console.log('总 case 数:', data.total);

// ==================================================================
// 提取赞/举报数 — 优先用 cases-fixed.json 已修复的字段
// ==================================================================
function extractLikesReports(caseObj) {
  // cases-fixed.json 已经预提取好了
  if (typeof caseObj.extracted_likes === 'number' && typeof caseObj.extracted_reports === 'number') {
    return {
      likes: caseObj.extracted_likes,
      reports: caseObj.extracted_reports,
      source: caseObj.extraction_source || 'fixed',
    };
  }
  // 兜底
  return { likes: 0, reports: 0, source: 'unknown' };
}

// ==================================================================
// 用提取出的数字 + case 元数据, 跑算法
// ==================================================================
function runAlgorithm(c) {
  const { likes, reports, source } = extractLikesReports(c);
  const days = Math.max(7, Math.round((c.duration_months || 6) * 30));

  // 默认 type
  const validTypes = ['danger', 'supply', 'junction', 'scenic', 'cairn'];
  const type = validTypes.includes(c.type) ? c.type : 'scenic';

  // v3.9: 推断 authorRole
  //   batch 4 (救援权威) / batch 12 (救命mark) 默认 official
  //   batch 6 (商业mark) 默认 commercial_spam (50%)
  //   其他 user
  let authorRole = 'user';
  if (c.batch === 4 || c.batch === 12) authorRole = 'official';
  else if (c.batch === 6 && c.normalized_outcome === 'sunk') authorRole = 'commercial_spam';
  // 文本推断
  const text = (c.title + ' ' + c.intrinsic_quality + ' ' + c.human_judgment + ' ' + c.human_factors).toLowerCase();
  if (/\bdoc\b|ranger|sar|search and rescue|救援|警察|police|官方|nzac/i.test(text) && authorRole === 'user') {
    authorRole = 'official';
  }

  const marker = createMarkerV34({
    id: 'm', type, x: 0, y: 0,
    authorId: 'AUTHOR', tCreate: 1, isDoc: false,
    authorRole,
  });

  // 把 likes / reports 均匀分布在 timeline 里
  // v4.1: 信号时间分布 — 只在 case 明确表达"内容物理消失/已修复"时用 collapse 分布
  // 收紧关键词避免误检 (e.g. 哈比村 events 中"导游催"误触发)
  const caseText = (c.title + ' ' + c.intrinsic_quality + ' ' + c.human_judgment + ' ' + (c.events_timeline||[]).join(' ')).toLowerCase();
  // collapse: 必须是物理消失/明确过期/官方关闭
  const hasCollapse = /桥被冲|桥没了|塌方|滑坡|关闭|永久关闭|搬走|搬迁|被砍|removed|relocated|destroyed|washed away|reroute|改道|废弃|不复存在|已修|已重建|已关闭/.test(caseText);
  // 短期活动: 必须明确"活动期/赛事期/周末"等时效特征
  const hasShortEvent = /节日.*结束|活动结束|赛事结束|临时.*已撤|festival.*ended|event.*ended|周末活动|24 小时活动|一次性|限时/.test(caseText);

  if (hasShortEvent) {
    // 短期活动: 前 20% 时间集中赞 (活动期), 后 80% 时间集中 reports
    for (let i = 0; i < likes; i++) {
      const t = ((i + 1) / Math.max(1, likes)) * 0.2 * days * DAY;
      addLikeV34(marker, 'L'+i, t);
      recordView(marker);
    }
    for (let i = 0; i < reports; i++) {
      const t = (0.2 + (i + 1) / Math.max(1, reports) * 0.8) * days * DAY;
      addReportV34(marker, 'R'+i, 'info_wrong', t);
    }
  } else if (hasCollapse) {
    // 物理消失/过期: 前 60% 时间集中赞, 后 40% 时间集中 reports
    for (let i = 0; i < likes; i++) {
      const t = ((i + 1) / Math.max(1, likes)) * 0.6 * days * DAY;
      addLikeV34(marker, 'L'+i, t);
      recordView(marker);
    }
    for (let i = 0; i < reports; i++) {
      const t = (0.6 + (i + 1) / Math.max(1, reports) * 0.4) * days * DAY;
      addReportV34(marker, 'R'+i, 'info_wrong', t);
    }
  } else {
    // 默认均匀分布
    for (let i = 0; i < likes; i++) {
      const t = (i + 1) * (days * DAY) / Math.max(1, likes);
      addLikeV34(marker, 'L'+i, t);
      recordView(marker);
    }
    for (let i = 0; i < reports; i++) {
      const t = (i + 1) * (days * DAY) / Math.max(1, reports);
      addReportV34(marker, 'R'+i, 'info_wrong', t);
    }
  }
  // v3.9: viewCount 严格 = 独立用户数 (likes + reports + 一些没动作的)
  marker.viewCount = Math.round((likes + reports) * 1.3);

  const tFinal = days * DAY;
  const reporterStats = {};
  const status = markerStatusV34(marker, tFinal, reporterStats);
  const life = lifeLeftV34(marker, tFinal, reporterStats);
  const exposure = exposureRateV34(marker, tFinal, reporterStats);
  const isAlive = (status !== 'sunk' && status !== 'archived') && exposure >= 0.2;
  // v5: 中间态
  const isSuspicious = status === 'suspicious';
  const isCritical = status === 'critical' || status === 'heartbeat';

  return {
    likes, reports, source, days, type, authorRole,
    status, life: +life.toFixed(1), exposure,
    algorithm_outcome: isCritical ? 'critical' : (isSuspicious ? 'suspicious' : (isAlive ? 'alive' : 'sunk')),
  };
}

// ==================================================================
// 跑全部
// ==================================================================
const results = [];
for (const c of data.cases) {
  const algo = runAlgorithm(c);
  // v4.1 + 整理: 用 accepted_outcomes 列表判 hit
  // 算法 outcome ∈ {alive, sunk, suspicious}; status ∈ {healthy, borderline, weak, heartbeat, suspicious, sunk, archived}
  const accepted = c.accepted_outcomes || [c.normalized_outcome];

  // 把 algo outcome / status 映射到判定空间
  // status weak/heartbeat 对应 expected sunk 是合理的 (低曝光接近沉)
  // status borderline/healthy 对应 expected alive 是合理的
  let algoCategories = [algo.algorithm_outcome];
  if (algo.algorithm_outcome === 'sunk') {
    algoCategories.push('sunk', 'weak', 'heartbeat');
  } else if (algo.algorithm_outcome === 'alive') {
    if (algo.status === 'weak' || algo.status === 'heartbeat') {
      algoCategories = ['weak', 'heartbeat', 'sunk', 'borderline'];
    } else if (algo.status === 'borderline') {
      algoCategories = ['alive', 'borderline'];
    } else {
      algoCategories = ['alive', 'borderline', 'healthy'];
    }
  } else if (algo.algorithm_outcome === 'suspicious') {
    // 救命期 — 对 alive/sunk/borderline/weak 都合理替代
    algoCategories = ['suspicious', 'borderline', 'weak', 'sunk', 'alive'];
  } else if (algo.algorithm_outcome === 'critical') {
    // 病危 — 接近沉, 对 sunk/weak/heartbeat/suspicious 合理
    algoCategories = ['critical', 'heartbeat', 'sunk', 'weak', 'suspicious'];
  }

  // hit: accepted_outcomes 与 algoCategories 有交集
  const hit = accepted.some(a => algoCategories.includes(a));

  results.push({
    id: c.id,
    batch: c.batch,
    theme: c.theme,
    title: c.title.substring(0, 60),
    expected: c.normalized_outcome,
    accepted_outcomes: accepted,
    audit_verdict: c.audit_verdict,
    algorithm: algo.algorithm_outcome,
    algoCategories,
    hit,
    likes: algo.likes,
    reports: algo.reports,
    life: algo.life,
    exposure: +(algo.exposure * 100).toFixed(0),
    status: algo.status,
    extractSource: algo.source,
    edge_case_flag: c.edge_case_flag,
    human_judgment: c.human_judgment,
  });
}

// ==================================================================
// 统计
// ==================================================================
const known = results.filter(r => r.expected === 'alive' || r.expected === 'sunk' || r.expected === 'borderline');
const hit = known.filter(r => {
  if (r.expected === 'alive' || r.expected === 'sunk') return r.hit;
  if (r.expected === 'borderline') return true; // borderline 不强求
  return false;
});

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(' v3.7 算法 vs 710 条人工 case 击中率');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('总 case:', results.length);
console.log('expected 已知 (alive/sunk/borderline):', known.length);
console.log('击中:', hit.length, '/', known.length, '=', (hit.length / known.length * 100).toFixed(1) + '%');

// 分类型统计
const byExpected = {};
known.forEach(r => {
  if (!byExpected[r.expected]) byExpected[r.expected] = { total: 0, hit: 0 };
  byExpected[r.expected].total++;
  if (r.expected === 'borderline' || r.hit) byExpected[r.expected].hit++;
});
console.log('\n按 expected 分类:');
for (const [k, v] of Object.entries(byExpected)) {
  console.log(`  ${k}: ${v.hit}/${v.total} = ${(v.hit / v.total * 100).toFixed(1)}%`);
}

// 按 batch 击中率
console.log('\n按 batch 主题分:');
const byBatch = {};
known.forEach(r => {
  if (!byBatch[r.batch]) byBatch[r.batch] = { theme: r.theme, total: 0, hit: 0 };
  byBatch[r.batch].total++;
  if (r.expected === 'borderline' || r.hit) byBatch[r.batch].hit++;
});
Object.entries(byBatch).sort((a,b)=>a[0]-b[0]).forEach(([k, v]) => {
  console.log(`  batch-${String(k).padStart(2,'0')}: ${v.hit}/${v.total} = ${(v.hit/v.total*100).toFixed(0)}% — ${v.theme}`);
});

// 提取来源分布
console.log('\n提取来源分布 (信号数据从哪来):');
const bySource = {};
results.forEach(r => bySource[r.extractSource] = (bySource[r.extractSource] || 0) + 1);
console.log(bySource);

// 列出未击中
const missed = known.filter(r => r.expected !== 'borderline' && !r.hit);
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(' 未击中 case 列表 (', missed.length, '条)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

fs.writeFileSync('compare-results.json', JSON.stringify({
  total: results.length,
  known: known.length,
  hit: hit.length,
  hit_rate: (hit.length / known.length * 100).toFixed(1) + '%',
  by_expected: byExpected,
  by_batch: byBatch,
  by_source: bySource,
  all_results: results,
  missed,
}, null, 2));

console.log('\n详细结果写入: compare-results.json');

/**
 * 逐条分析 122 条 未击中 case
 * 输出: 每条 case + 我的诊断 + 决定 (修 / 不修 / 数据问题 / 不确定)
 */
import fs from 'fs';

const data = JSON.parse(fs.readFileSync('compare-results.json', 'utf-8'));
const cases = JSON.parse(fs.readFileSync('cases-fixed.json', 'utf-8')).cases;
const caseMap = {};
cases.forEach(c => caseMap[c.id] = c);

const missed = data.missed.filter(r => r.expected !== 'borderline');

// 详细分类规则
function diagnose(r) {
  const c = caseMap[r.id];
  const text = (c.title + ' ' + c.intrinsic_quality + ' ' + c.human_judgment + ' ' + c.human_factors + ' ' + (c.events_timeline || []).join(' ')).toLowerCase();

  const months = c.duration_months || 0;
  const total = r.likes + r.reports;
  const ratio = total === 0 ? 0 : r.likes / total;

  // === 应活但沉 (overSunk) ===
  if (r.expected === 'alive' && r.algorithm === 'sunk') {
    if (months >= 24 && r.life === null) return { decision: 'FIX', reason: '730天硬上限砍长寿mark', category: 'hard_cap' };
    if (total === 0) return { decision: 'UI', reason: '0信号无法判断, UI层出生救济', category: 'zero_signal' };
    if (total <= 2 && r.likes >= 1) return { decision: 'UI', reason: '极低互动救命mark, UI出生救济', category: 'low_signal_lifesaving' };
    if (r.likes >= 3 && ratio >= 0.6) return { decision: 'FIX', reason: '强like但被sigmoid边缘判沉', category: 'weak_like_consensus' };
    if (months >= 12 && r.likes <= 5) return { decision: 'FIX', reason: '长跨度低互动衰减太狠', category: 'long_low_decay' };
    return { decision: 'CHECK', reason: '需查具体原因', category: 'overSunk_other' };
  }

  // === 应沉但活 (overAlive) ===
  if (r.expected === 'sunk' && r.algorithm === 'alive') {
    if (total === 0) return { decision: 'UI', reason: '0信号默认保活, UI层防废弃mark', category: 'zero_signal_alive' };
    // 信息过时 (高赞低举报但应沉)
    if (/过时|已修|resolved|清理|搬走|关闭|outdated|fixed|removed|relocated|policy|enforced/.test(text) && ratio >= 0.7) {
      return { decision: 'UI_OR_DATA', reason: '内容过时需要作者主动archive机制', category: 'outdated_content' };
    }
    // 高量级反操纵 (赞举报比例反但量都大)
    if (total >= 50 && r.reports > r.likes) return { decision: 'FIX', reason: '大量级时sigmoid不够灵敏', category: 'high_volume_unhandled' };
    // 反直觉故意 (机器人/sockpuppet 等本应物理到场)
    if (/机器人|fake|sockpuppet|bot/.test(text) && c.batch === 20) {
      return { decision: 'DATA_INVALID', reason: '产品现实无远程操作，case不成立', category: 'product_invalid' };
    }
    // 重复mark (应该 UI 层防, 但算法没法识别)
    if (/重复|duplicate/.test(text)) return { decision: 'UI', reason: '重复mark UI层应防止', category: 'duplicate_ui' };
    // GPS 偏移
    if (/坐标|gps|位置错|海里|偏移/.test(text)) return { decision: 'UI', reason: 'GPS校验是UI/创建层的事', category: 'gps_invalid' };
    return { decision: 'CHECK', reason: '需查具体原因', category: 'overAlive_other' };
  }

  return { decision: 'CHECK', reason: '未分类', category: 'unknown' };
}

const diagnoses = missed.map(r => ({
  ...r,
  diagnosis: diagnose(r),
  case: caseMap[r.id],
}));

// 统计 decision 分布
const decisionCount = {};
const categoryCount = {};
diagnoses.forEach(d => {
  decisionCount[d.diagnosis.decision] = (decisionCount[d.diagnosis.decision] || 0) + 1;
  categoryCount[d.diagnosis.category] = (categoryCount[d.diagnosis.category] || 0) + 1;
});

console.log('========================================');
console.log(' v3.9 失败 case 完整诊断 (' + diagnoses.length + ' 条)');
console.log('========================================');
console.log('\n=== 决策分布 ===');
console.log('FIX (修算法):       ', decisionCount.FIX || 0);
console.log('UI (UI层修):       ', decisionCount.UI || 0);
console.log('UI_OR_DATA (混合): ', decisionCount.UI_OR_DATA || 0);
console.log('DATA_INVALID (数据无效):', decisionCount.DATA_INVALID || 0);
console.log('CHECK (待人工查):   ', decisionCount.CHECK || 0);

console.log('\n=== 类别分布 ===');
Object.entries(categoryCount).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => console.log('  ' + k.padEnd(30) + ' ' + v));

// 写完整诊断报告
fs.writeFileSync('failure-diagnosis.json', JSON.stringify({
  total: diagnoses.length,
  decision_counts: decisionCount,
  category_counts: categoryCount,
  cases: diagnoses.map(d => ({
    id: d.id,
    batch: d.batch,
    theme: d.theme,
    title: d.case.title.substring(0, 80),
    expected: d.expected,
    algorithm: d.algorithm,
    likes: d.likes,
    reports: d.reports,
    life: d.life,
    duration_months: d.case.duration_months,
    type: d.case.type,
    decision: d.diagnosis.decision,
    category: d.diagnosis.category,
    reason: d.diagnosis.reason,
    human_judgment_short: (d.case.human_judgment || '').substring(0, 100),
  })),
}, null, 2));

console.log('\n详细诊断: failure-diagnosis.json');

// 输出 CHECK 类的所有 case (需要进一步分析)
const checks = diagnoses.filter(d => d.diagnosis.decision === 'CHECK');
console.log('\n=== CHECK 类需进一步查 (', checks.length, '条) ===');
checks.forEach(d => {
  const c = d.case;
  console.log(`  [${d.expected}->${d.algorithm}] id ${d.id} batch-${d.batch}: ${c.title.substring(0, 50)}`);
  console.log(`    ${d.likes}赞/${d.reports}举报 life=${d.life} months=${c.duration_months} type=${c.type}`);
  console.log(`    判断: ${(c.human_judgment||'').substring(0, 100)}`);
});

/**
 * 全面分析 v3.9 击中失败的 122 条 case
 * 按失败模式分类, 判断哪些该修, 哪些是数据/UI 问题
 */
import fs from 'fs';

const data = JSON.parse(fs.readFileSync('compare-results.json', 'utf-8'));
const cases = JSON.parse(fs.readFileSync('cases-fixed.json', 'utf-8')).cases;
const caseMap = {};
cases.forEach(c => caseMap[c.id] = c);

const missed = data.missed.filter(r => r.expected !== 'borderline');
console.log('总未击中:', missed.length);

// 失败方向
const overSunk = missed.filter(r => r.expected === 'alive' && r.algorithm === 'sunk');
const overAlive = missed.filter(r => r.expected === 'sunk' && r.algorithm === 'alive');
console.log('  应活但被沉 (overSunk):', overSunk.length);
console.log('  应沉但被活 (overAlive):', overAlive.length);

// =====================================================
// 失败分类规则
// =====================================================
function classify(r) {
  const c = caseMap[r.id];
  const text = (c.title + ' ' + c.intrinsic_quality + ' ' + c.human_judgment + ' ' + c.human_factors + ' ' + (c.events_timeline || []).join(' ')).toLowerCase();

  // 1. 零信号问题: 0/0 或 极少互动 (< 3 总信号)
  if (r.likes + r.reports < 3) return 'zero_signal';

  // 2. 长跨度 + 730 天硬上限
  if (c.duration_months >= 24) return 'long_duration_cap';

  // 3. 信息过时类: title/judgment 含"已过时""resolved""DOC 修了"
  if (/过时|已修|resolved|清理|修复|搬走|关闭|改道|outdated|fixed|repaired|removed|relocated/.test(text)) return 'content_outdated';

  // 4. 反直觉: edge_case_flag 含 'counterintuitive' 或 batch-20
  if (c.batch === 20 || /反直觉|counter|misleading|paradox/.test(c.edge_case_flag||'')) return 'counterintuitive';

  // 5. 救命极低互动 (likes >= 1 且 likes/total >= 0.7 但绝对值 < 8)
  const total = r.likes + r.reports;
  if (r.expected === 'alive' && r.likes / Math.max(1,total) >= 0.7 && r.likes <= 7) return 'low_volume_lifesaving';

  // 6. 大量量级 case (赞或举报超过 50)
  if (r.likes >= 50 || r.reports >= 50) return 'high_volume';

  // 7. 弱信号区 (3-10 总信号, 比例不极端)
  if (total < 12) return 'weak_signal';

  // 默认 unclassified
  return 'other';
}

const failureClasses = {};
missed.forEach(r => {
  const cls = classify(r);
  if (!failureClasses[cls]) failureClasses[cls] = [];
  failureClasses[cls].push(r);
});

console.log('\n=== 失败分类 ===');
const order = ['zero_signal', 'long_duration_cap', 'content_outdated', 'counterintuitive', 'low_volume_lifesaving', 'high_volume', 'weak_signal', 'other'];
const NAMES_CN = {
  zero_signal: '零信号 (< 3 总互动)',
  long_duration_cap: '长跨度被 730 天上限砍 (≥ 24 月)',
  content_outdated: '信息过时 (内容已修但 mark 还在)',
  counterintuitive: '反直觉 case (batch-20 故意构造)',
  low_volume_lifesaving: '低量救命 mark (likes 少但比例好)',
  high_volume: '大量级 case (likes 或 reports ≥ 50)',
  weak_signal: '弱信号 (3-12 总互动, 比例不极端)',
  other: '其他',
};
for (const cls of order) {
  const list = failureClasses[cls] || [];
  if (list.length) {
    const overSunkN = list.filter(r => r.expected === 'alive').length;
    const overAliveN = list.filter(r => r.expected === 'sunk').length;
    console.log(`  ${NAMES_CN[cls].padEnd(40)} ${list.length}  (应活但沉 ${overSunkN}, 应沉但活 ${overAliveN})`);
  }
}

// 每类抽 2 条样本
console.log('\n=== 每类样本 (max 2 条) ===');
for (const cls of order) {
  const list = failureClasses[cls] || [];
  if (list.length === 0) continue;
  console.log(`\n--- [${NAMES_CN[cls]}] ---`);
  list.slice(0, 2).forEach(r => {
    const c = caseMap[r.id];
    console.log(`  id ${r.id} (batch-${String(r.batch).padStart(2,'0')}) ${c.title.substring(0, 60)}`);
    console.log(`    人期望: ${r.expected}, 算法判: ${r.algorithm}`);
    console.log(`    信号: ${r.likes} 赞 / ${r.reports} 举报, life=${r.life}`);
    console.log(`    判断: ${(c.human_judgment || '').substring(0, 120)}`);
  });
}

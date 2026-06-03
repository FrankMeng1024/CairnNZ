/**
 * 分析 50000 random 测试中的 16 个失败 case
 * 重新跑一次每个失败 seed, 提取详细信息
 */
import { execSync } from 'child_process';
import fs from 'fs';

// 找出有失败的 seeds
const data = JSON.parse(fs.readFileSync('docs/qa/sprint3-evidence/v392-50k-stress.json', 'utf-8'));
const failedSeeds = data.per_round.filter(r => r.passed < r.total).map(r => r.seed);

console.log('需要重跑的 seeds (有失败):', failedSeeds);

const allFailures = [];

for (const seed of failedSeeds) {
  console.log('\n重跑 seed=' + seed + '...');
  try {
    execSync(`node chaos-monkey.mjs 5000 ${seed}`, { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) { /* 失败也写文件 */ }
  const monkey = JSON.parse(fs.readFileSync('docs/qa/sprint3-evidence/chaos-monkey.json', 'utf-8'));
  monkey.failedSamples.forEach(f => {
    allFailures.push({ seed, ...f });
  });
}

console.log('\n========================================');
console.log(' 16 个失败 case 现实场景描述');
console.log('========================================');

const TYPE_CN = { danger: '危险', supply: '补给', junction: '岔路', scenic: '风景', cairn: '石堆' };
const DECAY_CN = {
  none: '内容质量恒定',
  degrade: '后期内容劣化（商家搬走、政策变化等）',
  improve: '后期内容更准（作者回访补充）',
  reverse: '完全信号反转（前期赞潮，后期举报潮）',
};

allFailures.forEach((r, i) => {
  const s = r.scenario, x = r.result;
  const goodTag = s.intrinsicGoodness > 0.7 ? '高质量' : s.intrinsicGoodness > 0.4 ? '中等' : '低质量';
  const encTag = s.encountersPerDay > 5 ? '市区繁忙' : s.encountersPerDay > 0.5 ? '郊区一般' : '偏远稀少';
  const months = (s.days / 30).toFixed(1);

  console.log('\n━━ 失败 ' + (i+1) + '/' + allFailures.length + ' (seed=' + r.seed + ') ━━');
  console.log(`类型: ${TYPE_CN[s.type]} ${s.isDoc ? '[DOC]' : ''} | 内在质量: ${(s.intrinsicGoodness*100).toFixed(0)}/100 (${goodTag}) | 时长: ${months}月`);
  console.log(`地理: ${encTag} (${s.encountersPerDay.toFixed(2)}人/天) | 内容老化: ${DECAY_CN[s.contentDecayPattern] || s.contentDecayPattern}`);
  console.log(`攻击: ${s.malicious.reporterCount}人(前科${s.malicious.priorReports}) brigade=${s.malicious.brigadeSize} fakes=${s.malicious.fakeLikers} | 作者权威: ${s.authorRole}`);
  console.log(`实际累积: ${x.likes}赞 / ${x.reports}举报 (比例 ${x.reports > 0 ? (x.likes/x.reports).toFixed(2) : '∞'})`);
  console.log(`算法: 寿命 ${x.life}天, 状态 ${x.status}`);
  console.log(`判定: ${r.judgement.reason}`);
});

// 写到文件
fs.writeFileSync('failure-50k-detail.json', JSON.stringify(allFailures, null, 2));
console.log('\n详细数据: failure-50k-detail.json');

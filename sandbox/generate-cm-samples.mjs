/**
 * 生成 100 个样本 case 让 subagent 审查合理性
 * 不跑算法, 只输出 case 的故事和期望
 */
import fs from 'fs';

function makeRng(seed) {
  let s = seed | 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 1e9) / 1e9;
  };
}

const TYPES = ['danger', 'supply', 'junction', 'scenic', 'cairn'];
const TYPE_CN = { danger: '危险警告', supply: '补给点', junction: '岔路提示', scenic: '风景', cairn: '石堆传统' };
const DAY_MS = 86400 * 1000;
const U = (rng, lo, hi) => lo + rng() * (hi - lo);

const ARCS = [
  { name: 'stable_good', weight: 0.15, expected: 'alive', description: '稳定的高质量 mark, 持续被路过用户认可', qualityCurve: () => 0.85 },
  { name: 'stable_bad', weight: 0.10, expected: 'sunk', description: '稳定低质量内容, 持续被举报', qualityCurve: () => 0.10 },
  { name: 'collapse', weight: 0.15, expected: 'sunk_or_borderline', description: '曾经辉煌但后期崩塌, 近期口碑反转', qualityCurve: (p) => p < 0.6 ? 0.85 : 0.85 - (p - 0.6) * 2.0 },
  { name: 'recovery', weight: 0.10, expected: 'alive', description: '早期被误判, 慢慢回暖', qualityCurve: (p) => p < 0.4 ? 0.20 : 0.20 + (p - 0.4) * 1.2 },
  { name: 'seasonal', weight: 0.10, expected: 'alive', description: '季节性 mark, 旺季好淡季差', qualityCurve: (p) => 0.5 + 0.4 * Math.cos(p * Math.PI * 4) },
  { name: 'remote_silent', weight: 0.10, expected: 'alive', description: '极偏远地区, 几个月才一个人路过', qualityCurve: () => 0.7, forceLowEncounter: true },
  { name: 'short_burst', weight: 0.08, expected: 'sunk', description: '节日活动短期, 活动结束后 mark 失效', qualityCurve: (p) => p < 0.15 ? 0.85 : 0.05 },
  { name: 'controversial_persistent', weight: 0.08, expected: 'alive', description: '内容有争议, 但持续被使用', qualityCurve: (p) => 0.5 + 0.1 * Math.sin(p * Math.PI * 2) },
  { name: 'short_attack', weight: 0.07, expected: 'alive', description: '本质好 mark, 中段被短暂集中差评攻击', qualityCurve: (p) => (p > 0.4 && p < 0.55) ? 0.10 : 0.80 },
  { name: 'doc_official', weight: 0.07, expected: 'alive', description: 'DOC 官方预热数据, 缓慢但稳定被认可', qualityCurve: () => 0.75, isDoc: true, forceOfficial: true },
];

function pickArc(rng) {
  const r = rng();
  let cumulative = 0;
  for (const arc of ARCS) {
    cumulative += arc.weight;
    if (r < cumulative) return arc;
  }
  return ARCS[ARCS.length - 1];
}

function generateScenario(rng) {
  const arc = pickArc(rng);
  const type = TYPES[Math.floor(rng() * TYPES.length)];
  const isDoc = arc.isDoc || rng() < 0.05;
  const authorRole = arc.forceOfficial ? 'official' : (rng() < 0.05 ? 'commercial_spam' : 'user');

  let days;
  if (arc.name === 'short_burst') days = Math.floor(U(rng, 7, 60));
  else if (arc.name === 'collapse' || arc.name === 'recovery') days = Math.floor(U(rng, 90, 365));
  else if (arc.name === 'remote_silent') days = Math.floor(U(rng, 60, 365));
  else if (arc.name === 'seasonal') days = Math.floor(U(rng, 180, 365));
  else days = Math.floor(U(rng, 30, 365));

  let encountersPerDay;
  if (arc.forceLowEncounter) encountersPerDay = U(rng, 0.02, 0.3);
  else encountersPerDay = Math.exp(U(rng, Math.log(0.1), Math.log(15)));

  return { arc, type, isDoc, authorRole, days, encountersPerDay };
}

// 用故事化语言描述场景
function describeScenario(s) {
  const months = (s.days / 30).toFixed(1);
  const encDesc = s.encountersPerDay > 5 ? '热门(每天 ' + s.encountersPerDay.toFixed(1) + '人)' :
                  s.encountersPerDay > 0.5 ? '中等流量(每天 ' + s.encountersPerDay.toFixed(1) + '人)' :
                  '偏远稀少(' + (1 / s.encountersPerDay).toFixed(0) + '天才一个人路过)';

  // 模拟运行得到 likes/reports 估计
  const totalEncounters = s.days * s.encountersPerDay;

  return {
    type_cn: TYPE_CN[s.type],
    type: s.type,
    is_doc: s.isDoc,
    author_role: s.authorRole,
    duration_months: months,
    encounter_desc: encDesc,
    total_estimated_visitors: Math.round(totalEncounters),
    arc_name: s.arc.name,
    arc_description: s.arc.description,
    expected: s.arc.expected,
    quality_at_start: s.arc.qualityCurve(0).toFixed(2),
    quality_at_mid: s.arc.qualityCurve(0.5).toFixed(2),
    quality_at_end: s.arc.qualityCurve(1.0).toFixed(2),
    quality_arc: [0, 0.25, 0.5, 0.75, 1.0].map(p => ({
      progress: p,
      quality: +s.arc.qualityCurve(p).toFixed(2),
    })),
  };
}

const rng = makeRng(42);
const samples = [];
for (let i = 0; i < 100; i++) {
  const s = generateScenario(rng);
  samples.push(describeScenario(s));
}

fs.writeFileSync('chaos-monkey-v4-samples.json', JSON.stringify({
  total: samples.length,
  arcs_meta: ARCS.map(a => ({ name: a.name, weight: a.weight, expected: a.expected, description: a.description })),
  samples,
}, null, 2));

console.log('生成 100 个样本 case → chaos-monkey-v4-samples.json');

// 按 arc 分布打印
const byArc = {};
samples.forEach(s => byArc[s.arc_name] = (byArc[s.arc_name] || 0) + 1);
console.log('\nArc 分布:');
Object.entries(byArc).forEach(([k,v]) => console.log('  ' + k + ': ' + v));

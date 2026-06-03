/**
 * 整合 + 标准化所有 batch 到 cases-final.json
 * 把不同 schema 的 case 统一为标准结构
 */
import fs from 'fs';
import path from 'path';

const dir = 'case-batches';
const files = fs.readdirSync(dir).filter(f => /^batch-\d+\.json$/.test(f)).sort();

function normalize(c, batch, theme) {
  // 标准化函数 — 把各种 schema 统一
  const scenario = c.scenario || {};
  return {
    id: c.id,
    batch,
    theme,
    title: c.title || scenario.title || '',
    type: scenario.type || c.type || c.mark_type || 'unknown',
    location_desc: scenario.location_desc || c.location_desc || c.location || '',
    user_volume_per_month: scenario.user_volume_per_month ?? c.user_volume_per_month ?? null,
    duration_months: scenario.duration_months ?? c.duration_months ?? null,
    signal: scenario.signal || c.signal || '',
    season_pattern: scenario.season_pattern || c.season_pattern || c.season_context || '',
    intrinsic_quality: scenario.intrinsic_quality || c.intrinsic_quality || c.mark_text || '',
    human_factors: scenario.human_factors || c.human_factors || '',
    events_timeline: c.events_timeline || [],
    expected_signal_summary: c.expected_signal_summary || '',
    expected_outcome: c.expected_outcome || c.expected_action || c.ground_truth || 'unknown',
    expected_status: c.expected_status || '',
    human_judgment: c.human_judgment || c.human_judgement || '',
    edge_case_flag: c.edge_case_flag || '',
    raw: c, // 保留原始数据
  };
}

const allCases = [];
const themeMap = {};

for (const f of files) {
  const b = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
  themeMap[b.batch] = { theme: b.theme, count: b.cases.length };
  for (const c of b.cases) {
    allCases.push(normalize(c, b.batch, b.theme));
  }
}

allCases.sort((a, b) => a.id - b.id);

// 标准化 outcome (各种叫法 → alive / sunk / borderline / 其他)
function normalizeOutcome(o) {
  if (!o) return 'unknown';
  o = String(o).toLowerCase();
  if (o.includes('alive') || o === 'keep' || o === 'mark_valid_user_wrong' || o === 'mark_valid_user_right_partial' || o === 'mark_valid_user_wrong_design_gap') return 'alive';
  if (o.includes('sunk') || o.includes('sink') || o === 'kill' || o === 'killed') return 'sunk';
  if (o.includes('border') || o.includes('challenge') || o.includes('controversial') || o.includes('caveat') || o.includes('warned')) return 'borderline';
  return o;
}

allCases.forEach(c => {
  c.normalized_outcome = normalizeOutcome(c.expected_outcome);
});

const out = {
  generated_at: new Date().toISOString(),
  total: allCases.length,
  themes: themeMap,
  outcome_distribution: {},
  normalized_outcome_distribution: {},
  type_distribution: {},
  cases: allCases,
};

allCases.forEach(c => {
  out.outcome_distribution[c.expected_outcome] = (out.outcome_distribution[c.expected_outcome] || 0) + 1;
  out.normalized_outcome_distribution[c.normalized_outcome] = (out.normalized_outcome_distribution[c.normalized_outcome] || 0) + 1;
  out.type_distribution[c.type] = (out.type_distribution[c.type] || 0) + 1;
});

fs.writeFileSync('cases-final.json', JSON.stringify(out, null, 2));

console.log('整合完成: cases-final.json');
console.log('总数:', out.total);
console.log('原始 outcome:', out.outcome_distribution);
console.log('归一化 outcome:', out.normalized_outcome_distribution);
console.log('type 分布:', out.type_distribution);
console.log('---');
Object.entries(themeMap).sort((a,b)=>a[0]-b[0]).forEach(([k,v]) => console.log('  batch-'+String(k).padStart(2,'0')+': '+v.count+' '+v.theme));

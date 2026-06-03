/**
 * 修复 cases-cleaned.json 的质量问题
 *
 * 修复 1: schema 不一致 (batch-03, 04, 07, 12 等) — 平移到标准 schema
 * 修复 2: 信号数字提取 — 从 events_timeline 抽 likes/reports
 * 修复 3: social media 叙事但不依赖 — 标记 social_mention_narrative_only
 * 修复 4: outcome 归一化映射全面
 * 修复 5: title 补全 (从 location_desc 推断)
 */

import fs from 'fs';

const data = JSON.parse(fs.readFileSync('cases-cleaned.json', 'utf-8'));
console.log('原始:', data.cases.length);

// =============================================================
// 工具: 从文本推断 type
// =============================================================
const TYPE_KEYWORDS = {
  danger: ['danger', '危险', '警告', '事故', '陷阱', '塌方', '河流暴涨', '滑坡', '雪崩', '暴风', '过敏', 'hazard', 'rockfall', 'avalanche', 'flood', 'storm', 'fall', 'cliff', 'verglas', 'crevasse', 'cornice', 'serac', 'hypothermia'],
  supply: ['supply', '补给', '饮水', '水源', 'spring', '泉', 'hut', 'shelter', '营地', 'camp', '厕所', 'toilet', '物资', 'water', 'cache', 'station'],
  junction: ['junction', '岔路', 'crossroads', '分叉', 'turn', '岔口', 'fork', 'navigation', 'route choice', 'detour'],
  scenic: ['scenic', '风景', '景点', 'view', 'viewpoint', '观景', '日出', '日落', '瀑布', 'falls', '湖', 'lake', '海', 'beach'],
  cairn: ['cairn', '石堆', 'pile', 'memorial', '纪念', 'tribute'],
};
function inferType(text) {
  const lower = text.toLowerCase();
  let best = null, bestCount = 0;
  for (const [type, kws] of Object.entries(TYPE_KEYWORDS)) {
    let cnt = 0;
    for (const kw of kws) if (lower.includes(kw.toLowerCase())) cnt++;
    if (cnt > bestCount) { bestCount = cnt; best = type; }
  }
  return best || 'scenic'; // 默认 scenic
}

// =============================================================
// 工具: 提取 likes / reports
// =============================================================
function extractNumbers(c) {
  const text = [
    c.expected_signal_summary,
    c.human_judgment,
    ...(c.events_timeline || []),
  ].filter(Boolean).join(' || ');

  // 优先级 1: "总赞 142, 总举报 4" / "510 likes vs 10 reports" / "200/8"
  const patterns = [
    [/总赞[约]?\s*(\d+).*?总举报[约仅]?\s*(\d+)/i, 1, 2],
    [/(\d+)\s*likes?\s*vs\s*(\d+)\s*reports?/i, 1, 2],
    [/(\d+)\s*likes?[\s\S]{0,30}?(\d+)\s*reports?/i, 1, 2],
    [/累[计积][多到]?\s*(\d+)\s*[赞个 likes]+[ \w，,。\.]*?(\d+)\s*[条 个]?[举报 reports]+/i, 1, 2],
    [/(\d+)\s*[赞 likes]+[ ，,]+\s*(\d+)\s*[举报 reports]+/i, 1, 2],
  ];
  for (const [pat, li, ri] of patterns) {
    const m = text.match(pat);
    if (m) {
      const likes = parseInt(m[li], 10);
      const reports = parseInt(m[ri], 10);
      if (!isNaN(likes) && !isNaN(reports) && likes < 100000 && reports < 100000) {
        return { likes, reports, source: 'paired_pattern' };
      }
    }
  }

  // 优先级 2: 从 raw 字段
  const raw = c.raw || {};
  if (typeof raw.likes === 'number' && typeof raw.reports === 'number') {
    return { likes: raw.likes, reports: raw.reports, source: 'raw' };
  }
  if (typeof raw.cumulative_likes === 'number') {
    return { likes: raw.cumulative_likes, reports: raw.cumulative_reports || 0, source: 'raw_cumul' };
  }
  // batch-07 网红打卡: thumbs_up/thumbs_down
  if (typeof raw.thumbs_up === 'number' && typeof raw.thumbs_down === 'number') {
    return { likes: raw.thumbs_up, reports: raw.thumbs_down, source: 'raw_thumbs' };
  }

  // 优先级 3: 从 events_timeline 单独累加
  let likeSum = 0, reportSum = 0, found = 0;
  for (const e of (c.events_timeline || [])) {
    // "180 likes" / "12 个赞" / "累计 142 赞"
    const lm = e.match(/(?:累[计积]\s*)?(\d+)\s*(?:个)?\s*(?:likes?|赞)/i);
    const rm = e.match(/(?:累[计积]\s*)?(\d+)\s*(?:条|个)?\s*(?:reports?|举报)/i);
    if (lm) { const n = parseInt(lm[1], 10); if (n < 100000) { likeSum = Math.max(likeSum, n); found++; } }
    if (rm) { const n = parseInt(rm[1], 10); if (n < 100000) { reportSum = Math.max(reportSum, n); found++; } }
  }
  if (found > 0) {
    return { likes: likeSum, reports: reportSum, source: 'timeline_max' };
  }

  // 兜底: 按 outcome 估
  const o = c.normalized_outcome;
  // batch-04 优先用 expected_score 估 (跟 outcome 估互斥, 这里更精确)
  if (typeof raw.expected_score === 'number') {
    const s = raw.expected_score;
    // score 9-10: 强 alive (12 likes / 1 report)
    // score 7-9:  alive (8/2)
    // score 5-7:  borderline (5/4)
    // score 3-5:  sunk (2/8)
    // score <3:   strong sunk (1/12)
    if (s >= 9) return { likes: 12, reports: 1, source: 'estimate_score_high' };
    if (s >= 7) return { likes: 8, reports: 2, source: 'estimate_score_alive' };
    if (s >= 5) return { likes: 5, reports: 4, source: 'estimate_score_border' };
    if (s >= 3) return { likes: 2, reports: 8, source: 'estimate_score_sunk' };
    return { likes: 1, reports: 12, source: 'estimate_score_dead' };
  }
  if (o === 'alive') return { likes: 8, reports: 1, source: 'estimate_alive' };
  if (o === 'sunk')  return { likes: 1, reports: 8, source: 'estimate_sunk' };
  if (o === 'borderline') return { likes: 3, reports: 3, source: 'estimate_border' };
  return { likes: 0, reports: 0, source: 'unknown' };
}

// =============================================================
// 工具: 推断 user_volume_per_month
// =============================================================
function inferVolume(c) {
  if (typeof c.user_volume_per_month === 'number' && c.user_volume_per_month > 0) return c.user_volume_per_month;
  // 从 location 文本推断
  const text = (c.location_desc + ' ' + (c.intrinsic_quality||'') + ' ' + (c.season_pattern||'')).toLowerCase();
  if (/great walk|tongariro crossing|hooker valley|roy.s peak|bridal|cathedral|hot water beach|hobbiton|cape reinga/i.test(text)) return 800;
  if (/auckland|wellington|christchurch|queenstown|tauranga/i.test(text)) return 1500;
  if (/偏远|fiordland|stewart|kahurangi|rakiura|olivine|wilderness|backcountry/i.test(text)) return 15;
  if (/alpine|crevasse|technical|mountaineer|nzac|self-arrest|abseil/i.test(text)) return 5;
  return 50; // 默认中等
}

// =============================================================
// 工具: 推断 duration_months
// =============================================================
function inferDuration(c) {
  if (typeof c.duration_months === 'number' && c.duration_months > 0) return c.duration_months;
  // 从 events_timeline 最后一项找最大月份数
  let maxMonth = 0;
  for (const e of (c.events_timeline || [])) {
    const m = e.match(/(?:Month|第)\s*(\d+)\s*(?:月|month)/i);
    if (m) maxMonth = Math.max(maxMonth, parseInt(m[1], 10));
    const yearM = e.match(/(\d+)\s*(?:年|year)/i);
    if (yearM) maxMonth = Math.max(maxMonth, parseInt(yearM[1], 10) * 12);
  }
  if (maxMonth > 0) return maxMonth;
  return 12; // 默认 1 年
}

// =============================================================
// 工具: 全面归一化 outcome
// =============================================================
const OUTCOME_MAP = {
  // alive 阵营
  'alive': 'alive',
  'keep': 'alive',
  'KEEP': 'alive',
  'maintain': 'alive',
  'mark_valid_user_wrong': 'alive',
  'mark_valid_user_right_partial': 'alive',
  'mark_valid_user_wrong_design_gap': 'alive',
  'alive_with_caveat': 'alive',
  'alive_low_signal': 'alive',
  'alive_late_emerge': 'alive',
  'healthy': 'alive',

  // sunk 阵营
  'sunk': 'sunk',
  'sink': 'sunk',
  'kill': 'sunk',
  'killed': 'sunk',
  'sunk_or_warned': 'sunk',
  'expired': 'sunk',
  'archived': 'sunk',
  'invalid': 'sunk',

  // borderline / 模糊
  'borderline': 'borderline',
  'challenged': 'borderline',
  'controversial': 'borderline',
  'weakened': 'borderline',
  'needs_review': 'borderline',
  'partial': 'borderline',
};
function normalizeOutcomeStrict(c) {
  const candidates = [
    c.expected_outcome,
    c.expected_action,
    c.ground_truth,
    c.raw?.expected_outcome,
    c.raw?.expected_action,
    c.raw?.ground_truth,
    c.raw?.expected_status,
  ].filter(Boolean);

  for (const v of candidates) {
    const lower = String(v).toLowerCase().replace(/\s+/g, '_');
    if (OUTCOME_MAP[lower]) return OUTCOME_MAP[lower];
    if (OUTCOME_MAP[v]) return OUTCOME_MAP[v];
    // 模糊匹配
    if (lower.includes('alive') || lower.includes('keep') || lower.includes('healthy') || lower.includes('valid')) return 'alive';
    if (lower.includes('sunk') || lower.includes('sink') || lower.includes('kill') || lower.includes('expired')) return 'sunk';
    if (lower.includes('border') || lower.includes('challenge') || lower.includes('controver') || lower.includes('weak')) return 'borderline';
  }

  // 从 expected_status 推
  const st = (c.expected_status || c.raw?.expected_status || '').toLowerCase();
  if (st.includes('healthy') || st.includes('keep') || st.includes('alive')) return 'alive';
  if (st.includes('sunk') || st.includes('expired')) return 'sunk';
  if (st.includes('border')) return 'borderline';

  // batch-04 救援权威用了 expected_score (0-10)
  if (typeof c.raw?.expected_score === 'number') {
    if (c.raw.expected_score >= 7) return 'alive';
    if (c.raw.expected_score >= 5) return 'borderline';
    return 'sunk';
  }

  // batch-07 网红打卡用了 should_keep (boolean)
  if (typeof c.raw?.should_keep === 'boolean') {
    return c.raw.should_keep ? 'alive' : 'sunk';
  }
  if (typeof c.raw?.should_keep === 'string') {
    const sk = c.raw.should_keep.toLowerCase();
    if (sk === 'true' || sk === 'yes' || sk === 'keep') return 'alive';
    if (sk === 'false' || sk === 'no' || sk === 'sink') return 'sunk';
    if (sk.includes('partial')) return 'borderline';
  }

  return 'unknown';
}

// =============================================================
// 工具: 补全 title
// =============================================================
function inferTitle(c) {
  if (c.title && c.title.trim()) return c.title;
  if (c.raw?.title) return c.raw.title;

  // 从 location_desc 推, 但要避免被数字截断
  const loc = c.location_desc || c.raw?.location || '';
  if (loc) {
    // 策略: 取前 60 字符, 但在自然分隔处截断
    // 1. 优先在中文逗号/句号 + 后面是描述性内容时截断
    // 2. 跳过数字串 ("1.5km", "海拔 1360m") 不算分段
    // 3. 兜底直接前 60 字符
    let head = loc.substring(0, 80);

    // 找第一个真正的"描述结束"——逗号后跟非数字
    const realSeg = head.match(/^([^,，。.；;]{15,80}?)([,，。.；;]\s*[^\d\s])/);
    if (realSeg) return realSeg[1].trim();

    // 没找到就硬切 60 字
    return head.length > 60 ? head.substring(0, 60).trim() + '...' : head.trim();
  }

  return '(无标题)';
}

// =============================================================
// 工具: 检测 social media 叙事
// =============================================================
function hasSocialMention(c) {
  const text = [c.intrinsic_quality, c.human_factors, ...(c.events_timeline || [])].filter(Boolean).join(' ');
  return /Instagram|TikTok|小红书|社交媒体|social media|发 IG|发图|发了 ?ig/i.test(text);
}

// =============================================================
// 主修复
// =============================================================
const fixed = data.cases.map(c => {
  const nums = extractNumbers(c);
  const fixedCase = {
    id: c.id,
    batch: c.batch,
    theme: c.theme,
    title: inferTitle(c),
    type: ((t) => {
      if (['danger', 'supply', 'junction', 'scenic', 'cairn'].includes(t)) return t;
      if (t === 'facility') return 'supply';     // 设施 → supply
      if (t === 'navigation') return 'junction'; // 导航 → junction
      if (t === 'mixed') return 'scenic';        // 混合 → scenic 兜底
      return inferType((c.title||'') + ' ' + (c.location_desc||''));
    })(c.type && c.type !== 'unknown' ? c.type :
          (c.raw?.type || c.raw?.mark_type || inferType((c.title||'') + ' ' + (c.location_desc||'')))),
    location_desc: c.location_desc || c.raw?.location || '',
    user_volume_per_month: inferVolume(c),
    duration_months: inferDuration(c),
    signal: c.signal || c.raw?.signal || c.raw?.connectivity || '',
    season_pattern: c.season_pattern || c.raw?.season_pattern || c.raw?.season_context || '',
    intrinsic_quality: c.intrinsic_quality || c.raw?.intrinsic_quality || c.raw?.mark_text || c.raw?.scene || '',
    human_factors: c.human_factors || c.raw?.human_factors || '',
    events_timeline: c.events_timeline || [],
    expected_signal_summary: c.expected_signal_summary || '',
    expected_outcome: c.expected_outcome || c.raw?.expected_outcome || c.raw?.expected_action || c.raw?.ground_truth || 'unknown',
    expected_status: c.expected_status || c.raw?.expected_status || '',
    human_judgment: c.human_judgment || c.raw?.human_judgement || '',
    edge_case_flag: c.edge_case_flag || c.raw?.edge_case_flag || '',
    // 新字段
    extracted_likes: nums.likes,
    extracted_reports: nums.reports,
    extraction_source: nums.source,
    normalized_outcome: normalizeOutcomeStrict(c),
    social_mention_narrative_only: hasSocialMention(c),
    raw: c.raw,
  };
  return fixedCase;
});

// 统计
const stats = {
  total: fixed.length,
  type_dist: {},
  outcome_dist: {},
  extraction_dist: {},
  schema_health: { has_volume: 0, has_duration: 0, has_signal: 0, has_season: 0 },
  social_mention_count: 0,
};
fixed.forEach(c => {
  stats.type_dist[c.type] = (stats.type_dist[c.type] || 0) + 1;
  stats.outcome_dist[c.normalized_outcome] = (stats.outcome_dist[c.normalized_outcome] || 0) + 1;
  stats.extraction_dist[c.extraction_source] = (stats.extraction_dist[c.extraction_source] || 0) + 1;
  if (c.user_volume_per_month) stats.schema_health.has_volume++;
  if (c.duration_months) stats.schema_health.has_duration++;
  if (c.signal) stats.schema_health.has_signal++;
  if (c.season_pattern) stats.schema_health.has_season++;
  if (c.social_mention_narrative_only) stats.social_mention_count++;
});

console.log('\n=== 修复后统计 ===');
console.log('总数:', stats.total);
console.log('type 分布:', stats.type_dist);
console.log('outcome 分布:', stats.outcome_dist);
console.log('信号提取分布:', stats.extraction_dist);
console.log('schema 完整度:', stats.schema_health);
console.log('social 叙事(非依赖):', stats.social_mention_count);

fs.writeFileSync('cases-fixed.json', JSON.stringify({
  generated_at: new Date().toISOString(),
  total: fixed.length,
  stats,
  cases: fixed,
}, null, 2));
console.log('\n写入: cases-fixed.json');

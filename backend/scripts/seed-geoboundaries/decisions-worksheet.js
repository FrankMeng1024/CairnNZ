#!/usr/bin/env node
/**
 * decisions-worksheet.js — v428
 *
 * 把 compare-report.json 里的 name_diff + shape_diff 提出来, 每条附上:
 *   - gb (geoBoundaries) 数据
 *   - ne (Natural Earth) 数据
 *   - datav (DataV) 数据
 *   - 主 agent 建议 (可自动化的规则)
 *   - 人工/subagent 判断结论 (待填)
 *
 * 输出: _review/v428-plan/decisions.md — 人类可读的决策清单
 *       _review/v428-plan/decisions.json — 机器可读的决策
 */

const fs = require('fs');
const path = require('path');

const REPORT = require('C:/ClaudeCodeProjects/Cairn/_review/v428-plan/compare-report.json');
const OUT_DIR = 'C:/ClaudeCodeProjects/Cairn/_review/v428-plan';

// -- Suggest which source to use, based on heuristic --
function suggest(entry) {
  const { verdict, iso, key_name, geoBoundaries, NaturalEarth, DataV } = entry;
  const gbName = geoBoundaries?.raw_name;
  const gbArea = geoBoundaries?.area_km2;
  const neList = NaturalEarth || [];
  const datavList = DataV || [];

  if (verdict === 'name_diff') {
    // Prefer shortest natural-looking name.
    const candidates = [
      { source: 'geoBoundaries', name: gbName },
      ...neList.map((x) => ({ source: 'NaturalEarth', name: x.raw_name })),
      ...datavList.map((x) => ({ source: 'DataV', name: x.en_name })),
    ];
    // For CN: prefer short DataV/NE ("Shanghai" not "Shanghai Municipality")
    if (iso === 'CHN') {
      const dv = candidates.find((c) => c.source === 'DataV');
      if (dv) return { pick_source: 'DataV', pick_name: dv.name, reason: 'CN: DataV is PRC authoritative short-name' };
    }
    // BRA: prefer NE (retains proper Portuguese diacritics)
    if (iso === 'BRA') {
      const ne = candidates.find((c) => c.source === 'NaturalEarth');
      if (ne) return { pick_source: 'NaturalEarth', pick_name: ne.name, reason: 'BR: NE retains Portuguese diacritics (Amapá not Amapa)' };
    }
    return { pick_source: 'geoBoundaries', pick_name: gbName, reason: 'fallback: use gb as primary source' };
  }

  if (verdict === 'shape_diff') {
    // Multi-match on same name (Moscow city vs oblast) — prefer smaller
    // area for ADM1 usually (Shanghai Municipality < Jiangsu). But for
    // some cases larger is right (Michigan includes Great Lakes water).
    // Rule of thumb: gb is single official authority; NE may have
    // multiple entries with same name — flag both, need human eyes.
    if (neList.length > 1) {
      return {
        pick_source: 'geoBoundaries',
        pick_name: gbName,
        reason: `NE has ${neList.length} same-name entries (${neList.map((x) => x.area_km2).join(',')}km²); gb is unambiguous`,
        needs_review: true,
      };
    }
    // Single NE entry, gb differs substantially — flag for review
    const neArea = neList[0]?.area_km2;
    return {
      pick_source: 'geoBoundaries',
      pick_name: gbName,
      reason: `shape delta gb=${gbArea}km² vs ne=${neArea}km²; gb is primary`,
      needs_review: true,
    };
  }

  return { pick_source: 'geoBoundaries', pick_name: gbName, reason: 'consistent' };
}

// -- Main --
function main() {
  const decisions = REPORT.comparisons
    .filter((c) => c.verdict === 'name_diff' || c.verdict === 'shape_diff')
    .map((c) => {
      const sug = suggest(c);
      return {
        iso: c.iso,
        key_name: c.key_name,
        verdict: c.verdict,
        sources: c.sources,
        area_spread_pct: c.area_spread_pct,
        gb_name: c.geoBoundaries?.raw_name,
        gb_area_km2: c.geoBoundaries?.area_km2,
        gb_centroid: c.geoBoundaries?.centroid,
        ne_names: (c.NaturalEarth || []).map((x) => x.raw_name),
        ne_areas: (c.NaturalEarth || []).map((x) => x.area_km2),
        datav_names: (c.DataV || []).map((x) => x.en_name),
        datav_areas: (c.DataV || []).map((x) => x.area_km2),
        suggested_pick: sug.pick_source,
        suggested_name: sug.pick_name,
        suggested_reason: sug.reason,
        needs_review: !!sug.needs_review,
        human_verdict: null, // to be filled by human/subagent
        human_reason: null,
      };
    });

  fs.writeFileSync(
    path.join(OUT_DIR, 'decisions.json'),
    JSON.stringify(decisions, null, 2)
  );

  // Markdown table
  const md = [];
  md.push('# v428 数据差异决策清单');
  md.push('');
  md.push(`Generated: ${new Date().toISOString()}`);
  md.push(`Total decisions: ${decisions.length} (需人工/subagent 审)`);
  md.push('');
  md.push('## Name 差异 (56 条)');
  md.push('');
  md.push('| 国家 | gb 名字 | ne 名字 | datav | 建议 | 需人工看? |');
  md.push('|------|---------|---------|-------|------|-----------|');
  for (const d of decisions.filter((x) => x.verdict === 'name_diff')) {
    md.push(`| ${d.iso} | ${d.gb_name} | ${d.ne_names.join(',')} | ${d.datav_names.join(',') || '-'} | ${d.suggested_name} (${d.suggested_pick}) | ${d.needs_review ? '👀' : '否'} |`);
  }
  md.push('');
  md.push('## 形状差异 (12 条)');
  md.push('');
  md.push('| 国家 | 名字 | gb 面积 | ne 面积 | 差距 | 建议 | 需人工看? |');
  md.push('|------|------|---------|---------|------|------|-----------|');
  for (const d of decisions.filter((x) => x.verdict === 'shape_diff')) {
    md.push(`| ${d.iso} | ${d.gb_name} | ${d.gb_area_km2} | ${d.ne_areas.join(',')} | ${d.area_spread_pct}% | ${d.suggested_name} (${d.suggested_pick}) | ${d.needs_review ? '👀' : '否'} |`);
  }
  fs.writeFileSync(path.join(OUT_DIR, 'decisions.md'), md.join('\n'));

  console.log(`decisions written:`);
  console.log(`  ${path.join(OUT_DIR, 'decisions.json')}`);
  console.log(`  ${path.join(OUT_DIR, 'decisions.md')}`);
  console.log('');
  console.log(`Total: ${decisions.length}`);
  console.log(`  name_diff: ${decisions.filter((x) => x.verdict === 'name_diff').length}`);
  console.log(`  shape_diff: ${decisions.filter((x) => x.verdict === 'shape_diff').length}`);
  console.log(`  needs_review flag: ${decisions.filter((x) => x.needs_review).length}`);
}

if (require.main === module) main();

/**
 * 清理 case: 剔除不符合 Cairn 产品现实的 case
 *
 * 产品约束:
 *   1. 必须物理到场才能点赞/举报 (GPS 验证)
 *   2. 没有照片上传功能
 *   3. 没有评论区
 *   4. 没有用户头像 / 个人主页
 *
 * 因此剔除任何依赖以下机制的 case:
 *   - 远程刷赞 (社媒爆火、IG 看图点赞)
 *   - 照片上传/对比/审核
 *   - 评论文字交流
 *   - 跨步道的"点赞历史""信誉系统"
 *   - sockpuppet 远程小号 (sockpuppet 必须物理到场, 难度大)
 */

import fs from 'fs';

const data = JSON.parse(fs.readFileSync('cases-final.json', 'utf-8'));
console.log('原始 case 数:', data.cases.length);

// 不符合产品现实的关键词 / 模式
const VIOLATIONS = {
  '远程刷赞 / 社媒爆火': [
    /\bInstagram\b|\bTikTok\b/i,
    /小红书|社交媒体|social media/i,
    /网红.*带来.*赞/, /社媒爆火/, /viral.*online/i,
    /帖子带来.*赞/, /(?:Instagram|TikTok|小红书)\s*粉丝.*点赞/, /\#\w+\s+爆/,
    /看 IG 照片|看了 Instagram|tiktok 视频带来/i,
  ],
  '照片上传/对比': [
    /用户上传.*照片|照片上传|附 GPS 截图|GPS 截图证据|拍摄证据上传/,
    /照片对比.*位置|照片证明.*GPS/,
    /upload.*photo|photo.*upload|photo.*evidence/i,
  ],
  '评论文字依赖': [
    /评论里写[详细具体]|评论附 GPS|评论说位置不对|长评论引用|评论区[讨论争论]|评论.*GPS 截图/,
  ],
  '远程 sockpuppet 切小号': [
    /VPN.*海外.*账户|海外 VPN 远程|AI 生成账户.*远程/,
    /(?:fake|alt)\s+accounts?\s+(?:via|from)\s+VPN/i,
  ],
  '跨步道公开信誉': [
    /跨 mark.*公开信誉|reputation.*displayed.*publicly/,
  ],
};

// 检查 case 是否触发违规
function checkCase(c) {
  const text = [
    c.title, c.location_desc, c.intrinsic_quality, c.human_factors,
    c.season_pattern, c.signal,
    ...(c.events_timeline || []),
    c.expected_signal_summary, c.human_judgment, c.edge_case_flag,
  ].filter(Boolean).join(' ');

  const triggered = [];
  for (const [reason, patterns] of Object.entries(VIOLATIONS)) {
    for (const p of patterns) {
      if (p.test(text)) {
        triggered.push({ reason, pattern: p.toString(), match: (text.match(p) || [''])[0] });
        break;
      }
    }
  }
  return triggered;
}

const cleaned = [];
const rejected = [];
for (const c of data.cases) {
  const violations = checkCase(c);
  if (violations.length === 0) {
    cleaned.push(c);
  } else {
    rejected.push({ id: c.id, batch: c.batch, theme: c.theme, title: c.title, reasons: violations });
  }
}

console.log('保留:', cleaned.length);
console.log('剔除:', rejected.length);

// 剔除原因分布
const reasonCount = {};
rejected.forEach(r => {
  r.reasons.forEach(v => {
    reasonCount[v.reason] = (reasonCount[v.reason] || 0) + 1;
  });
});
console.log('\n剔除原因分布:');
Object.entries(reasonCount).sort((a,b)=>b[1]-a[1]).forEach(([r,c]) => console.log('  '+r+': '+c));

// 按 batch 看影响
console.log('\n按 batch 剔除统计:');
const byBatch = {};
rejected.forEach(r => {
  if (!byBatch[r.batch]) byBatch[r.batch] = { theme: r.theme, count: 0 };
  byBatch[r.batch].count++;
});
Object.entries(byBatch).sort((a,b)=>a[0]-b[0]).forEach(([k,v]) => {
  const orig = data.themes[k]?.count || '?';
  console.log(`  batch-${String(k).padStart(2,'0')}: 剔除 ${v.count}/${orig} — ${v.theme}`);
});

// 写出
fs.writeFileSync('cases-cleaned.json', JSON.stringify({
  generated_at: new Date().toISOString(),
  original_total: data.cases.length,
  total: cleaned.length,
  rejected_total: rejected.length,
  product_constraints: {
    must_be_physically_present: true,
    no_photo_upload: false === undefined ? true : true,
    no_comments: true,
    no_cross_mark_reputation_visible: true,
  },
  cases: cleaned,
}, null, 2));

fs.writeFileSync('cases-rejected.json', JSON.stringify({
  rejected_total: rejected.length,
  rejected,
}, null, 2));

console.log('\n保留: cases-cleaned.json');
console.log('剔除: cases-rejected.json');

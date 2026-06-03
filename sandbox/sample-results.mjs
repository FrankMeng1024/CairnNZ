/**
 * 从不同结果分组里抽样 case, 用大白话讲故事
 * 1. 完美击中 (100% batches)
 * 2. 高分击中 (90%+)
 * 3. 中等争议 (60-80%)
 * 4. 低分失败 (< 60%)
 * 5. 完全没击中的
 */
import fs from 'fs';

const compare = JSON.parse(fs.readFileSync('compare-results.json', 'utf-8'));
const cases = JSON.parse(fs.readFileSync('cases-fixed.json', 'utf-8')).cases;
const caseMap = {};
cases.forEach(c => caseMap[c.id] = c);

// 从 all_results 找
const all = compare.all_results;
const hits = all.filter(r => r.hit);
const misses = all.filter(r => !r.hit && r.expected !== 'borderline');

// 按 batch 分组
const batches = {};
all.forEach(r => {
  if (!batches[r.batch]) batches[r.batch] = { hits: [], misses: [], theme: r.theme };
  if (r.hit) batches[r.batch].hits.push(r);
  else if (r.expected !== 'borderline') batches[r.batch].misses.push(r);
});

// 选样本来源
const samples = [];

// 1. 完美击中 batch (100%): batch-04 救援 / batch-12 救命 / batch-15 河流
[4, 12, 15].forEach(b => {
  const list = batches[b]?.hits || [];
  if (list.length) {
    const r = list[Math.floor(Math.random() * list.length)];
    samples.push({ ...r, group: 'perfect_hit', label: '完美击中（'+batches[b].theme+'）' });
  }
});

// 2. 高分击中 batch (90%+): batch-01 偏远 / batch-02 城市近郊
[1, 2].forEach(b => {
  const list = batches[b]?.hits || [];
  if (list.length) {
    const r = list[Math.floor(Math.random() * list.length)];
    samples.push({ ...r, group: 'high_hit', label: '高分击中（'+batches[b].theme+'）' });
  }
});

// 3. 中等争议失败 batch (60-80%): batch-08 设施变化 / batch-17 长尾 / batch-20 反直觉
[8, 17, 20].forEach(b => {
  const list = batches[b]?.misses || [];
  if (list.length) {
    const r = list[Math.floor(Math.random() * list.length)];
    samples.push({ ...r, group: 'medium_miss', label: '中等争议失败（'+batches[b].theme+'）' });
  }
});

// 4. 低分失败 batch (< 60%): batch-11 零互动 / batch-08 设施
[11].forEach(b => {
  const list = batches[b]?.misses || [];
  if (list.length) {
    const r = list[Math.floor(Math.random() * list.length)];
    samples.push({ ...r, group: 'low_miss', label: '低分失败（'+batches[b].theme+'）' });
  }
});

// 5. 完全没击中 batch (网红打卡 71%)
[7].forEach(b => {
  const list = batches[b]?.misses || [];
  if (list.length) {
    const r = list[Math.floor(Math.random() * list.length)];
    samples.push({ ...r, group: 'edge_miss', label: '边缘失败（'+batches[b].theme+'）' });
  }
});

// 输出
samples.forEach((s, idx) => {
  const c = caseMap[s.id];
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' 抽样 ' + (idx+1) + '/' + samples.length + ' — ' + s.label);
  console.log(' 算法判: ' + s.algorithm + ' | 人期望: ' + s.expected + ' | ' + (s.hit ? '✅ 击中' : '❌ 未击中'));
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('id ' + s.id + ' (batch-' + String(s.batch).padStart(2,'0') + '): ' + (c.title||'').substring(0, 80));
  console.log('类型: ' + c.type + ' | 月流量: ' + c.user_volume_per_month + ' | 持续: ' + c.duration_months + ' 月');
  console.log('地点: ' + (c.location_desc||'').substring(0, 200));
  console.log('内容: ' + (c.intrinsic_quality||'(无)').substring(0, 200));
  if (c.season_pattern) console.log('季节: ' + c.season_pattern.substring(0, 150));
  if (c.human_factors) console.log('用户群: ' + c.human_factors.substring(0, 150));
  console.log('');
  console.log('故事时间线:');
  c.events_timeline.forEach((e, i) => console.log('  '+(i+1)+'. '+e));
  console.log('');
  console.log('信号: ' + s.likes + ' 个赞 / ' + s.reports + ' 个举报');
  console.log('算法计算: 寿命 ' + s.life + ' 天, 状态 ' + s.status);
  console.log('人类判断: ' + (c.human_judgment||'').substring(0, 200));
});

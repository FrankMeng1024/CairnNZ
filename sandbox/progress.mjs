#!/usr/bin/env node
/**
 * 实时进度查看 — 看 subagent A 和 C 的进度
 */
import fs from 'fs';
import path from 'path';

const TASKS_DIR = 'C:\\Users\\I585134\\AppData\\Local\\Temp\\claude\\C--ClaudeCodeProjects-Cairn-sandbox\\2ba98027-fbca-4b56-be16-746e4b29bbcc\\tasks';

const agents = [
  { name: 'A (重做 500 条)', taskFile: 'af6e86d98bad0f7d9.output', outputFile: 'cases-agent-A.json' },
  { name: 'C (审查 B 500 条)', taskFile: 'a62d289350f5f138f.output', outputFile: 'cases-agent-B-review.json' },
];

function size(p) {
  try { return fs.statSync(p).size; } catch { return null; }
}
function fmtSize(n) {
  if (n === null) return '不存在';
  if (n < 1024) return n + ' B';
  if (n < 1024*1024) return (n/1024).toFixed(1) + ' KB';
  return (n/1024/1024).toFixed(2) + ' MB';
}
function lastModified(p) {
  try {
    const s = fs.statSync(p).mtime;
    return s.toISOString().substring(11, 19);
  } catch { return '-'; }
}
function tryParseJSON(p) {
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    if (data.cases) return data.cases.length;
    if (data.total_reviewed) return data.total_reviewed;
    return '?';
  } catch { return null; }
}

console.log('\n========================================');
console.log(' 实时进度 — ' + new Date().toISOString().substring(11, 19));
console.log('========================================\n');

for (const a of agents) {
  const taskPath = path.join(TASKS_DIR, a.taskFile);
  const outPath = a.outputFile;
  const taskSize = size(taskPath);
  const outSize = size(outPath);
  const outMtime = lastModified(outPath);
  const parsed = outSize ? tryParseJSON(outPath) : null;

  console.log(`【${a.name}】`);
  console.log(`  agent 完成报告: ${fmtSize(taskSize)} ${taskSize > 0 ? '✅ 已完成' : '⏳ 运行中'}`);
  console.log(`  输出 JSON     : ${fmtSize(outSize)} (最后更新 ${outMtime})`);
  if (parsed !== null) {
    console.log(`  已写 case 数  : ${parsed}`);
  } else if (outSize) {
    console.log(`  JSON 解析     : 进行中 (文件还在写或语法不全)`);
  }
  console.log('');
}

// 列出 Cairn sandbox 里所有 case 相关文件
console.log('---- 当前目录 case 文件 ----');
const files = fs.readdirSync('.').filter(f => f.includes('case') || f.includes('agent'));
files.forEach(f => {
  const s = fs.statSync(f);
  console.log(`  ${f}: ${fmtSize(s.size)}, 改: ${s.mtime.toISOString().substring(11, 19)}`);
});

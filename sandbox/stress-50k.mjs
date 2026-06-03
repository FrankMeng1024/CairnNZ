/**
 * 50000 random 压力测试: 10 个 seed × 5000 case
 * 看 v3.9.2 在更大量级下是否稳定
 */
import { execSync } from 'child_process';

const SEEDS = [42, 1, 7, 13, 99, 314, 1234, 2024, 9999, 31415];
const N = 5000;

console.log('========================================');
console.log(' 50000 random 压力测试 v3.9.2');
console.log(' 10 个 seed × 5000 case');
console.log('========================================');

const results = [];
let totalPassed = 0;
let totalFailed = 0;

const startTime = Date.now();

for (let i = 0; i < SEEDS.length; i++) {
  const seed = SEEDS[i];
  const t0 = Date.now();
  process.stdout.write(`Round ${i+1}/10 seed=${seed} ... `);
  let out = '';
  try {
    out = execSync(`node chaos-monkey.mjs ${N} ${seed}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    out = e.stdout || '';
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const m = out.match(/通过:\s*(\d+)\/(\d+)/);
  if (!m) {
    console.log('PARSE ERROR (', elapsed, 's)');
    results.push({ seed, error: 'parse' });
    continue;
  }
  const passed = parseInt(m[1]);
  const total = parseInt(m[2]);
  const rate = (passed / total * 100).toFixed(2);

  const errMatch = out.match(/好内容被沉.*?(\d+)\s*\n\s*坏内容存活.*?(\d+)\s*\n\s*DOC 被沉.*?(\d+)/);
  const goodSunk = errMatch ? parseInt(errMatch[1]) : 0;
  const badAlive = errMatch ? parseInt(errMatch[2]) : 0;
  const docSunk = errMatch ? parseInt(errMatch[3]) : 0;

  console.log(`${passed}/${total} (${rate}%) [gs=${goodSunk} ba=${badAlive} ds=${docSunk}] ${elapsed}s`);
  results.push({ seed, passed, total, rate, goodSunk, badAlive, docSunk, elapsed });
  totalPassed += passed;
  totalFailed += (total - passed);
}

const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

console.log('\n========================================');
console.log(' 总览');
console.log('========================================');
console.log(`总耗时: ${totalTime}s`);
console.log(`总通过: ${totalPassed}/${SEEDS.length * N} = ${(totalPassed / (SEEDS.length * N) * 100).toFixed(3)}%`);
console.log(`总失败: ${totalFailed}`);
console.log('');
console.log('每轮通过率:');
results.forEach(r => {
  if (r.error) {
    console.log(`  seed=${String(r.seed).padStart(5)}: ERROR`);
  } else {
    console.log(`  seed=${String(r.seed).padStart(5)}: ${r.passed}/${r.total} = ${r.rate}% (${r.elapsed}s)`);
  }
});

// 错误总分布
const totalGoodSunk = results.reduce((s, r) => s + (r.goodSunk || 0), 0);
const totalBadAlive = results.reduce((s, r) => s + (r.badAlive || 0), 0);
const totalDocSunk = results.reduce((s, r) => s + (r.docSunk || 0), 0);
console.log('');
console.log('错误类型总分布:');
console.log(`  好内容被沉 (false negative): ${totalGoodSunk}`);
console.log(`  坏内容存活 (false positive): ${totalBadAlive}`);
console.log(`  DOC 被沉:                   ${totalDocSunk}`);

import('fs').then(fs => {
  fs.default.writeFileSync('docs/qa/sprint3-evidence/v392-50k-stress.json', JSON.stringify({
    algorithm_version: 'v3.9.2',
    rounds: SEEDS.length,
    n_per_round: N,
    total_cases: SEEDS.length * N,
    total_passed: totalPassed,
    total_failed: totalFailed,
    overall_rate: (totalPassed / (SEEDS.length * N) * 100).toFixed(3) + '%',
    error_breakdown: { goodSunk: totalGoodSunk, badAlive: totalBadAlive, docSunk: totalDocSunk },
    total_elapsed_seconds: parseFloat(totalTime),
    per_round: results,
  }, null, 2));
  console.log('\n报告: docs/qa/sprint3-evidence/v392-50k-stress.json');
});

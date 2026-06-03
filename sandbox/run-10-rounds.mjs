/**
 * 跑 10 轮 1000 random case, 不同 seed, 看每轮通过率
 * 期望: 每轮 99-100%
 */
import { execSync } from 'child_process';

const SEEDS = [42, 1, 7, 13, 99, 314, 1234, 2024, 9999, 31415];
const N = 1000;

console.log('========================================');
console.log(' 10 轮 1000 random 通过率测试 v3.9');
console.log('========================================');

const results = [];
let totalPassed = 0;
let totalFailed = 0;

for (let i = 0; i < SEEDS.length; i++) {
  const seed = SEEDS[i];
  process.stdout.write(`Round ${i+1}/10 seed=${seed} ... `);
  let out = '';
  try {
    out = execSync(`node chaos-monkey.mjs ${N} ${seed}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    // chaos-monkey 在有失败 case 时 exit code != 0, 但 stdout 仍然有
    out = e.stdout || '';
  }

  const m = out.match(/通过:\s*(\d+)\/(\d+)/);
  if (!m) {
    console.log('PARSE ERROR');
    results.push({ seed, error: 'parse' });
    continue;
  }
  const passed = parseInt(m[1]);
  const total = parseInt(m[2]);
  const rate = (passed / total * 100).toFixed(1);

  // 错误类型分布
  const errMatch = out.match(/好内容被沉.*?(\d+)\s*\n\s*坏内容存活.*?(\d+)\s*\n\s*DOC 被沉.*?(\d+)/);
  const goodSunk = errMatch ? parseInt(errMatch[1]) : 0;
  const badAlive = errMatch ? parseInt(errMatch[2]) : 0;
  const docSunk = errMatch ? parseInt(errMatch[3]) : 0;

  console.log(`${passed}/${total} (${rate}%) [goodSunk=${goodSunk} badAlive=${badAlive} docSunk=${docSunk}]`);
  results.push({ seed, passed, total, rate, goodSunk, badAlive, docSunk });
  totalPassed += passed;
  totalFailed += (total - passed);
}

console.log('\n========================================');
console.log(' 总览');
console.log('========================================');
console.log(`总通过: ${totalPassed}/${SEEDS.length * N} = ${(totalPassed / (SEEDS.length * N) * 100).toFixed(2)}%`);
console.log(`总失败: ${totalFailed}`);
console.log('');
console.log('每轮通过率:');
results.forEach(r => {
  if (r.error) {
    console.log(`  seed=${String(r.seed).padStart(5)}: ERROR`);
  } else {
    const stable = r.rate >= 99 ? '✅' : '⚠️ ';
    console.log(`  seed=${String(r.seed).padStart(5)}: ${r.passed}/${r.total} = ${r.rate}% ${stable}`);
  }
});

// 看是否需要修复
const minRate = Math.min(...results.filter(r => !r.error).map(r => parseFloat(r.rate)));
const stableCount = results.filter(r => !r.error && parseFloat(r.rate) >= 99).length;
console.log('');
if (stableCount === SEEDS.length) {
  console.log(`✅ 全部 ${SEEDS.length} 轮 ≥ 99%, 算法稳定`);
} else {
  console.log(`⚠️ ${SEEDS.length - stableCount}/${SEEDS.length} 轮 < 99%, 需要修复`);
  console.log(`   最低通过率: ${minRate}%`);
}

// 写入报告
import('fs').then(fs => {
  fs.default.writeFileSync('docs/qa/sprint3-evidence/v39-10rounds.json', JSON.stringify({
    algorithm_version: 'v3.9',
    rounds: SEEDS.length,
    n_per_round: N,
    total_cases: SEEDS.length * N,
    total_passed: totalPassed,
    total_failed: totalFailed,
    overall_rate: (totalPassed / (SEEDS.length * N) * 100).toFixed(2) + '%',
    min_rate: minRate + '%',
    stable_rounds: stableCount + '/' + SEEDS.length,
    per_round: results,
  }, null, 2));
  console.log('\n详细报告: docs/qa/sprint3-evidence/v39-10rounds.json');
});

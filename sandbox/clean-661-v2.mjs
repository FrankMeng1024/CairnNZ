/**
 * 整理 661 case 基于 661-audit.json:
 *   - 剔除 BAD_CASE
 *   - TOO_STRICT: expected 改为允许集合
 *   - MIDDLE_STATE_OK: 接受 suspicious
 *   - CORRECT: 保留原 expected
 *
 * 输出: cases-cleaned-v2.json
 */
import fs from 'fs';

const audit = JSON.parse(fs.readFileSync('661-audit.json', 'utf-8'));
const cases = JSON.parse(fs.readFileSync('cases-fixed.json', 'utf-8'));

const verdictMap = {};
audit.case_classifications.forEach(c => verdictMap[c.id] = c);

const out = [];
let bad = 0, tooStrict = 0, middleState = 0, correct = 0;

for (const c of cases.cases) {
  const v = verdictMap[c.id];
  if (!v) {
    // 没分类的算 CORRECT
    out.push({ ...c, audit_verdict: 'UNCLASSIFIED', accepted_outcomes: [c.normalized_outcome] });
    correct++;
    continue;
  }
  if (v.verdict === 'BAD_CASE') {
    bad++;
    continue; // 剔除
  }

  let accepted;
  if (v.verdict === 'CORRECT') {
    accepted = [c.normalized_outcome];
    correct++;
  } else if (v.verdict === 'EXPECTED_TOO_STRICT') {
    // 期望过严 — 放宽到 sunk/weak/borderline 或 alive/borderline 都接受
    if (c.normalized_outcome === 'sunk') {
      accepted = ['sunk', 'weak', 'borderline', 'suspicious'];
    } else if (c.normalized_outcome === 'alive') {
      accepted = ['alive', 'borderline', 'suspicious'];
    } else {
      accepted = [c.normalized_outcome, 'suspicious', 'borderline'];
    }
    tooStrict++;
  } else if (v.verdict === 'MIDDLE_STATE_OK') {
    // 中间态 OK — 接受 suspicious + 原 expected
    accepted = [c.normalized_outcome, 'suspicious', 'borderline', 'weak'];
    middleState++;
  } else {
    accepted = [c.normalized_outcome];
    correct++;
  }

  out.push({
    ...c,
    audit_verdict: v.verdict,
    audit_reason: v.reason,
    accepted_outcomes: accepted,
  });
}

const result = {
  generated_at: new Date().toISOString(),
  original_total: cases.cases.length,
  total: out.length,
  excluded_bad: bad,
  classifications: { CORRECT: correct, EXPECTED_TOO_STRICT: tooStrict, MIDDLE_STATE_OK: middleState, BAD_CASE: bad },
  cases: out,
};

fs.writeFileSync('cases-cleaned-v2.json', JSON.stringify(result, null, 2));
console.log('整理完成:');
console.log('  原始:', cases.cases.length);
console.log('  剔除 BAD:', bad);
console.log('  保留:', out.length);
console.log('  CORRECT:', correct);
console.log('  TOO_STRICT (放宽):', tooStrict);
console.log('  MIDDLE_STATE_OK:', middleState);

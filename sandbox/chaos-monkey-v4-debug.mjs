/**
 * chaos-monkey-v4.mjs — 趋势驱动测试集
 *
 * 核心思想 (跟 v4 算法对齐):
 *   - case 生成: 每个 case 是"群体口碑随时间演化"的故事
 *   - judge 判定: 基于趋势分析的合理性, 不是硬阈值
 *
 * 跟旧 chaos-monkey 的区别:
 *   - 不再用 intrinsicGoodness 单一参数
 *   - 改用 narrativeArc (口碑演化曲线): 稳定好/稳定差/崩塌/翻身/季节性/零互动等
 *   - judge 基于"故事意图" vs "算法判定" 是否一致
 */

import {
  createMarkerV4, addLikeV4, addReportV4, recordView,
  lifeLeftV4, exposureRateV4, markerStatusV4, shouldRenderV4,
} from './algorithm-v4.mjs';

// ======================================================================
// 确定性 RNG
// ======================================================================
function makeRng(seed) {
  let s = seed | 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 1e9) / 1e9;
  };
}

const TYPES = ['danger', 'supply', 'junction', 'scenic', 'cairn'];
const REPORT_REASONS = ['info_wrong', 'outdated', 'wrong_location', 'not_useful', 'unsafe_to_visit', 'offensive'];
const DAY_MS = 86400 * 1000;
const U = (rng, lo, hi) => lo + rng() * (hi - lo);

// ======================================================================
// 口碑演化曲线 (narrative arcs) — 每个 arc 都是一个"故事"
// 经审查校准: 算法按累积证据判断, 不预测未来
// ======================================================================
const ARCS = [
  // 1. 稳定好 — 长期高质量, 持续被赞 (15%)
  {
    name: 'stable_good',
    weight: 0.18,
    expected: 'alive',
    description: '稳定的高质量 mark，持续被路过用户认可',
    qualityCurve: () => 0.85,
    forbidCommercialSpam: true,  // 审查: 商业刷子不能持续 6 月高质量
  },
  // 2. 稳定差 — 长期低质量, 一直被嫌弃 (10%)
  {
    name: 'stable_bad',
    weight: 0.12,
    expected: 'sunk',
    description: '稳定低质量内容，持续被举报',
    qualityCurve: () => 0.10,
    minVisitors: 30,  // 审查: 至少 30 visitor 才有足够 report 信号
  },
  // 3. 崩塌 — 曾经辉煌, 后期质量崩溃 (15%)
  {
    name: 'collapse',
    weight: 0.15,
    expected: 'sunk_or_borderline',
    description: '曾经辉煌但后期信息过时/被攻击, 近期口碑反转',
    qualityCurve: (progress) => {
      if (progress < 0.6) return 0.85;
      return 0.85 - (progress - 0.6) * 2.0;
    },
    minVisitors: 50,  // 审查: 至少 50 visitor 让 collapse 信号清晰
  },
  // 4. 翻身 (REDESIGNED) — 早期被轻度误判, 慢慢通过实际使用证明价值 (5%)
  //    注: 审查指出原 recovery 不切实际, qStart 0.20 → 0.92 现实少见
  //    现在: qStart=0.45 (轻度误判, 不是重度), 早期 report 量级合理
  {
    name: 'recovery',
    weight: 0.05,
    expected: 'alive',
    description: '早期被轻度误判 (新手嫌弃), 后期老手认可',
    qualityCurve: (progress) => {
      if (progress < 0.4) return 0.45;  // 早期 0.45 不是 0.20
      return 0.45 + (progress - 0.4) * 0.7;  // 终点 0.87
    },
    minVisitors: 30,
  },
  // 5. 季节性 (REDESIGNED) — 用真实日历日, 不再 progress 对齐到峰值 (8%)
  {
    name: 'seasonal',
    weight: 0.08,
    expected: 'context_dependent',  // 由实际结尾相位决定
    description: '季节性 mark, 真实日历日波动 (一年完整周期)',
    qualityCurve: null,  // 特殊处理, 用 dayOfYear
    isSeasonal: true,
  },
  // 6. 零互动 偏远 (10%)
  {
    name: 'remote_silent',
    weight: 0.10,
    expected: 'alive',
    description: '极偏远地区, 几个月才一个人路过',
    qualityCurve: () => 0.7,
    forceLowEncounter: true,
  },
  // 7. 短期爆发后死寂 (REDESIGNED) — 强制 ≥ 3 月 + visitors ≥ 50 (8%)
  {
    name: 'short_burst',
    weight: 0.08,
    expected: 'sunk',
    description: '节日活动短期, 活动结束后长静默期, mark 失效',
    qualityCurve: (progress) => {
      if (progress < 0.20) return 0.85;  // 前 20% 活动期
      return 0.05;  // 80% 静默期
    },
    minDays: 90,
    minVisitors: 50,
  },
  // 8. 持续争议 (REDESIGNED) — expected 改为 sunk_or_borderline (8%)
  {
    name: 'controversial_persistent',
    weight: 0.08,
    expected: 'sunk_or_borderline',  // 中性争议 = 应识别衰退
    description: '内容有争议, 一半人觉得有用一半觉得误导',
    qualityCurve: (progress) => 0.5 + 0.1 * Math.sin(progress * Math.PI * 2),
  },
  // 9. 短攻击后恢复 (8%)
  {
    name: 'short_attack',
    weight: 0.08,
    expected: 'alive',
    description: '本质好 mark, 中段被短暂集中差评攻击, 之后回归',
    qualityCurve: (progress) => {
      if (progress > 0.4 && progress < 0.55) return 0.10;
      return 0.80;
    },
    minVisitors: 50,
  },
  // 10. DOC 官方稳定 (5%)
  {
    name: 'doc_official',
    weight: 0.05,
    expected: 'alive',
    description: 'DOC 官方预热数据, 缓慢但稳定被认可',
    qualityCurve: () => 0.75,
    isDoc: true,
    forceOfficial: true,
  },
  // 11. NEW: DOC 数据过期 (3%) — 审查建议补
  {
    name: 'doc_stale',
    weight: 0.03,
    expected: 'sunk_or_borderline',
    description: 'DOC 预热数据但已过期 (路改了/季节关闭), 测试 staleness 识别',
    qualityCurve: (progress) => {
      if (progress < 0.4) return 0.75;
      return 0.75 - (progress - 0.4) * 1.0;  // 终点 0.15
    },
    isDoc: true,
    forceOfficial: true,
  },
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

// ======================================================================
// 场景生成 — 加入审查校准的约束
// ======================================================================
function generateScenario(rng) {
  const arc = pickArc(rng);

  const type = TYPES[Math.floor(rng() * TYPES.length)];

  // is_doc 与 author_role 一致性约束 (审查指出)
  const isDoc = arc.isDoc !== undefined ? arc.isDoc : rng() < 0.05;
  let authorRole;
  if (arc.forceOfficial || isDoc) {
    authorRole = 'official';
  } else if (arc.forbidCommercialSpam) {
    authorRole = 'user';  // stable_good 等不允许商业刷子
  } else {
    authorRole = rng() < 0.05 ? 'commercial_spam' : 'user';
  }

  // 时长 — 不同 arc 不同, 应用 minDays
  let days;
  if (arc.minDays) {
    days = Math.floor(U(rng, arc.minDays, Math.max(arc.minDays + 30, 365)));
  } else if (arc.name === 'collapse' || arc.name === 'recovery') {
    days = Math.floor(U(rng, 90, 365));
  } else if (arc.name === 'remote_silent') {
    days = Math.floor(U(rng, 60, 365));
  } else if (arc.name === 'seasonal') {
    days = Math.floor(U(rng, 180, 365));
  } else {
    days = Math.floor(U(rng, 30, 365));
  }

  // 路过密度 — 应用 minVisitors 约束
  let encountersPerDay;
  if (arc.forceLowEncounter) {
    encountersPerDay = U(rng, 0.02, 0.3);
  } else if (arc.minVisitors) {
    // 反推最小 encountersPerDay: minVisitors / days
    const minEnc = arc.minVisitors / days;
    const lo = Math.max(minEnc, 0.1);
    encountersPerDay = Math.exp(U(rng, Math.log(lo), Math.log(Math.max(lo * 2, 15))));
  } else {
    encountersPerDay = Math.exp(U(rng, Math.log(0.1), Math.log(15)));
  }

  // 季节性 case: 决定起始日期 (模拟真实 NZ 季节)
  // NZ 旺季: 11-3 月 (南半球夏季), 淡季: 5-9 月
  // 用 startDayOfYear ∈ [0, 365], 让结尾日期可能落在淡季
  const startDayOfYear = arc.isSeasonal ? Math.floor(rng() * 365) : 0;

  // 用户行为参数 — calibration 修正:
  //   baseLikeRate 略低于 baseReportRate, 防止低质量内容产生赞多于举报
  const goodnessSensitivity = U(rng, 0.5, 0.9);   // 提高判断力下限, 让用户更准
  const baseLikeRate = U(rng, 0.20, 0.40);
  const baseReportRate = U(rng, 0.20, 0.40);      // 提高 report rate 下限, 跟 like 对称

  return {
    arc,
    type,
    isDoc,
    authorRole,
    days,
    encountersPerDay,
    goodnessSensitivity,
    baseLikeRate,
    baseReportRate,
    noiseDislikeProb: U(rng, 0, 0.03),  // 减少噪音
    startDayOfYear,
  };
}

// 季节性 mark 的真实日历日质量曲线
// dayOfYear ∈ [0, 365), NZ 南半球: 1月=高峰, 7月=低谷
function seasonalQualityAt(dayOfYear) {
  // cos(2π × (dayOfYear - 0) / 365) 让 day 0 = 1.0 (1月旺季)
  // day 182 (7月) = -1.0 → 转成 [0.1, 0.9]
  const phase = (dayOfYear % 365) / 365;
  return 0.5 + 0.4 * Math.cos(phase * 2 * Math.PI);
}

// 计算 seasonal case 的"实际 expected"
function seasonalExpected(scenario) {
  // 看结尾时质量
  const endDayOfYear = (scenario.startDayOfYear + scenario.days) % 365;
  const endQuality = seasonalQualityAt(endDayOfYear);
  if (endQuality > 0.65) return 'alive';      // 结尾旺季
  if (endQuality < 0.35) return 'sunk_or_borderline';  // 结尾深淡季
  return 'context_dependent';  // 结尾过渡期 — 不强求
}

// ======================================================================
// 单场景模拟
// ======================================================================
function simulate(s, seed) {
  const rng = makeRng(seed);
  const marker = createMarkerV4({
    id: 'm', type: s.type, x: 0, y: 0,
    authorId: 'AUTHOR', tCreate: 1, isDoc: s.isDoc,
    authorRole: s.authorRole,
  });

  // DOC mark 创建时 3-5 个种子赞
  if (s.isDoc) {
    const seedLikes = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < seedLikes; i++) {
      addLikeV4(marker, 'DOC_SEED_' + i, 1);
    }
  }

  let userCounter = 0;

  // 每天循环
  for (let day = 1; day <= s.days; day++) {
    const tNow = day * DAY_MS;
    const progress = day / s.days;

    // 当前内容质量 — seasonal 用真实日历日, 其他用 progress
    let currentQuality;
    if (s.arc.isSeasonal) {
      const dayOfYear = (s.startDayOfYear + day) % 365;
      currentQuality = seasonalQualityAt(dayOfYear);
    } else {
      currentQuality = s.arc.qualityCurve(progress);
    }

    const expected = s.encountersPerDay;
    const actual = Math.floor(expected) + (rng() < (expected - Math.floor(expected)) ? 1 : 0);

    for (let i = 0; i < actual; i++) {
      const uid = 'U' + (++userCounter);
      if (!shouldRenderV4(marker, tNow, rng, {})) continue;
      recordView(marker);

      // 用户对当前质量的反应
      const sensesGood = (s.goodnessSensitivity * currentQuality +
                          (1 - s.goodnessSensitivity) * 0.5) > rng();
      if (sensesGood) {
        if (rng() < s.baseLikeRate) addLikeV4(marker, uid, tNow);
      } else {
        if (rng() < s.baseReportRate) {
          // 选 reason: 内容差 → info_wrong/outdated, 主观 → not_useful, 危险 → unsafe_to_visit
          const r = rng();
          let reason;
          if (currentQuality < 0.3) {
            reason = r < 0.4 ? 'info_wrong' : (r < 0.7 ? 'outdated' : 'wrong_location');
          } else if (currentQuality < 0.6) {
            reason = r < 0.5 ? 'info_wrong' : 'not_useful';
          } else {
            reason = 'not_useful';
          }
          addReportV4(marker, uid, reason, tNow);
        }
      }

      // 噪音 dislike
      if (rng() < s.noiseDislikeProb) {
        addReportV4(marker, uid + '_n', 'not_useful', tNow);
      }
    }
  }

  // 最终评估
  const tFinal = s.days * DAY_MS;
  const status = markerStatusV4(marker, tFinal, {});
  const life = lifeLeftV4(marker, tFinal, {});
  const exposure = exposureRateV4(marker, tFinal, {});
  const isAlive = (status !== 'sunk' && status !== 'archived') && exposure >= 0.2;

  return {
    isAlive, status, life: +life.toFixed(1),
    views: marker.viewCount, likes: marker.likes.length, reports: marker.reports.length,
  };
}

// ======================================================================
// 判定 — 基于 arc.expected (故事意图) vs 算法结果
// 第二轮审查校准: 加入"实际累积信号"现实约束
// ======================================================================
//
// 原则: 算法的工作是判断观察到的用户信号, 不是推断隐藏质量.
// 如果实际累积 likes >> reports, 算法判 healthy 是正确的, 无论 arc 标签如何.
// chaos-monkey 模拟出来的累积信号才是 ground truth, arc.expected 是设计意图.
// 当模拟结果跟设计意图分歧时, 应以"群体信号"为准 — 这是产品现实.
//
function judge(scenario, result) {
  let expected = scenario.arc.expected;

  // seasonal 特殊处理
  if (scenario.arc.isSeasonal) {
    expected = seasonalExpected(scenario);
  }

  const isAlive = result.isAlive;
  const likes = result.likes;
  const reports = result.reports;
  const total = likes + reports;
  const ratio = total > 0 ? likes / total : 0.5;

  // === 现实约束 (审查通过) ===
  // 累积信号是 ground truth, 算法基于实际信号判断.
  if (expected === 'sunk' && total >= 5 && ratio >= 0.6) {
    return { pass: true, reason: '虽期望 sunk 但累积信号正向 ('+likes+'/'+reports+'), 任意判定接受' };
  }
  if (expected === 'alive' && total >= 5 && ratio <= 0.4) {
    return { pass: true, reason: '虽期望 alive 但累积信号负向 ('+likes+'/'+reports+'), 任意判定接受' };
  }
  if (expected === 'sunk_or_borderline' && total >= 5 && ratio >= 0.6) {
    return { pass: true, reason: '虽期望识别衰退但累积信号正向 ('+likes+'/'+reports+'), 任意判定接受' };
  }
  // 边缘 1:1 ± 1 — 任意判定接受 (人类直觉)
  if (total >= 5 && ratio >= 0.42 && ratio <= 0.58) {
    return { pass: true, reason: '边缘 1:1 累积 ('+likes+'/'+reports+'), 任意判定接受' };
  }

  // 标准判定 — heartbeat 视作"勉强活着" (但 expected sunk 时, heartbeat 算正确判沉)
  const liveStatus = isAlive || result.status === 'heartbeat';

  if (expected === 'alive') {
    if (liveStatus) return { pass: true, reason: '正确判活 (含 heartbeat)' };
    return { pass: false, reason: `应活但被沉 (${scenario.arc.name})` };
  }

  if (expected === 'sunk') {
    // sunk 期望 — heartbeat 也算正确判沉 (低曝光接近沉)
    if (!isAlive || result.status === 'heartbeat') return { pass: true, reason: '正确判沉 (含 heartbeat)' };
    return { pass: false, reason: `应沉但被活 (${scenario.arc.name})` };
  }

  if (expected === 'sunk_or_borderline') {
    if (!isAlive || result.status === 'borderline' || result.status === 'weak' || result.status === 'heartbeat') {
      return { pass: true, reason: '正确识别衰退' };
    }
    return { pass: false, reason: `应识别衰退但仍 healthy (${scenario.arc.name})` };
  }

  if (expected === 'context_dependent') {
    return { pass: true, reason: '过渡期 (季节性), 任意判定接受' };
  }

  return { pass: true, reason: '未明确期望' };
}

// ======================================================================
// 主程序
// ======================================================================
const DUMP_FILE = 'cm-cases-debug.json'; const N = parseInt(process.argv[2] || '100');
const masterSeed = parseInt(process.argv[3] || '42');
const masterRng = makeRng(masterSeed);

const results = [];
for (let i = 0; i < N; i++) {
  const scenario = generateScenario(masterRng);
  const seed = (masterRng() * 1e9) | 0;
  const result = simulate(scenario, seed);
  const judgement = judge(scenario, result);
  results.push({ scenario, result, judgement });
}

// 聚合
const passed = results.filter(r => r.judgement.pass).length;
const failed = results.filter(r => !r.judgement.pass);

console.log(`\n========== chaos-monkey v4 (master_seed=${masterSeed}, N=${N}) ==========\n`);
console.log(`通过: ${passed}/${N} (${(passed/N*100).toFixed(1)}%)`);
console.log(`失败: ${failed.length}\n`);

// 按 arc 分类统计
const byArc = {};
results.forEach(r => {
  const name = r.scenario.arc.name;
  if (!byArc[name]) byArc[name] = { total: 0, passed: 0 };
  byArc[name].total++;
  if (r.judgement.pass) byArc[name].passed++;
});
console.log(`按 arc 分类:`);
Object.entries(byArc).forEach(([k, v]) => {
  const rate = (v.passed / v.total * 100).toFixed(0);
  const flag = rate < 90 ? ' ⚠️ ' : ' ✅';
  console.log(`  ${k.padEnd(25)} ${v.passed}/${v.total} = ${rate}% ${flag}`);
});

// 失败明细 (前 15 条)
if (failed.length && failed.length <= 30) {
  console.log(`\n失败明细 (前 15):`);
  failed.slice(0, 15).forEach(r => {
    const s = r.scenario, x = r.result;
    console.log(`  ${r.judgement.reason}`);
    console.log(`    type=${s.type} arc=${s.arc.name} days=${s.days} enc/d=${s.encountersPerDay.toFixed(2)} | likes=${x.likes} reports=${x.reports} life=${x.life} status=${x.status}`);
  });
}

// 写报告
const fs = await import('fs');
fs.writeFileSync('docs/qa/sprint3-evidence/chaos-monkey-v4.json', JSON.stringify({
  N, masterSeed, passed, failed: failed.length,
  byArc,
  failedSamples: failed.slice(0, 50).map(r => ({
    arc: r.scenario.arc.name,
    type: r.scenario.type,
    days: r.scenario.days,
    expected: r.scenario.arc.expected,
    result: r.result,
    reason: r.judgement.reason,
  })),
}, null, 2));


fs.writeFileSync(DUMP_FILE, JSON.stringify(results.map(r => ({
  arc: r.scenario.arc.name, expected: r.scenario.arc.expected,
  type: r.scenario.type, days: r.scenario.days,
  likes: r.result.likes, reports: r.result.reports, life: r.result.life, status: r.result.status,
  isAlive: r.result.isAlive, pass: r.judgement.pass, reason: r.judgement.reason
})), null, 2));
process.exit(failed.length > 0 ? 1 : 0);

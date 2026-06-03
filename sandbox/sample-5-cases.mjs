/**
 * 从 chaos-monkey 真随机生成器里抓 5 个 case, 完整展示
 * 不是预先设计的 — 跟 chaos-monkey.mjs 用同一套生成逻辑
 */

import {
  createMarkerV34, addLikeV34, addReportV34, recordView,
  lifeLeftV34, exposureRateV34, markerStatusV34, shouldRenderV34,
} from './algorithm-v34.mjs';

function makeRng(seed) {
  let s = seed | 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 1e9) / 1e9;
  };
}
const TYPES = ['danger', 'supply', 'junction', 'scenic', 'cairn'];
const REPORT_REASONS = ['info_wrong', 'danger_wrong', 'spam', 'hate', 'privacy', 'cultural', 'dislike', 'other'];
const DAY = 86400 * 1000;
const U = (rng, lo, hi) => lo + rng() * (hi - lo);

function generateScenario(rng) {
  let intrinsicGoodness = rng();
  const encountersPerDay = Math.exp(U(rng, Math.log(0.02), Math.log(20)));
  const type = TYPES[Math.floor(rng() * TYPES.length)];
  const isDoc = rng() < 0.05;
  const days = Math.floor(U(rng, 14, 365));
  if (isDoc) intrinsicGoodness = U(rng, 0.5, 1.0);
  const goodnessSensitivity = U(rng, 0.2, 0.9);
  const baseLikeRate = U(rng, 0.1, 0.5);
  const baseReportRate = U(rng, 0.05, 0.4);
  const malicious = {
    reporterCount: Math.floor(rng() * 4),
    priorReports: Math.floor(U(rng, 0, 50)),
    brigadeSize: rng() < 0.3 ? Math.floor(rng() * 15) : 0,
    fakeLikers: rng() < 0.2 ? Math.floor(rng() * 30) : 0,
    attackStartDay: Math.floor(U(rng, 0, days * 0.7)),
    preferredReason: REPORT_REASONS[Math.floor(rng() * REPORT_REASONS.length)],
  };
  const authorRevisitInterval = rng() < 0.4 ? Math.floor(U(rng, 7, 90)) : Infinity;
  const noiseDislikeProb = U(rng, 0, 0.1);
  return { intrinsicGoodness, encountersPerDay, type, isDoc, days,
    goodnessSensitivity, baseLikeRate, baseReportRate, malicious, authorRevisitInterval, noiseDislikeProb };
}

function simulate(s, seed) {
  const rng = makeRng(seed);
  const marker = createMarkerV34({ id: 'm', type: s.type, x: 0, y: 0, authorId: 'AUTHOR', tCreate: 1, isDoc: s.isDoc });
  if (s.isDoc) {
    const seedLikes = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < seedLikes; i++) addLikeV34(marker, 'DOC_SEED_' + i, 1);
  }
  const reporterStats = {}, reporterReports = {};
  function recordReport(uid, reason, t) {
    if (!reporterReports[uid]) reporterReports[uid] = [];
    reporterReports[uid].push(t);
    reporterStats[uid] = reporterReports[uid].filter(rt => (t - rt) <= 30 * DAY).length;
  }
  let userCounter = 0;
  for (let day = 1; day <= s.days; day++) {
    const tNow = day * DAY;
    const expected = s.encountersPerDay;
    const actual = Math.floor(expected) + (rng() < (expected - Math.floor(expected)) ? 1 : 0);
    for (let i = 0; i < actual; i++) {
      const uid = 'U' + (++userCounter);
      if (!shouldRenderV34(marker, tNow, rng, reporterStats)) continue;
      recordView(marker);
      const sensesGood = (s.goodnessSensitivity * s.intrinsicGoodness + (1 - s.goodnessSensitivity) * 0.5) > rng();
      if (sensesGood) {
        if (rng() < s.baseLikeRate) addLikeV34(marker, uid, tNow);
      } else {
        if (rng() < s.baseReportRate) {
          const r = rng();
          let reason;
          if (s.intrinsicGoodness < 0.3) reason = r < 0.5 ? 'info_wrong' : 'spam';
          else if (s.intrinsicGoodness < 0.6) reason = r < 0.5 ? 'info_wrong' : 'dislike';
          else reason = 'dislike';
          if (addReportV34(marker, uid, reason, tNow)) recordReport(uid, reason, tNow);
        }
      }
      if (rng() < s.noiseDislikeProb) {
        if (addReportV34(marker, uid + '_n', 'dislike', tNow)) recordReport(uid + '_n', 'dislike', tNow);
      }
    }
    if (day === s.malicious.attackStartDay) {
      for (let r = 0; r < s.malicious.reporterCount; r++) {
        const aid = 'ATK' + r;
        reporterStats[aid] = s.malicious.priorReports;
        addReportV34(marker, aid, s.malicious.preferredReason, tNow);
      }
    }
    if (day === s.malicious.attackStartDay && s.malicious.brigadeSize) {
      for (let b = 0; b < s.malicious.brigadeSize; b++) {
        const bid = 'BRG' + b;
        if (addReportV34(marker, bid, s.malicious.preferredReason, tNow)) recordReport(bid, s.malicious.preferredReason, tNow);
      }
    }
    if (day === 1 && s.malicious.fakeLikers) {
      for (let f = 0; f < s.malicious.fakeLikers; f++) addLikeV34(marker, 'FAKE' + f, tNow);
    }
    if (s.authorRevisitInterval !== Infinity && day % s.authorRevisitInterval === 0) {
      recordView(marker);
      addLikeV34(marker, 'AUTHOR', tNow);
    }
  }
  const tFinal = s.days * DAY;
  const status = markerStatusV34(marker, tFinal, reporterStats);
  const life = lifeLeftV34(marker, tFinal, reporterStats);
  const exposure = exposureRateV34(marker, tFinal, reporterStats);
  const isAlive = (status !== 'sunk' && status !== 'archived') && exposure >= 0.2;
  return { isAlive, status, life: +life.toFixed(1), exposure,
    views: marker.viewCount, likes: marker.likes.length, reports: marker.reports.length };
}

function judge(result) {
  const { likes, reports } = result;
  const strongLike = likes >= 5 && likes >= reports * 2;
  if (strongLike && !result.isAlive) return { pass: false, reason: '强 like 信号但被沉' };
  const strongReport = reports >= 5 && reports >= likes * 2;
  if (strongReport && result.isAlive) return { pass: false, reason: '强 report 信号但活' };
  return { pass: true, reason: '信号一致' };
}

const STATUS_CN = { healthy: '健康', borderline: '临界', weak: '微弱', heartbeat: '心跳', sunk: '已沉', archived: '归档' };
const TYPE_CN = { danger: '危险', supply: '补给', junction: '岔路', scenic: '风景', cairn: '石堆' };
const REASON_CN = {
  info_wrong: '信息错', danger_wrong: '危险信息错', spam: '垃圾', hate: '仇恨',
  privacy: '隐私', cultural: '文化冒犯', dislike: '不喜欢', other: '其他'
};

const masterRng = makeRng(42);

console.log('');
console.log('========================================');
console.log(' 真随机机器 — 抓前 5 个 case (master_seed=42)');
console.log(' 跟 5000/5000 通过测试同一套生成器');
console.log('========================================');
console.log('');

for (let i = 1; i <= 5; i++) {
  const scenario = generateScenario(masterRng);
  const seed = (masterRng() * 1e9) | 0;
  const result = simulate(scenario, seed);
  const judgement = judge(result);

  const s = scenario, x = result;
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Case ' + i);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【场景参数 (随机生成, 算法看不到)】');
  console.log('  类型              : ' + TYPE_CN[s.type] + ' (' + s.type + ')' + (s.isDoc ? ' [DOC预热]' : ''));
  const goodTag = s.intrinsicGoodness > 0.7 ? '(高质量)' : s.intrinsicGoodness > 0.4 ? '(中等)' : '(低质量)';
  console.log('  内在质量          : ' + (s.intrinsicGoodness * 100).toFixed(0) + '/100  ' + goodTag);
  const encTag = s.encountersPerDay > 5 ? '(市区繁忙)' : s.encountersPerDay > 0.5 ? '(郊区一般)' : '(偏远稀少)';
  console.log('  路过密度          : ' + s.encountersPerDay.toFixed(2) + ' 人/天  ' + encTag);
  console.log('  存活模拟天数      : ' + s.days + ' 天 (≈ ' + (s.days / 30).toFixed(1) + ' 个月)');
  console.log('  用户判断力        : ' + (s.goodnessSensitivity * 100).toFixed(0) + '/100');
  console.log('  作者回访间隔      : ' + (s.authorRevisitInterval === Infinity ? '从此不回' : s.authorRevisitInterval + ' 天/次'));
  console.log('  恶意攻击者数      : ' + s.malicious.reporterCount + ' 人 (跨 mark 历史: ' + s.malicious.priorReports + ' 次)');
  console.log('  brigade 小号攻击  : ' + s.malicious.brigadeSize + ' 人' + (s.malicious.brigadeSize > 0 ? ' (集中第 ' + s.malicious.attackStartDay + ' 天爆发)' : ''));
  console.log('  刷赞机器人        : ' + s.malicious.fakeLikers + ' 人 (创建第 1 天)');
  console.log('  攻击理由          : ' + REASON_CN[s.malicious.preferredReason]);
  console.log('');
  console.log('【模拟结果 (跑完 ' + s.days + ' 天)】');
  console.log('  累积曝光          : ' + x.views + ' 次 (' + (x.views / s.days).toFixed(2) + ' 次/天)');
  console.log('  累积赞            : ' + x.likes);
  console.log('  累积举报          : ' + x.reports);
  console.log('  最终曝光率        : ' + (x.exposure * 100).toFixed(0) + '%');
  console.log('  最终寿命          : ' + x.life + ' 天');
  console.log('  最终状态          : ' + STATUS_CN[x.status] + ' (' + x.status + ')');
  console.log('  是否真活          : ' + (x.isAlive ? '✅ 活' : '❌ 沉') + '  (= 状态非沉/归档 且 曝光≥20%)');
  console.log('');
  console.log('【合理性判定】');
  const ratio = x.reports > 0 ? (x.likes / x.reports).toFixed(2) : '∞';
  console.log('  赞/举 比值        : ' + ratio);
  let signalDesc;
  if (x.likes >= 5 && x.likes >= x.reports * 2) signalDesc = '强 like 信号 (≥5赞 且 赞≥举×2)';
  else if (x.reports >= 5 && x.reports >= x.likes * 2) signalDesc = '强 report 信号 (≥5举 且 举≥赞×2)';
  else signalDesc = '信号弱/模糊 (任意判定都接受)';
  console.log('  信号判断          : ' + signalDesc);
  console.log('  判定结论          : ' + (judgement.pass ? '✅ 通过' : '❌ 失败') + ' — ' + judgement.reason);
  console.log('');
}

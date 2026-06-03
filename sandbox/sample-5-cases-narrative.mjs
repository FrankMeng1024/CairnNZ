/**
 * 5 个真随机 case — 故事化时间线版本
 * 每一个用户行为(赞/举报/攻击)都按月份叙述出来
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

const STATUS_CN = { healthy: '健康', borderline: '临界', weak: '微弱', heartbeat: '心跳', sunk: '已沉', archived: '归档' };
const TYPE_CN = { danger: '危险', supply: '补给', junction: '岔路', scenic: '风景', cairn: '石堆' };
const REASON_CN = {
  info_wrong: '信息错', danger_wrong: '危险信息错', spam: '垃圾', hate: '仇恨',
  privacy: '隐私', cultural: '文化冒犯', dislike: '不喜欢', other: '其他'
};

function formatDay(day) {
  const months = (day / 30);
  if (months < 1) return '第' + day + '天';
  if (months < 12) return '第' + months.toFixed(1) + '月';
  return '第' + (months / 12).toFixed(1) + '年';
}

// ==================================================================
// 模拟函数 — 同时录下事件流
// ==================================================================
function simulateWithLog(s, seed) {
  const rng = makeRng(seed);
  const marker = createMarkerV34({ id: 'm', type: s.type, x: 0, y: 0, authorId: 'AUTHOR', tCreate: 1, isDoc: s.isDoc });
  const events = [];

  if (s.isDoc) {
    const seedLikes = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < seedLikes; i++) addLikeV34(marker, 'DOC_SEED_' + i, 1);
    events.push({ day: 0, kind: 'doc-seed', text: '系统预热: 自动给 ' + seedLikes + ' 个种子赞 (DOC mark)' });
  }

  const reporterStats = {}, reporterReports = {};
  function recordReport(uid, reason, t) {
    if (!reporterReports[uid]) reporterReports[uid] = [];
    reporterReports[uid].push(t);
    reporterStats[uid] = reporterReports[uid].filter(rt => (t - rt) <= 30 * DAY).length;
  }
  let userCounter = 0;
  let dailyEvents = [];

  for (let day = 1; day <= s.days; day++) {
    const tNow = day * DAY;
    dailyEvents = [];
    const expected = s.encountersPerDay;
    const actual = Math.floor(expected) + (rng() < (expected - Math.floor(expected)) ? 1 : 0);

    for (let i = 0; i < actual; i++) {
      const uid = 'U' + (++userCounter);
      if (!shouldRenderV34(marker, tNow, rng, reporterStats)) {
        dailyEvents.push({ kind: 'blocked', uid });
        continue;
      }
      recordView(marker);
      const sensesGood = (s.goodnessSensitivity * s.intrinsicGoodness + (1 - s.goodnessSensitivity) * 0.5) > rng();
      if (sensesGood) {
        if (rng() < s.baseLikeRate) {
          addLikeV34(marker, uid, tNow);
          dailyEvents.push({ kind: 'like', uid });
        } else {
          dailyEvents.push({ kind: 'view-only', uid });
        }
      } else {
        if (rng() < s.baseReportRate) {
          const r = rng();
          let reason;
          if (s.intrinsicGoodness < 0.3) reason = r < 0.5 ? 'info_wrong' : 'spam';
          else if (s.intrinsicGoodness < 0.6) reason = r < 0.5 ? 'info_wrong' : 'dislike';
          else reason = 'dislike';
          if (addReportV34(marker, uid, reason, tNow)) {
            recordReport(uid, reason, tNow);
            dailyEvents.push({ kind: 'report', uid, reason });
          }
        } else {
          dailyEvents.push({ kind: 'view-only', uid });
        }
      }
      if (rng() < s.noiseDislikeProb) {
        if (addReportV34(marker, uid + '_n', 'dislike', tNow)) {
          recordReport(uid + '_n', 'dislike', tNow);
          dailyEvents.push({ kind: 'noise-report', uid: uid + '_n', reason: 'dislike' });
        }
      }
    }
    if (day === s.malicious.attackStartDay && s.malicious.reporterCount > 0) {
      for (let r = 0; r < s.malicious.reporterCount; r++) {
        const aid = 'ATK' + r;
        reporterStats[aid] = s.malicious.priorReports;
        if (addReportV34(marker, aid, s.malicious.preferredReason, tNow)) {
          dailyEvents.push({ kind: 'attacker-report', uid: aid, reason: s.malicious.preferredReason, prior: s.malicious.priorReports });
        }
      }
    }
    if (day === s.malicious.attackStartDay && s.malicious.brigadeSize) {
      for (let b = 0; b < s.malicious.brigadeSize; b++) {
        const bid = 'BRG' + b;
        if (addReportV34(marker, bid, s.malicious.preferredReason, tNow)) {
          recordReport(bid, s.malicious.preferredReason, tNow);
          dailyEvents.push({ kind: 'brigade-report', uid: bid, reason: s.malicious.preferredReason });
        }
      }
    }
    if (day === 1 && s.malicious.fakeLikers) {
      for (let f = 0; f < s.malicious.fakeLikers; f++) {
        if (addLikeV34(marker, 'FAKE' + f, tNow)) {
          dailyEvents.push({ kind: 'fake-like', uid: 'FAKE' + f });
        }
      }
    }
    if (s.authorRevisitInterval !== Infinity && day % s.authorRevisitInterval === 0) {
      recordView(marker);
      if (addLikeV34(marker, 'AUTHOR', tNow)) {
        dailyEvents.push({ kind: 'author-revisit', uid: 'AUTHOR' });
      }
    }

    // 把当天有意义的事件聚合后入 events
    if (dailyEvents.length > 0) {
      const meaningful = dailyEvents.filter(e => e.kind !== 'view-only' && e.kind !== 'blocked');
      if (meaningful.length > 0) {
        events.push({ day, kind: 'day-summary', events: meaningful });
      }
    }
  }

  const tFinal = s.days * DAY;
  const status = markerStatusV34(marker, tFinal, reporterStats);
  const life = lifeLeftV34(marker, tFinal, reporterStats);
  const exposure = exposureRateV34(marker, tFinal, reporterStats);
  const isAlive = (status !== 'sunk' && status !== 'archived') && exposure >= 0.2;

  return { events, status, life: +life.toFixed(1), exposure, isAlive,
    views: marker.viewCount, likes: marker.likes.length, reports: marker.reports.length };
}

// 把日事件文本化
function describeEvent(e) {
  const parts = [];
  for (const ev of e.events) {
    if (ev.kind === 'like')           parts.push(ev.uid + ' 路过, 点赞');
    else if (ev.kind === 'report')    parts.push(ev.uid + ' 路过, 举报(' + REASON_CN[ev.reason] + ')');
    else if (ev.kind === 'noise-report') parts.push('噪音 dislike 举报');
    else if (ev.kind === 'attacker-report') parts.push('🚨 恶意举报者 ' + ev.uid + ' (前科' + ev.prior + '次) 举报(' + REASON_CN[ev.reason] + ')');
    else if (ev.kind === 'brigade-report') parts.push('🚨 brigade 小号 ' + ev.uid + ' 举报(' + REASON_CN[ev.reason] + ')');
    else if (ev.kind === 'fake-like') parts.push('🤖 刷赞机器人 ' + ev.uid);
    else if (ev.kind === 'author-revisit') parts.push('👤 作者回访 + 自赞');
  }
  return parts.join(' | ');
}

// 抓 5 个 case
const masterRng = makeRng(42);

console.log('');
console.log('==================================================');
console.log(' 真随机机器 — 5 个 case 故事化时间线 (master_seed=42)');
console.log('==================================================');

for (let i = 1; i <= 5; i++) {
  const scenario = generateScenario(masterRng);
  const seed = (masterRng() * 1e9) | 0;
  const result = simulateWithLog(scenario, seed);

  const s = scenario, x = result;

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Case ' + i + ' — ' + TYPE_CN[s.type] + (s.isDoc ? ' [DOC]' : '') + ' mark');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const goodTag = s.intrinsicGoodness > 0.7 ? '高质量' : s.intrinsicGoodness > 0.4 ? '中等' : '低质量';
  const encTag = s.encountersPerDay > 5 ? '市区繁忙' : s.encountersPerDay > 0.5 ? '郊区一般' : '偏远稀少';
  console.log('【背景】');
  console.log('  作者在' + encTag + '地区 (' + s.encountersPerDay.toFixed(2) + '人/天) 发了一个 ' + goodTag + ' 的 ' + TYPE_CN[s.type] + ' mark');
  console.log('  内在质量: ' + (s.intrinsicGoodness * 100).toFixed(0) + '/100, 模拟时长 ' + s.days + ' 天 (' + (s.days / 30).toFixed(1) + ' 个月)');
  console.log('  作者: ' + (s.authorRevisitInterval === Infinity ? '从此不回头' : '每 ' + s.authorRevisitInterval + ' 天回访一次'));
  if (s.malicious.fakeLikers || s.malicious.reporterCount || s.malicious.brigadeSize) {
    const atks = [];
    if (s.malicious.fakeLikers) atks.push(s.malicious.fakeLikers + '个刷赞机器人');
    if (s.malicious.reporterCount) atks.push(s.malicious.reporterCount + '个恶意举报者(前科'+ s.malicious.priorReports +'次)');
    if (s.malicious.brigadeSize) atks.push(s.malicious.brigadeSize + '个brigade小号(第'+ s.malicious.attackStartDay +'天爆发)');
    console.log('  ⚠️  攻击: ' + atks.join(' + '));
  } else {
    console.log('  攻击: 无 (干净场景)');
  }

  console.log('');
  console.log('【完整事件时间线】');

  // 把事件按月份聚合
  const byMonth = {};
  for (const e of x.events) {
    const monthKey = Math.floor(e.day / 30);
    if (!byMonth[monthKey]) byMonth[monthKey] = [];
    byMonth[monthKey].push(e);
  }

  // 总事件控制 — 偷个懒, 如果太多就抽样
  const totalEvts = x.events.length;
  let displayed = 0;
  const MAX_DISPLAY = 25;

  const monthKeys = Object.keys(byMonth).map(Number).sort((a, b) => a - b);
  for (const mk of monthKeys) {
    const dayEvts = byMonth[mk];
    if (totalEvts <= MAX_DISPLAY) {
      // 全部显示
      for (const e of dayEvts) {
        console.log('  ' + formatDay(e.day).padEnd(8) + ': ' + describeEvent(e));
        displayed++;
      }
    } else {
      // 抽样: 每月最多 2 条
      const sample = dayEvts.slice(0, 2);
      for (const e of sample) {
        console.log('  ' + formatDay(e.day).padEnd(8) + ': ' + describeEvent(e));
        displayed++;
      }
      if (dayEvts.length > 2) {
        console.log('  ' + formatDay(dayEvts[0].day).padEnd(8) + '  ... (本月还有 ' + (dayEvts.length - 2) + ' 个事件省略)');
      }
    }
  }
  if (totalEvts > MAX_DISPLAY) {
    console.log('  (共 ' + totalEvts + ' 个事件日, 抽样展示)');
  }

  console.log('');
  console.log('【最终结果】(第 ' + s.days + ' 天)');
  console.log('  累积赞       : ' + x.likes + '   累积举报: ' + x.reports);
  console.log('  寿命天       : ' + x.life);
  console.log('  曝光率       : ' + (x.exposure * 100).toFixed(0) + '%');
  console.log('  状态         : ' + STATUS_CN[x.status] + ' → ' + (x.isAlive ? '✅ 后续路过的人能看到' : '❌ 后续路过的人看不到'));
  console.log('');
}

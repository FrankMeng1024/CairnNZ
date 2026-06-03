/**
 * algorithm-v6.mjs — Cairn 算法 v6.6 实施
 *
 * 严格按 algorithm-思想-v6.md (v6.6) 思想实施:
 *
 * 三大支柱:
 *   1. 占比驱动 (滑动窗口,不是数字)
 *   2. 医院模型 (双路径生命周期: 自然老死 / 病死)
 *   3. 流量动态系数 (base × 转化率系数,渐近上限)
 *
 * 状态机:
 *   HEALTHY → 寿命走完 → DEAD (自然老死)
 *   HEALTHY → 向下急转 → SUSPICIOUS → CRITICAL → HEARTBEAT → DEAD (病死)
 *   任何状态强心剂 → 回退一阶段
 *   任何状态寿命走完 → DEAD (寿命优先)
 *
 * 关键规则:
 *   - 治疗机会 = 投票 (1人1票永久,view 不算)
 *   - 严重度只影响处理力度 (不参与急转识别和入口判定)
 *   - 急转双向: 向上 = 续命/强心剂; 向下 = SUSPICIOUS
 *   - 信号消化: 强心剂触发后旧 report 降权
 *   - 续命 + 强心剂同时生效 (两个作用都触发)
 *   - 简单对称设计,不防复杂攻击
 */

const DAY_MS = 86400 * 1000;

// ======================================================================
// type 基础寿命 (天) — 给好 mark 留足续命空间
// ======================================================================
const BASE_LIFESPAN = {
  danger: 365,    // 危险信息有时效但有持续性
  supply: 540,    // 资源点 (水源/小屋) 长期存在
  junction: 540,  // 路标长期
  scenic: 730,    // 风景点最长
  cairn: 540,     // cairn 路标
};

// ======================================================================
// Report 严重度 (用于处理力度,不影响入口判定)
// ======================================================================
const SEVERITY = {
  fake_ad: 3.0,        // 虚假广告 - 最高
  info_mismatch: 1.5,  // 信息不符 - 中
  dislike: 0.5,        // 不喜欢 - 最低
  // 旧 reason 兼容映射
  info_wrong: 1.5,
  outdated: 1.5,
  wrong_location: 1.0,
  not_useful: 0.5,
  unsafe_to_visit: 1.5,
  offensive: 0.5,
};

function severityOf(reasonOrCategory) {
  return SEVERITY[reasonOrCategory] ?? 1.0;
}

// ======================================================================
// Reporter 信誉权重
// ======================================================================
function reputationWeight(reporter, marker, action) {
  if (!reporter) return 1.0;
  let w = 1.0;
  // 注册时间短 (< 30 天)
  if (reporter.daysSinceRegistration !== undefined && reporter.daysSinceRegistration < 30) {
    w *= 0.4;
  }
  // 行为偏向: 只 report 不 like
  if (reporter.totalReports > 5 && reporter.totalLikes === 0) {
    w *= 0.5;
  }
  // 行为偏向: 只 like 不 report (防自吹)
  if (reporter.totalLikes > 10 && reporter.totalReports === 0 && action === 'like') {
    w *= 0.6;
  }
  // 跨 mark 集中举报
  if (reporter.recentReportSpread && reporter.recentReportSpread > 3 &&
      reporter.recentDays && reporter.recentDays < 7) {
    w *= 0.4;
  }
  // 历史可信
  if (reporter.confirmedTrueReports && reporter.confirmedTrueReports >= 3) {
    w *= 1.2;
  }
  return Math.min(1.5, Math.max(0.2, w));
}

// ======================================================================
// 创建 marker
// ======================================================================
export function createMarker({ id, type, x, y, authorId, tCreate, isOfficial, authorRole, isRevived, historyAssets }) {
  const baseLife = BASE_LIFESPAN[type] || 100;
  // 复活 mark: 寿命 = base + 历史加成 (历史好评 → 加成)
  let lifespanDays = baseLife;
  if (isRevived && historyAssets) {
    const histLikes = historyAssets.likes || 0;
    const histReports = historyAssets.reports || 0;
    const total = histLikes + histReports;
    if (total >= 10 && histLikes / total >= 0.7) {
      // 历史好评率高,寿命大幅加成 (渐近上限 ~ 5x base)
      const ratioBoost = (histLikes / total - 0.7) / 0.3;  // 0..1
      const sizeBoost = Math.min(1, total / 200);  // 0..1
      lifespanDays = baseLife * (1 + 4 * ratioBoost * sizeBoost);
    }
  }
  return {
    id, type, x, y, authorId,
    tCreate: tCreate || 0,
    isOfficial: !!isOfficial,
    authorRole: authorRole || 'user',
    isRevived: !!isRevived,
    historyAssets: historyAssets || null,
    likes: [],         // [{ uid, t, weight }]
    reports: [],       // [{ uid, t, weight, reasonCategory, severity, suppressedAt }]
    viewCount: 0,
    state: 'healthy',
    stateEnteredAt: tCreate || 0,
    lastHeartStarterAt: 0,  // 上次强心剂触发时间(用于信号消化)
    baseLifespanMs: lifespanDays * DAY_MS,
    extraLifespanMs: 0,    // 续命累积
  };
}

export function recordView(marker) {
  marker.viewCount++;
}

export function addLike(marker, uid, t, reporter) {
  if (uid === marker.authorId) return;  // 作者不能给自己点赞
  if (marker.likes.find(l => l.uid === uid)) return;  // 1人1票
  if (marker.reports.find(r => r.uid === uid)) return;  // 互斥
  const weight = reputationWeight(reporter, marker, 'like');
  marker.likes.push({ uid, t, weight });
}

export function addReport(marker, uid, reasonCategory, t, reporter) {
  if (uid === marker.authorId) return;
  if (marker.reports.find(r => r.uid === uid)) return;
  if (marker.likes.find(l => l.uid === uid)) return;
  const weight = reputationWeight(reporter, marker, 'report');
  const severity = severityOf(reasonCategory);
  marker.reports.push({ uid, t, weight, reasonCategory, severity, suppressedAt: 0 });
}

// ======================================================================
// 滑动窗口工具
// ======================================================================
function inWindow(t, tNow, windowMs) {
  return (tNow - t) <= windowMs;
}

// 信号消化: 强心剂触发前的 report 在后续判定中降权
function effectiveReportWeight(r, marker) {
  if (r.suppressedAt > 0) {
    // 已被强心剂消化,权重大幅降低
    return r.weight * 0.2;
  }
  return r.weight;
}

// 滑动窗口内的加权 like / report
function weightedSignals(marker, tNow, windowMs) {
  let likeW = 0, reportW = 0;
  let likeCount = 0, reportCount = 0;
  let weightedReportSeverity = 0;
  for (const l of marker.likes) {
    if (inWindow(l.t, tNow, windowMs)) {
      likeW += l.weight;
      likeCount++;
    }
  }
  for (const r of marker.reports) {
    if (inWindow(r.t, tNow, windowMs)) {
      const w = effectiveReportWeight(r, marker);
      reportW += w;
      reportCount++;
      weightedReportSeverity += w * r.severity;
    }
  }
  return { likeW, reportW, likeCount, reportCount, weightedReportSeverity };
}

// ======================================================================
// 急转识别 (速率拐点 / 尖角检测)
//
// 思路: 把信号按时间排序,看 report 累积曲线是否出现"尖角"(速率突然跳升)。
// 不是用固定窗口对比远期/近期,而是看曲线形状。
//
// 步骤:
//  1. 把所有 reports / likes 按时间排序
//  2. 找最近的"突发段"(连续短时间内多条 report)
//  3. 比较突发段的 report 速率 vs 之前的 baseline 速率
//  4. 如果突发速率 >> baseline 速率(>= 5x),且 likes 速率没同步 → 向下急转
//  5. 同样逻辑反向检测 likes burst → 向上急转
// ======================================================================
function detectAcuteShift(marker, tNow) {
  const allReports = [...marker.reports]
    .filter(r => r.t <= tNow)
    .map(r => ({ ...r, effW: effectiveReportWeight(r, marker) }))
    .sort((a, b) => a.t - b.t);
  const allLikes = [...marker.likes]
    .filter(l => l.t <= tNow)
    .sort((a, b) => a.t - b.t);

  // 量级门槛: 至少要 3 条信号才考虑急转
  if (allReports.length + allLikes.length < 3) {
    return { direction: 'none', magnitude: 0 };
  }

  // 找"突发段": 看最近的 reports 集中度
  // 自适应窗口: 用 mark 全期的 1/3 和最近 30 天中较小者作为"近期"
  // 但 baseline 至少要占 50% 才能对比
  const ageMs = tNow - marker.tCreate;
  let recentMs = Math.min(30 * DAY_MS, Math.max(3 * DAY_MS, ageMs * 0.33));
  // 确保 baseline >= 50%
  recentMs = Math.min(recentMs, ageMs * 0.5);

  let recentReportW = 0, recentLikeW = 0;
  let recentReportCount = 0, recentLikeCount = 0;
  let recentSeverity = 0;
  for (const r of allReports) {
    if (tNow - r.t <= recentMs) {
      recentReportW += r.effW;
      recentReportCount++;
      recentSeverity += r.effW * r.severity;
    }
  }
  for (const l of allLikes) {
    if (tNow - l.t <= recentMs) {
      recentLikeW += l.weight;
      recentLikeCount++;
    }
  }

  // baseline: recent 之前的部分
  let baseReportW = 0, baseLikeW = 0;
  let baseReportCount = 0, baseLikeCount = 0;
  for (const r of allReports) {
    if (tNow - r.t > recentMs) { baseReportW += r.effW; baseReportCount++; }
  }
  for (const l of allLikes) {
    if (tNow - l.t > recentMs) { baseLikeW += l.weight; baseLikeCount++; }
  }

  const recentDays = recentMs / DAY_MS;
  // baseline 时长 = 总时长 - recent
  const baseDays = Math.max(1, (ageMs / DAY_MS) - recentDays);

  // 速率 (条/天)
  const recentReportRate = recentReportW / recentDays;
  const recentLikeRate = recentLikeW / recentDays;
  const baseReportRate = baseReportW / baseDays;
  const baseLikeRate = baseLikeW / baseDays;

  // 检测向下急转 (尖角): 近期 report 速率 >> baseline report 速率
  // SUSPICIOUS 入口设计倾向"宁可误进"——有 cooldown + 强心剂回退保护
  // 用加权信号判定 (信誉权重低的攻击者会被削弱)
  const effRecentReportSignal = recentReportW;  // 加权后等效条数
  if (effRecentReportSignal >= 2) {  // 加权后 >= 2 条
    const recentNegRatio = (recentReportW + recentLikeW) > 0 ? recentReportW / (recentReportW + recentLikeW) : 0;
    const baseTotal = baseReportW + baseLikeW;
    const baseNegRatio = baseTotal > 0 ? baseReportW / baseTotal : 0.5;
    // 持续争议保护: 仅当 baseline 也在争议区间 (35-65%) 才算持续争议 (收紧)
    const isControversial = recentNegRatio >= 0.35 && recentNegRatio <= 0.65 &&
                            baseNegRatio >= 0.30 && baseNegRatio <= 0.70;
    const reportRateRatio = baseReportRate > 0 ? recentReportRate / baseReportRate : 999;
    const likeReportRatio = recentReportRate > 0 ? recentLikeRate / recentReportRate : 0;

    // 情况 A: baseline 干净 (基本无 report) + 近期突然有 report
    if (baseReportCount <= 1 && recentReportCount >= 2 && !isControversial) {
      if (recentLikeRate < recentReportRate * 1.2) {  // like 没大幅同步加速
        return {
          direction: 'down',
          magnitude: recentReportCount / Math.max(1, baseReportCount + 1),
          recentReportRate, baseReportRate,
          severityWeight: recentSeverity / Math.max(1, recentReportW),
        };
      }
    }
    // 情况 B: baseline 也有 report,但近期速率显著加速 (排除持续争议)
    if (reportRateRatio >= 2.5 && likeReportRatio < 1.2 && !isControversial && recentNegRatio >= 0.50) {
      return {
        direction: 'down',
        magnitude: reportRateRatio,
        recentReportRate, baseReportRate,
        severityWeight: recentSeverity / Math.max(1, recentReportW),
      };
    }
  }

  // 检测向上急转 (尖角): 近期 like 速率 >> baseline like 速率
  if (recentLikeCount >= 3) {
    const likeRateRatio = baseLikeRate > 0 ? recentLikeRate / baseLikeRate : 999;
    const reportLikeRatio = recentLikeRate > 0 ? recentReportRate / recentLikeRate : 0;

    if (baseLikeCount <= 1 && recentLikeCount >= 3 && reportLikeRatio < 1.0) {
      return {
        direction: 'up',
        magnitude: recentLikeCount,
        recentLikeRate, baseLikeRate,
      };
    }
    if (likeRateRatio >= 3.0 && reportLikeRatio < 0.5) {
      return {
        direction: 'up',
        magnitude: likeRateRatio,
        recentLikeRate, baseLikeRate,
      };
    }
  }

  return { direction: 'none', magnitude: 0 };
}

// ======================================================================
// 转化率系数 (用于续命奖励)
// 用累积 like / 累积 view (反映 mark 整体被认可程度)
// ======================================================================
function conversionRateBoost(marker, tNow) {
  let totalLikeWeight = 0;
  for (const l of marker.likes) {
    totalLikeWeight += l.weight;
  }

  if (marker.viewCount < 5) {
    return 1.0;
  }

  const conversion = totalLikeWeight / marker.viewCount;
  // 转化率系数: 0% → 1.0; 5% → 1.4; 20% → 2.5; 50%+ → 渐近 4.0
  const k = 1.0 + 3.0 * (1 - Math.exp(-conversion * 8));
  return Math.max(1.0, Math.min(4.0, k));
}

// ======================================================================
// 0 view 期慢速流失 (冰冻原则 v6.7)
// 实际 ageMs 转换成"等效流失 ageMs":有 view 段全速,0 view 段 0.3x 速度
// ======================================================================
const FROZEN_RATE = 0.3;  // 0 view 期流失速率

function effectiveAgeMs(marker, tNow) {
  // 把 likes/reports/view 都视为"有人来"的标记
  // 简化: 用所有事件的时间戳作为"有人来"的点
  // 0 view 间隔 (无任何事件) 按 0.3x 速度计算
  const events = [];
  for (const l of marker.likes) events.push(l.t);
  for (const r of marker.reports) events.push(r.t);
  events.sort((a, b) => a - b);

  if (events.length === 0) {
    // 完全没事件: 用 viewCount 估计活跃度
    if (marker.viewCount === 0) {
      // 0 view 0 投票: 整段慢速
      return (tNow - marker.tCreate) * FROZEN_RATE;
    }
    // 有 view 但 0 投票: 假设 view 均匀分布,正常速度
    return tNow - marker.tCreate;
  }

  // 把时间轴分段: tCreate → first event → last event → tNow
  // 事件之间的间隔如果 > 30 天, 视为"沉默期"按 FROZEN_RATE
  const SILENCE_THRESHOLD = 30 * DAY_MS;
  let totalEffective = 0;
  let prevT = marker.tCreate;

  // 用 view 估计 "活跃期" — 简化: 假设 view 在 events 期间均匀分布
  for (const t of events) {
    const gap = t - prevT;
    if (gap > SILENCE_THRESHOLD) {
      // 沉默期前 30 天正常,之后慢速
      totalEffective += SILENCE_THRESHOLD;
      totalEffective += (gap - SILENCE_THRESHOLD) * FROZEN_RATE;
    } else {
      totalEffective += gap;
    }
    prevT = t;
  }

  // 最后事件到 tNow
  const finalGap = tNow - prevT;
  if (finalGap > SILENCE_THRESHOLD) {
    totalEffective += SILENCE_THRESHOLD;
    totalEffective += (finalGap - SILENCE_THRESHOLD) * FROZEN_RATE;
  } else {
    totalEffective += finalGap;
  }

  return totalEffective;
}

// ======================================================================
// 寿命计算 (时钟 A) — v6.7 改用 effectiveAgeMs
// ======================================================================
export function lifeLeft(marker, tNow) {
  const effAge = effectiveAgeMs(marker, tNow);
  const totalLifespan = marker.baseLifespanMs + marker.extraLifespanMs;
  return (totalLifespan - effAge) / DAY_MS;
}

// 续命: v6.7 改成"定期奖励" — 在 HEALTHY 时,每 30 天检查一次
// 给出对应转化率的小段寿命奖励
function updateContinuousLifespan(marker, tNow) {
  if (marker.state !== 'healthy') return;  // 病期不续命
  if (!marker.lastBoostT) marker.lastBoostT = marker.tCreate;
  const REWARD_INTERVAL_MS = 30 * DAY_MS;
  while (tNow - marker.lastBoostT >= REWARD_INTERVAL_MS) {
    const boost = conversionRateBoost(marker, marker.lastBoostT + REWARD_INTERVAL_MS);
    // 每次奖励: 30 天 × (boost - 1) 的额外寿命
    // boost = 1.0 (无转化率) → 0 天奖励
    // boost = 2.0 → 30 天奖励
    // boost = 4.0 → 90 天奖励
    const reward = REWARD_INTERVAL_MS * (boost - 1.0);
    marker.extraLifespanMs += reward;
    marker.lastBoostT += REWARD_INTERVAL_MS;
  }
}

export function lifeLeftEffective(marker, tNow) {
  return lifeLeft(marker, tNow);
}

// ======================================================================
// 状态判定 (核心 v6.6 状态机)
// ======================================================================
export function markerStatus(marker, tNow) {
  // 先更新续命累积 (增量,不会减)
  updateContinuousLifespan(marker, tNow);

  // 寿命优先: 寿命走完 → DEAD,任何状态都适用
  const lifeLeftDays = lifeLeftEffective(marker, tNow);
  if (lifeLeftDays <= 0) {
    return marker.state === 'healthy' ? 'dead_natural' : 'dead_sick';
  }

  const totalSignals = marker.likes.length + marker.reports.length;

  // 急转检测
  const shift = detectAcuteShift(marker, tNow);

  // 当前状态 + 急转 → 状态转换
  let newState = marker.state;

  // 状态升级冷却: 同一状态至少持续 21 天才能升级 (避免误判后快速升级)
  const stateAgeDays = (tNow - marker.stateEnteredAt) / DAY_MS;
  const COOLDOWN_DAYS = 21;

  // 累积持续负向: 整段 mark 负向占比 > 60% 且 >= 10 条 report → 直接进入病危路径
  // (用于 sick_death arc 整段就是负向的情况,没有"急转"可识别)
  const recentMs = 60 * DAY_MS;
  let recentLikeW = 0, recentReportW = 0;
  for (const l of marker.likes) {
    if (inWindow(l.t, tNow, recentMs)) recentLikeW += l.weight;
  }
  for (const r of marker.reports) {
    if (inWindow(r.t, tNow, recentMs)) recentReportW += effectiveReportWeight(r, marker);
  }
  const recentTotalW = recentLikeW + recentReportW;
  const recentNegRatio = recentTotalW > 0 ? recentReportW / recentTotalW : 0;
  const recentReportCount = marker.reports.filter(r => inWindow(r.t, tNow, recentMs)).length;

  // 持续负向: 占比 >= 60% 且至少 5 条 report (兼顾比例和数量)
  // 严重度组合: 高严重度门槛降低
  const avgSeverity = recentReportCount > 0
    ? marker.reports.filter(r => inWindow(r.t, tNow, recentMs))
        .reduce((a, r) => a + r.severity, 0) / recentReportCount
    : 1.0;
  const severityBonus = Math.max(0, (avgSeverity - 1.0) * 0.05);
  // 持续负向门槛 55% (更敏感,SUSPICIOUS 入口宽松,有 cooldown 保护)
  // 用加权后的 reportW 计算"等效条数",信誉权重低的攻击者会被削弱
  const effectiveReportCount = recentReportW;  // 加权后的等效条数
  const sustainedThreshold = Math.max(0.50, 0.55 - severityBonus);
  const sustainedNegative = recentNegRatio >= sustainedThreshold && effectiveReportCount >= 4;

  if (shift.direction === 'down' || sustainedNegative) {
    if (marker.state === 'healthy') {
      newState = 'suspicious';
    } else if (stateAgeDays >= COOLDOWN_DAYS) {
      if (marker.state === 'suspicious') newState = 'critical';
      else if (marker.state === 'critical') newState = 'heartbeat';
      else if (marker.state === 'heartbeat') newState = 'dead_sick';
    }
  } else if (shift.direction === 'up' || (recentNegRatio < 0.4 && recentLikeW > recentReportW * 1.5 && marker.state !== 'healthy')) {
    // 向上急转 OR 近期明显正向 (在病期时强心剂)
    const boost = 30 * DAY_MS * Math.min(2, (shift.magnitude || 0.3) * 5);
    marker.extraLifespanMs += boost;

    if (marker.state === 'heartbeat') newState = 'critical';
    else if (marker.state === 'critical') newState = 'suspicious';
    else if (marker.state === 'suspicious') newState = 'healthy';

    for (const r of marker.reports) {
      if (r.t < tNow && r.suppressedAt === 0) {
        r.suppressedAt = tNow;
      }
    }
    marker.lastHeartStarterAt = tNow;
  }

  // 持久化状态变化
  if (newState !== marker.state) {
    marker.state = newState;
    marker.stateEnteredAt = tNow;
  }

  return marker.state;
}

// ======================================================================
// 曝光率
// ======================================================================
export function exposureRate(marker, tNow) {
  const status = marker.state;
  switch (status) {
    case 'healthy': return 1.0;
    case 'suspicious': return 1.0;
    case 'critical': return 0.30;
    case 'heartbeat': return 0.05;
    case 'dead_natural':
    case 'dead_sick':
    case 'dead': return 0.0;
    default: return 1.0;
  }
}

export function shouldRender(marker, tNow, rng) {
  const rate = exposureRate(marker, tNow);
  if (rate >= 1.0) return true;
  if (rate <= 0) return false;
  return (rng ? rng() : Math.random()) < rate;
}

// ======================================================================
// 兼容旧接口
// ======================================================================
export const createMarkerV4 = createMarker;
export const addLikeV4 = (marker, uid, t) => addLike(marker, uid, t);
export const addReportV4 = (marker, uid, reason, t) => addReport(marker, uid, reason, t);
export const lifeLeftV4 = lifeLeft;
export const exposureRateV4 = exposureRate;
export const markerStatusV4 = markerStatus;
export const shouldRenderV4 = shouldRender;

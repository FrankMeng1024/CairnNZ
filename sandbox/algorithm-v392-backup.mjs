/**
 * algorithm-v34.mjs — Cairn 算法 v3.4 "曝光老化 + 举报者可信度"
 *
 * 跟 v3.3 比的核心改动:
 *   1. effectiveAge = α × 日历天 + (1-α) × (views / refViewsPerDay)
 *      偏远 mark 没人看 → views 不增 → 老得慢
 *   2. reporterTrust(report.user.recentReportRate) 折扣举报权重
 *      恶意刷子越举报越无效 (狼来了)
 *   3. heat / penalty 衰减用 effectiveAge 同一把尺子
 *      避免日历快、热度衰减也快, 但 effectiveAge 慢的悖论
 *
 * 设计哲学: "你走过的路不是孤单的"
 *   - 偏远好 mark 不该因人少而死
 *   - 市区差 mark 不该因人多刷赞而活
 *   - 抗操纵: 刷曝光反而加速老化, 刷子无利可图
 */

// ======================================================================
// 类型参数 — 每类有自己的"日历权重 alpha"
// alpha 越高 = 越看日历 (时效性强); alpha 越低 = 越看曝光 (时效性弱)
// ======================================================================

export const TYPE_PARAMS_V34 = {
  // 危险信息: 时效性强但救命级别 mark 路过用户少互动也常见, 给一个长一点的基础寿命
  // v3.8: 14 → 60, 因为很多救命 mark 真路过的人多数没事不点赞
  danger:   { baseLifetime: 60,  tau: 30,  boost: 4, alpha: 0.85 },
  // 补给点: 商家可能搬走但也可能开很久, 中等
  supply:   { baseLifetime: 60,  tau: 60,  boost: 6, alpha: 0.50 },
  // 岔路: 路本身基本不变
  junction: { baseLifetime: 120, tau: 120, boost: 5, alpha: 0.30 },
  // 风景: 山就是山
  scenic:   { baseLifetime: 180, tau: 180, boost: 5, alpha: 0.20 },
  // 石堆: 几乎只看曝光, base 从 365 降到 180 防止扛住强举报
  cairn:    { baseLifetime: 180, tau: 365, boost: 5, alpha: 0.25 },
};

// 基准曝光速度: 平均每天被路过的次数 (市区水平)
// 偏远地区实际曝光会远低于这个数, 触发慢老化机制
export const REF_VIEWS_PER_DAY = 3;

// 举报者可信度参数: 最近 30 天举报 N 次, 可信度 = 1 / (1 + k*N)
export const REPORTER_K = 0.15;
export const REPORTER_WINDOW_DAYS = 30;

// v3.9: 软衰减替代硬上限
//   原: 730 天直接 -Infinity
//   新: 365 天后开始递减, 但永不归 -∞
//        365 天: 1.0× (无衰减)
//        730 天: 0.5×
//        1095 天: 0.25×
//        2190 天 (6 年): 0.05×
//   保活高质量 mark 长期存在 (NZ 真实 hut 可能 5+ 年有效)
const SOFT_DECAY_START_DAYS = 365;

// v3.8: 作者权威加成 — DOC/SAR/警察等官方账号
//   official 权威基础寿命 +50%, 也提供更高 reportPenalty 抗噪
const AUTHOR_ROLE_BOOST = {
  official: 1.5,        // DOC ranger, SAR, police - 救命 mark 必保
  user: 1.0,            // 普通用户 (默认)
  commercial_spam: 0.6, // 商业刷子可疑账号 - 基础寿命缩短
};

// 举报理由权重 (跟 v3.3 一致, 不动)
const REPORT_REASON_WEIGHTS = {
  info_wrong:   1.0,
  danger_wrong: 1.0,
  spam:         1.0,
  hate:         1.5,
  privacy:      1.5,
  cultural:     1.2,
  dislike:      0.3,
  other:        0.5,
};

// v3.8: 时间维度权重
//   - 报告新鲜度: 用连续指数衰减替代硬阶梯, half-life 180 天
//   - 这让"信息过时被持续举报"的 case 算法能识别 (后期举报推翻早期赞)
function reportFreshnessWeight(reportT, now) {
  const ageDays = (now - reportT) / MS_PER_DAY;
  // 连续指数衰减: 180 天后权重减半, 365 天后约 0.25
  return Math.exp(-ageDays / 260);
}

// v3.8+v3.9: 用户共识强度 — 连续 sigmoid, 替代硬阈值 5+/2:1
//   返回 [0, 1]: 0 = 信号太弱无法判断, 1 = 强共识
//   核心思想: 赞越多越强 + 比例越高越强, 但平滑过渡, 没有 5 vs 4 的悬崖
function consensusStrength(likes, reports) {
  // 量级因子: 赞越多越可信, 用 logistic 函数
  //   3 个: 0.40   5 个: 0.62   8 个: 0.83   15 个: 0.97   100+: ≈1.0
  const total = likes + reports;
  const volumeFactor = total === 0 ? 0 : 1 / (1 + Math.exp(-(total - 4) / 1.5));

  // 比例因子 (赞 vs 举报): 极端比例 → 1, 五五开 → 0
  const denom = likes + reports;
  if (denom === 0) return { likeStrength: 0, reportStrength: 0 };
  const likeRatio = likes / denom;
  // center=0.65 (略低于 2:1 = 0.67), slope=0.06 让 2:1 成为 ~0.5 中点
  const likeRatioFactor = 1 / (1 + Math.exp(-(likeRatio - 0.65) / 0.06));
  const reportRatioFactor = 1 / (1 + Math.exp(-((1 - likeRatio) - 0.65) / 0.06));

  // v3.9 fix: 大量级时比例反转更敏感
  //   total >= 50 时, 让 ratio 占主导, 减少 volumeFactor 拉平作用
  //   方法: 量级越大, 直接用 ratioFactor 不再乘 volumeFactor
  const total_ = likes + reports;
  if (total_ >= 50) {
    // 大量级时比例直接生效 (volumeFactor 接近 1 反而无差异)
    return {
      likeStrength: likeRatioFactor,
      reportStrength: reportRatioFactor,
    };
  }

  return {
    likeStrength: volumeFactor * likeRatioFactor,
    reportStrength: volumeFactor * reportRatioFactor,
  };
}

// v3.8+v3.9: 最近互动权重衰减 — 连续函数, 不是 365 天硬切
//   最新互动 (0 天前) = 1.0, 12 个月前 = 0.5, 24 个月前 = 0.25
function recentInteractionScore(marker, now) {
  const allEvents = [...(marker.likes || []), ...(marker.reports || [])];
  if (allEvents.length === 0) return 0;
  // 取最近的事件
  const mostRecentT = Math.max(...allEvents.map(e => e.t));
  const ageDays = (now - mostRecentT) / MS_PER_DAY;
  // half-life 365 天
  return Math.exp(-ageDays / 525);
}

// v3.9 NEW: 互动模式识别 — 判断 mark 是不是"短期爆发后死寂的过期 mark"
//   返回 [0, 1]: 0 = 持续活跃, 1 = 完全短期爆发后死寂 (该判沉)
//   适用: 节日活动、一次性赛事 → 活动期 1 个月赞潮, 之后零互动 → 算法看出来
//   不误伤: 偏远好 mark 一年一波访客 (报告比足够好就放过)
function shortBurstPattern(marker, now) {
  const allEvents = [...(marker.likes || []), ...(marker.reports || [])].sort((a,b) => a.t - b.t);
  if (allEvents.length < 5) return 0; // 信号不足
  const firstT = allEvents[0].t;
  const lastT = allEvents[allEvents.length - 1].t;
  const burstDuration = (lastT - firstT) / MS_PER_DAY;
  const silenceDuration = (now - lastT) / MS_PER_DAY;
  const totalAge = (now - firstT) / MS_PER_DAY;
  if (totalAge <= 0) return 0;

  const likes = (marker.likes || []).length;
  const reports = (marker.reports || []).length;

  // 短期爆发条件 (要全满足):
  //   1. burst 短 (< 60 天 内所有事件都在 burst 内)
  //   2. silence 长 (≥ burst × 3, 不是 ×2 防误伤季节性 mark)
  //   3. silence 占 totalAge 的比例 > 0.7 (不是 0.6, 更严)
  //   4. burst 内 likes/reports 不极端正向 (likes 不能 >= reports * 5)
  //      否则可能是真好 mark 突然爆火, 不是过期活动
  const silenceRatio = silenceDuration / totalAge;
  const burstShort = burstDuration < 60;
  const silenceLong = silenceDuration >= burstDuration * 3;
  const silenceLongEnough = silenceRatio > 0.7;
  const notExtremelyPositive = likes < reports * 5;

  if (!burstShort || !silenceLong || !silenceLongEnough || !notExtremelyPositive) return 0;

  // 短期爆发越明显, 返回越接近 1
  return Math.max(0, Math.min(1, (silenceRatio - 0.7) / 0.3));
}

const MS_PER_DAY = 24 * 3600 * 1000;
const daysBetween = (t1, t2) => (t2 - t1) / MS_PER_DAY;

// ======================================================================
// DOC mark: v3.6 不再有算法特权
//   DOC 是"预热数据" — 系统预设的高质量内容, 但跟用户 mark 走完全相同的
//   算法逻辑. DOC 的高质量通过: (1) 创建时附带几个种子赞 (虚拟用户认可)
//   或 (2) 给一个稍长的初始 baseLifetime — 但仍可以被用户用举报推翻.
//
//   保留 docParams 函数仅为兼容老 simulator, 现已等同于普通 params.
// ======================================================================

export function docParams(type) {
  return TYPE_PARAMS_V34[type];
}

// ======================================================================
// 曝光当量天数 (核心创新)
// ======================================================================

/**
 * effectiveAge: 这个 mark "实际老化了多少天"
 * v3.6: 健康调整双向
 *   - 负面信号占优 (reports>=3 且 reports>likes): alpha 强制 0.9 (按日历快老)
 *   - 正面信号占优 (likes>=3 且 likes>=reports*2): alpha 折半 (受偏远保护更强)
 *   - 中间区域: 用 type 默认 alpha
 */
export function effectiveAge(marker, now) {
  const calendarDays = daysBetween(marker.tCreate, now);
  const params = marker.isDoc ? docParams(marker.type) : TYPE_PARAMS_V34[marker.type];
  const views = marker.viewCount || 0;
  // v3.9: viewBasedDays 不能超过日历天数的 1.5 倍
  const rawViewDays = views / REF_VIEWS_PER_DAY;
  const viewBasedDays = Math.min(rawViewDays, calendarDays * 1.5);

  const likeCount = (marker.likes || []).length;
  const reportCount = (marker.reports || []).length;
  let alpha = params.alpha;
  if (reportCount >= 3 && reportCount > likeCount) {
    // 负面信号占优, 强制按日历老化
    alpha = Math.max(alpha, 0.9);
  } else if (likeCount >= 3 && likeCount >= reportCount * 2) {
    // 正面信号占优, 加强偏远保护
    alpha = alpha * 0.5;
  }

  let eff = alpha * calendarDays + (1 - alpha) * viewBasedDays;

  // v3.9: 强正信号下进一步 dampen effectiveAge
  //   净 like 数 / (likes+reports) 越大, effectiveAge 越被压缩
  //   像比例 0.7 (likes 远多于 reports): eff × 0.7
  //   像比例 0.5 (五五开): eff × 1.0
  if (likeCount + reportCount >= 5) {
    const likeRatio = likeCount / (likeCount + reportCount);
    if (likeRatio > 0.6) {
      // dampening: 比例 0.6 → 1.0, 比例 1.0 → 0.4
      const dampen = 1 - (likeRatio - 0.6) * 1.5;
      eff = eff * Math.max(0.4, dampen);
    }
  }

  return eff;
}

// ======================================================================
// 举报者可信度
// ======================================================================

/**
 * reporterTrust: 举报者最近 30 天举报次数越多, 可信度越低
 * 第一次举报: 1.0
 * 30 天内 5 次: 1/(1+0.75) = 0.57
 * 30 天内 20 次: 1/(1+3) = 0.25
 * 30 天内 50 次: 1/(1+7.5) = 0.118
 *
 * 注: recentReportCount 由 simulator 传入 (统计该 user 在 [now-30d, now] 区间举报数)
 */
export function reporterTrust(recentReportCount) {
  return 1 / (1 + REPORTER_K * recentReportCount);
}

// ======================================================================
// 单赞/单举报值 (用 effectiveAge 衰减, 不再用日历天)
// ======================================================================

/**
 * 一个赞或举报在 mark 时间线上的"effectiveAge"差
 * 我们仍用 mark.tCreate 作 0 点, 但所有时间换成 effectiveAge
 * 简化: 假设 effectiveAge 跟时间线性 → like.tEff = effectiveAge(now=like.t)
 *
 * 实际实现里, like.t 是日历时间戳, 我们计算 like 时刻到 now 时刻
 * 之间的 effectiveAge 差, 然后 e^(-Δeff/τ)
 */
export function likeValueV34(like, marker, now) {
  // like 之后到 now 之间, marker 老化了多少 effectiveAge
  // 简化: 用 calendar 比例缩 alpha + view 增量缩 (1-alpha)
  const calendarDelta = daysBetween(like.t, now);
  const params = marker.isDoc ? docParams(marker.type) : TYPE_PARAMS_V34[marker.type];
  // 假设 view 在时间上均匀分布 (simulator 会真给 viewsAtTime)
  // 这里用平均: 从 like.t 到 now 之间贡献的 view 数 = views × (calendarDelta / totalCalendar)
  const totalCalendar = daysBetween(marker.tCreate, now);
  const viewShare = totalCalendar > 0 ? (calendarDelta / totalCalendar) : 0;
  const viewsSinceLike = (marker.viewCount || 0) * viewShare;
  const effDelta = params.alpha * calendarDelta + (1 - params.alpha) * (viewsSinceLike / REF_VIEWS_PER_DAY);
  return Math.exp(-effDelta / params.tau);
}

export function currentHeatV34(marker, now) {
  return (marker.likes || []).reduce((sum, like) => sum + likeValueV34(like, marker, now), 0);
}

/**
 * 举报惩罚: 用 reporterTrust × reasonWeight × 衰减
 * v3.5: 同一 reason 累计折扣防 brigade
 *       不同 reason 各自独立计算 (多元化的负面信号更可信)
 *       同 reason 前 3 个全权重, 4-10 个 0.5, 11+ 个 0.2
 */
export function reportPenaltyV34(marker, now, reporterStats = {}) {
  const reports = marker.reports || [];
  // 按 reason 分组
  const byReason = {};
  reports.forEach(r => {
    if (!byReason[r.reason]) byReason[r.reason] = [];
    byReason[r.reason].push(r);
  });

  let total = 0;
  for (const [reason, group] of Object.entries(byReason)) {
    // 每条算 raw 值
    const rawValues = group.map(r => {
      const reasonW = REPORT_REASON_WEIGHTS[reason] || 0.5;
      const trust = reporterTrust(reporterStats[r.userId] || 0);
      const freshness = reportFreshnessWeight(r.t, now); // v3.8: 时间维度
      const calendarDelta = daysBetween(r.t, now);
      const params = marker.isDoc ? docParams(marker.type) : TYPE_PARAMS_V34[marker.type];
      const totalCalendar = daysBetween(marker.tCreate, now);
      const viewShare = totalCalendar > 0 ? (calendarDelta / totalCalendar) : 0;
      const viewsSinceReport = (marker.viewCount || 0) * viewShare;
      const effDelta = params.alpha * calendarDelta + (1 - params.alpha) * (viewsSinceReport / REF_VIEWS_PER_DAY);
      const decay = Math.exp(-effDelta / params.tau);
      // v3.8: freshness 是另一个独立衰减乘子 (跟 effDelta 不重叠 — effDelta 是 view-aware, freshness 是日历强约束)
      return { value: decay * reasonW * trust * freshness, t: r.t };
    });
    // 按时间倒序
    rawValues.sort((a, b) => b.t - a.t);
    rawValues.forEach((rv, i) => {
      // v3.9: rank 折扣连续化
      // i=0: 1.0, i=3: 0.65, i=10: 0.30, i=30: 0.10
      const rankWeight = 1 / (1 + i * 0.18);
      total += rv.value * rankWeight;
    });
  }
  return total;
}

// ======================================================================
// 剩余寿命 (用 effectiveAge 替代 daysAlive)
// ======================================================================

export function lifeLeftV34(marker, now, reporterStats = {}) {
  const params = marker.isDoc ? docParams(marker.type) : TYPE_PARAMS_V34[marker.type];
  const calendarDays = daysBetween(marker.tCreate, now);
  // v3.9: 不再有 HARD_CAP_DAYS, 改为软衰减乘子
  //   ageBoost = exp(-(calendarDays - SOFT_DECAY_START_DAYS) / 730) for >365 天
  const ageBoost = calendarDays <= SOFT_DECAY_START_DAYS
    ? 1.0
    : Math.exp(-(calendarDays - SOFT_DECAY_START_DAYS) / 730);

  // 冬季冻结 (沿用 v3.3)
  const effNow = marker.winterFrozenStart || now;
  const effCal = marker.winterFrozenStart
    ? daysBetween(marker.tCreate, marker.winterFrozenStart)
    : calendarDays;

  const cumulativeLikes = (marker.likes || []).length;
  const cumulativeReports = (marker.reports || []).length;

  // v3.8+v3.9: 作者权威加成 (连续乘子)
  const authorBoost = AUTHOR_ROLE_BOOST[marker.authorRole || 'user'] || 1.0;

  // v3.9: 用户共识强度 (连续, 没有硬阈值)
  const consensus = consensusStrength(cumulativeLikes, cumulativeReports);
  // 互动新鲜度加权 — 老共识权重打折, 新共识全权重
  const recencyScore = recentInteractionScore(marker, effNow);
  const effectiveLikeStrength = consensus.likeStrength * recencyScore;
  const effectiveReportStrength = consensus.reportStrength * recencyScore;

  // 用 effectiveAge 替换 daysAlive
  const eff = effectiveAge({ ...marker, viewCount: marker.viewCount || 0 }, effNow);
  const heat = currentHeatV34(marker, effNow);
  const penalty = reportPenaltyV34(marker, effNow, reporterStats);

  // v3.9: 累积 like 资本 + 累积 report 重压 (减半, 因为 consensus 已贡献大头)
  const netLikes = Math.max(0, cumulativeLikes - cumulativeReports);
  const netReports = Math.max(0, cumulativeReports - cumulativeLikes);
  const accumulatedBoost = Math.min(365, netLikes * 1.5);
  const accumulatedDrain = netReports * 0.6;

  // baseLifetime 应用作者权威加成 + 软年龄衰减
  // v3.9: 强 report 共识下削弱 base (防止 cairn 365天基础太厚扛住强举报)
  let adjustedBase = params.baseLifetime * authorBoost * ageBoost;
  if (effectiveReportStrength > 0.7) {
    // dampen: reportStrength 0.7 → 1.0×, 0.95 → 0.5×, 1.0 → 0.4×
    const dampen = 1 - (effectiveReportStrength - 0.7) * 2;
    adjustedBase = adjustedBase * Math.max(0.4, dampen);
  }

  let life = adjustedBase + heat * params.boost - penalty * params.boost - eff + accumulatedBoost - accumulatedDrain;

  // v3.9: 用户共识连续加成 — 用净信号差驱动
  //   净 like 共识 → 最多 +150 天 × authorBoost
  //   净 report 共识 → 最多 -350 天 (举报永远更"贵")
  //   极端区 (|netStrength| > 0.7): 加非线性放大, 类似但不等于硬阈值
  const netStrength = effectiveLikeStrength - effectiveReportStrength;
  let consensusEffect;
  if (netStrength >= 0) {
    const base = netStrength * 150 * authorBoost;
    // 强 like 区 (>0.7): 平滑加成 +20 到 +60 天
    const extra = netStrength > 0.7 ? Math.pow(netStrength - 0.7, 1.5) * 200 * authorBoost : 0;
    consensusEffect = base + extra;
  } else {
    const base = netStrength * 350; // negative
    // 强 report 区 (<-0.7): 平滑加成 -50 到 -150 天
    const extra = netStrength < -0.7 ? -Math.pow(-netStrength - 0.7, 1.5) * 500 : 0;
    consensusEffect = base + extra;
  }
  life = life + consensusEffect;

  // v3.9 NEW: 短期爆发后死寂模式 — 节日活动/赛事结束后必沉
  //   burst=1 时再扣 200 天
  const burstScore = shortBurstPattern(marker, effNow);
  if (burstScore > 0) {
    life = life - burstScore * 200;
  }

  return life;
}

// ======================================================================
// 曝光率 (跟 v3.3 同, 但用 v34 的 heat / penalty)
// ======================================================================

const REPORT_WEIGHT_V34 = 1.5;

export function exposureRateV34(marker, now, reporterStats = {}) {
  const cumulativeLikes = (marker.likes || []).length;
  const cumulativeReports = (marker.reports || []).length;

  // v3.9: 用户共识连续函数 (与 lifeLeft 一致, 无硬阈值)
  const consensus = consensusStrength(cumulativeLikes, cumulativeReports);
  const recencyScore = recentInteractionScore(marker, now);
  const effectiveLikeStrength = consensus.likeStrength * recencyScore;
  const effectiveReportStrength = consensus.reportStrength * recencyScore;

  // v3.9: 用户共识合并到曝光分数 — 用净强度
  const netStrength = effectiveLikeStrength - effectiveReportStrength;
  const consensusScore = netStrength >= 0
    ? netStrength * 6
    : netStrength * 8;

  const heat = currentHeatV34(marker, now);
  const penalty = reportPenaltyV34(marker, now, reporterStats);
  const score = heat - REPORT_WEIGHT_V34 * penalty + consensusScore;

  if (score >= 5) return 1.0;
  if (score >= 1) return 0.8;
  if (score >= 0) return 0.5;
  if (score >= -2) return 0.2;
  return 0.05;
}

export const MARKER_STATUS_V34 = {
  HEALTHY: 'healthy', BORDERLINE: 'borderline', WEAK: 'weak',
  HEARTBEAT: 'heartbeat', SUNK: 'sunk', ARCHIVED: 'archived',
};

export function markerStatusV34(marker, now, reporterStats = {}) {
  const life = lifeLeftV34(marker, now, reporterStats);
  if (life === -Infinity) return MARKER_STATUS_V34.ARCHIVED;
  if (life <= 0) return MARKER_STATUS_V34.SUNK;
  const exp = exposureRateV34(marker, now, reporterStats);
  if (exp >= 0.8) return MARKER_STATUS_V34.HEALTHY;
  if (exp >= 0.5) return MARKER_STATUS_V34.BORDERLINE;
  if (exp >= 0.2) return MARKER_STATUS_V34.WEAK;
  return MARKER_STATUS_V34.HEARTBEAT;
}

export function shouldRenderV34(marker, now, rng = Math.random, reporterStats = {}) {
  const s = markerStatusV34(marker, now, reporterStats);
  if (s === MARKER_STATUS_V34.ARCHIVED) return false;
  if (s === MARKER_STATUS_V34.SUNK) return false;
  if (s === MARKER_STATUS_V34.HEARTBEAT) return rng() < 0.2;
  return true;
}

// ======================================================================
// Marker 工厂 (加 viewCount 字段)
// ======================================================================

export function createMarkerV34({ id, type, x, y, authorId, tCreate, isDoc = false, authorRole = 'user' }) {
  return {
    id, type, x, y, authorId,
    tCreate: tCreate || 1,
    isDoc,
    authorRole,    // v3.8: 'official' | 'user' | 'commercial_spam'
    likes: [], reports: [],
    viewCount: 0,
  };
}

export function addLikeV34(marker, userId, now) {
  if (marker.likes.find(l => l.userId === userId)) return false;
  marker.likes.push({ userId, t: now });
  return true;
}

export function addReportV34(marker, userId, reason, now) {
  if (marker.reports.find(r => r.userId === userId)) return false;
  marker.reports.push({ userId, reason, t: now });
  return true;
}

// 当 mark 被路过曝光一次, simulator 调用此函数
export function recordView(marker) {
  marker.viewCount = (marker.viewCount || 0) + 1;
}

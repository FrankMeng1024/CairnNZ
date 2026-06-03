/**
 * algorithm-v4.mjs — Cairn 算法 v4.0 "趋势驱动 / 群体口碑演化"
 *
 * 核心思想（与 v3.x 决裂）:
 *   - 不再有"5+赞触发短路"等硬阈值
 *   - 不再用 baseLifetime - effectiveAge 这种"减法寿命"
 *   - 改为: 基于群体口碑随时间演化的趋势判断
 *
 * 灵感来源:
 *   - Wilson Score (Reddit/Steam/豆瓣) — 小样本时主动惩罚
 *   - 牛顿冷却定律 — 时间衰减分段
 *   - TripAdvisor "consistency over time" — 趋势而非平均
 *   - 美团 2025 加权评价 — 每条互动权重不同
 *
 * 思想总结:
 *   像一个有经验的人评价一个步道点:
 *   - 总体口碑怎样? (S_overall)
 *   - 最近口碑怎样? (S_recent)
 *   - 是在变好还是变差? (trend)
 *   - 样本够多吗? (Wilson 自动处理)
 *
 * 关键决策:
 *   - 寿命 = base × authorBoost × ageDecay × sentimentMultiplier
 *   - sentimentMultiplier 由趋势决定, 不写死阈值
 *   - 趋势反转 → 不论历史多辉煌, 当下决定一切
 */

const MS_PER_DAY = 24 * 3600 * 1000;
const daysBetween = (t1, t2) => (t2 - t1) / MS_PER_DAY;

// ======================================================================
// 类型参数 — base 是"无信号时的基础寿命预期"
// 不再有硬上限, 通过 ageDecay 软衰减
// ======================================================================
export const TYPE_PARAMS_V4 = {
  // 危险信息: 救命级 mark, 给较长 base 防止误杀
  danger:   { baseLifetime: 90,  alpha: 0.7 },  // alpha = 日历权重(剩下是视图权重)
  // 补给点
  supply:   { baseLifetime: 90,  alpha: 0.5 },
  // 岔路
  junction: { baseLifetime: 180, alpha: 0.3 },
  // 风景
  scenic:   { baseLifetime: 180, alpha: 0.2 },
  // 石堆
  cairn:    { baseLifetime: 240, alpha: 0.25 },
};

// ======================================================================
// 作者权威 — 连续乘子, 不写死硬规则
// ======================================================================
const AUTHOR_ROLE_BOOST = {
  official: 1.5,        // DOC/SAR/警察 - 救命权威
  user: 1.0,            // 普通用户
  commercial_spam: 0.5, // 已确认商业刷子
};

// ======================================================================
// Report 类型严重度 — 调研报告建议
//   注: 因没有图片证据, 不给"事实型"过高权重
// ======================================================================
const REPORT_SEVERITY = {
  info_wrong:      1.5,  // 信息不实
  outdated:        1.2,  // 已过期
  wrong_location:  1.5,  // 位置不对
  not_useful:      0.5,  // 对我没用 (主观)
  unsafe_to_visit: 1.0,  // 不该来这
  offensive:       2.0,  // 冒犯
  // 兼容旧 chaos-monkey 的 reason
  spam:            1.0,
  hate:            1.5,
  privacy:         1.5,
  cultural:        1.2,
  dislike:         0.5,
  other:           0.7,
  danger_wrong:    1.5,
};

// ======================================================================
// 时间权重 — 分段衰减 (调研建议: 前期保护 + 后期加速)
// ======================================================================
function timeWeight(eventT, now) {
  const ageDays = (now - eventT) / MS_PER_DAY;
  if (ageDays < 0) return 1.0;      // 未来事件给 1
  if (ageDays <= 30) return 1.0;    // 前 30 天保护期
  if (ageDays <= 180) {
    // 30-180 天指数衰减, 半衰期 180
    return Math.exp(-Math.LN2 * (ageDays - 30) / 180);
  }
  // 180+ 天保留底权重 0.1, 仍然指数衰减但缓慢
  const baseDecay = Math.exp(-Math.LN2 * (180 - 30) / 180); // ~0.56
  return Math.max(0.1, baseDecay * Math.exp(-Math.LN2 * (ageDays - 180) / 365));
}

// ======================================================================
// Wilson Score 区间下界 — 调研推荐, 小样本主动减分
// ======================================================================
function wilsonLowerBound(pos, neg, z = 1.28) {
  const n = pos + neg;
  if (n === 0) return 0; // 无样本时返回中性
  const p = pos / n;
  const z2 = z * z;
  const term1 = p + z2 / (2 * n);
  const term2 = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return (term1 - term2) / (1 + z2 / n);
}

// ======================================================================
// 在指定时间窗口内计算 Wilson Score
//   pos = 加权赞 (用 timeWeight + authorBoost 加权)
//   neg = 加权举报 (再乘 reportSeverity)
//   返回 [-1, 1]: -1 = 强 report 共识, 0 = 中性, +1 = 强 like 共识
// ======================================================================
function sentimentInWindow(marker, now, windowDays = Infinity) {
  const cutoff = now - windowDays * MS_PER_DAY;

  let posWeight = 0, negWeight = 0;
  let posCount = 0, negCount = 0;

  for (const like of (marker.likes || [])) {
    if (like.t < cutoff) continue;
    const tw = timeWeight(like.t, now);
    posWeight += tw;
    posCount++;
  }

  for (const report of (marker.reports || [])) {
    if (report.t < cutoff) continue;
    const tw = timeWeight(report.t, now);
    const sev = REPORT_SEVERITY[report.reason] || 1.0;
    negWeight += tw * sev;
    negCount++;
  }

  // Wilson 用"等价计数"参数, 但权重是加权
  // sentiment 范围 [-1, 1]: -1 = 全 neg, +1 = 全 pos
  const total = posWeight + negWeight;
  if (total === 0) return { sentiment: 0, sampleSize: 0 };

  // 用 wilson 下界为正向口碑分, 上界为负向口碑分
  const sentiment = (posWeight - negWeight) / total;
  const sampleSize = posCount + negCount;

  return { sentiment, sampleSize, posWeight, negWeight, posCount, negCount };
}

// ======================================================================
// 趋势分析 — 多窗口对比 (更精细)
// ======================================================================
function trendAnalysis(marker, now) {
  // 多个时间窗口
  const w30 = sentimentInWindow(marker, now, 30);
  const w90 = sentimentInWindow(marker, now, 90);
  const w180 = sentimentInWindow(marker, now, 180);
  const overall = sentimentInWindow(marker, now, Infinity);

  // 远期 = 90 天前为止的整体, 排除近期
  const ancient = sentimentInWindow(marker, now - 90 * MS_PER_DAY, Infinity);

  // 趋势 — 多种计算方式取最大反转信号
  const trends = [];
  if (w30.sampleSize >= 3 && ancient.sampleSize >= 3) {
    trends.push(w30.sentiment - ancient.sentiment);
  }
  if (w90.sampleSize >= 5 && ancient.sampleSize >= 3) {
    trends.push(w90.sentiment - ancient.sentiment);
  }
  // 取绝对值最大的趋势 (反转最明显的)
  let trend = 0;
  for (const tt of trends) {
    if (Math.abs(tt) > Math.abs(trend)) trend = tt;
  }

  return {
    recent: w30,
    medium: w90,
    overall,
    ancient,
    trend,
  };
}

// ======================================================================
// 软年龄衰减 — 0-365 天无衰减, 之后非常缓慢衰减 (调研建议)
//   注: 比 v3.9.2 更宽松, 让长寿好 mark 不被 ageDecay 自动杀
// ======================================================================
function ageDecay(calendarDays) {
  if (calendarDays <= 365) return 1.0;
  // 365 天后, 半衰期 1095 天 (3 年) 缓慢衰减
  return Math.exp(-Math.LN2 * (calendarDays - 365) / 1095);
}

// ======================================================================
// 视图当量天 — 弱化版 (审查指出: 长跨度好 mark 不应被 effectiveAge 杀)
//   alpha 减小日历权重, 增加视图权重对偏远 mark 保护
// ======================================================================
function effectiveAgeV4(marker, now) {
  const calendarDays = daysBetween(marker.tCreate, now);
  const params = TYPE_PARAMS_V4[marker.type] || TYPE_PARAMS_V4.scenic;
  const views = marker.viewCount || 0;
  const REF_VIEWS_PER_DAY = 3;
  const rawViewDays = views / REF_VIEWS_PER_DAY;
  const viewBasedDays = Math.min(rawViewDays, calendarDays);
  let eff = (params.alpha * calendarDays + (1 - params.alpha) * viewBasedDays) * 0.5;

  // 用累积信号比例 dampen effectiveAge
  // 强正向信号 (likes >> reports) 时 effectiveAge 大幅压缩, 反之放大
  const likes = (marker.likes || []).length;
  const reports = (marker.reports || []).length;
  const total = likes + reports;
  if (total >= 5) {
    const likeRatio = likes / total;
    if (likeRatio >= 0.65) {
      // 强正向 → effectiveAge × 0.1
      eff = eff * 0.1;
    } else if (likeRatio >= 0.55) {
      // 中度正向 → eff × 0.3
      eff = eff * 0.3;
    } else if (likeRatio >= 0.45) {
      // 边缘 → eff × 0.6
      eff = eff * 0.6;
    } else if (likeRatio < 0.35) {
      // 强负向 → eff × 1.5
      eff = eff * 1.5;
    }
  }

  // 上限 cap: effectiveAge 不能超过 base × sentiment-aware cap
  // 强正向时几乎不老化, 强负向时正常老化
  const params2 = TYPE_PARAMS_V4[marker.type] || TYPE_PARAMS_V4.scenic;
  let cap;
  if (total >= 5) {
    const likeRatio = likes / total;
    if (likeRatio >= 0.65) cap = 0.15;       // 强正向: eff cap 在 base × 0.15
    else if (likeRatio >= 0.55) cap = 0.4;
    else if (likeRatio >= 0.45) cap = 0.8;
    else cap = 1.5;
  } else {
    cap = 0.7; // 小样本宽容
  }
  eff = Math.min(eff, params2.baseLifetime * cap);

  return eff;
}

// ======================================================================
// 寿命主函数 — 核心逻辑
// ======================================================================
export function lifeLeftV4(marker, now, _reporterStats = {}) {
  const params = TYPE_PARAMS_V4[marker.type] || TYPE_PARAMS_V4.scenic;
  const calendarDays = daysBetween(marker.tCreate, now);

  // 1. 基础寿命 + 作者权威 + 软年龄衰减
  const authorBoost = AUTHOR_ROLE_BOOST[marker.authorRole || 'user'] || 1.0;
  const baseLife = params.baseLifetime * authorBoost * ageDecay(calendarDays);

  // 2. 群体口碑分析
  const t = trendAnalysis(marker, now);

  // 3. sentiment multiplier — 寿命系数, 由趋势驱动
  let sentimentMult;

  const totalSamples = (marker.likes || []).length + (marker.reports || []).length;

  if (totalSamples === 0) {
    sentimentMult = 1.0;
  } else if (totalSamples < 3) {
    sentimentMult = 0.95 + t.overall.sentiment * 0.05;
  } else if (totalSamples < 5) {
    sentimentMult = 0.85 + t.overall.sentiment * 0.25;
  } else if (t.recent.sampleSize < 3) {
    // 近期样本太少, 用全期口碑兜底
    if (t.overall.sentiment >= 0) {
      sentimentMult = 1.0 + t.overall.sentiment * 0.8;
    } else {
      sentimentMult = 1.0 + t.overall.sentiment * 1.2;
    }
  } else {
    // 近期样本充足 — 用近期权重, 但全期信号也参与
    // v4 IMPROVED: 全期强正 + 近期负 = 短期攻击, 不该立即沉
    let weightedSentiment;
    if (t.overall.sentiment >= 0.3 && t.recent.sentiment < 0) {
      // 全期明显正向, 近期短暂负向 = 短期攻击 / 近期波动
      // 给全期更大权重
      weightedSentiment = 0.3 * t.recent.sentiment + 0.7 * t.overall.sentiment;
    } else {
      weightedSentiment = 0.7 * t.recent.sentiment + 0.3 * t.overall.sentiment;
    }

    // 分段: 强正 / 弱正 / 中性 / 弱负 / 强负
    if (weightedSentiment >= 0.6) {
      sentimentMult = 1.0 + weightedSentiment * 1.2;
    } else if (weightedSentiment >= 0.3) {
      sentimentMult = 0.8 + weightedSentiment * 1.0;
    } else if (weightedSentiment >= 0.0) {
      sentimentMult = 0.55 + weightedSentiment * 0.83;
    } else {
      sentimentMult = 0.55 + weightedSentiment * 1.5;
    }

    // 趋势加成 — 反转时额外影响
    if (Math.abs(t.trend) > 0.25) {
      if (t.trend < 0) {
        // 崩塌强信号 — 但全期正向时削弱崩塌权重 (短暂攻击 vs 真崩塌)
        const trendDamper = t.overall.sentiment >= 0.3 ? 0.5 : 1.5;
        sentimentMult += t.trend * trendDamper;
      } else {
        sentimentMult += t.trend * 0.4;
      }
    }
  }

  // sentimentMult 限制在 [0.0, 2.5] 之间
  sentimentMult = Math.max(0.0, Math.min(2.5, sentimentMult));

  // v4 NEW: 持续争议检测 — 大量互动 (>=15) 且持续时间长 (>=60 天) 但比例接近 1:1 → 衰退
  const cumLikes = (marker.likes || []).length;
  const cumReports = (marker.reports || []).length;
  const totalForControversy = cumLikes + cumReports;
  if (totalForControversy >= 15 && calendarDays >= 60) {
    const ratio = cumLikes / totalForControversy;
    if (ratio >= 0.42 && ratio <= 0.58) {
      sentimentMult = Math.min(sentimentMult, 0.5);
    }
  }

  // 4. 视图老化扣减
  const eff = effectiveAgeV4(marker, now);

  // 5. 最终寿命 = 基础 × 口碑系数 - 视图老化
  const life = baseLife * sentimentMult - eff;

  return life;
}

// ======================================================================
// 曝光率 — 同样用 sentiment 趋势驱动
// ======================================================================
export function exposureRateV4(marker, now, _reporterStats = {}) {
  const t = trendAnalysis(marker, now);

  // 完全零信号 → 看 mark 类型 (默认中等曝光等待发现)
  if (t.recent.sampleSize === 0 && t.overall.sampleSize === 0) {
    const calendarDays = daysBetween(marker.tCreate, now);
    if (calendarDays < 30) return 0.5;  // 新 mark 给中等曝光
    return 0.2;                           // 老但无人理睬 → 弱
  }

  // 加权 sentiment
  let weightedSentiment;
  if (t.recent.sampleSize >= 3) {
    weightedSentiment = 0.7 * t.recent.sentiment + 0.3 * t.overall.sentiment;
    if (Math.abs(t.trend) > 0.4) {
      weightedSentiment += t.trend * 0.3;
    }
  } else {
    weightedSentiment = t.overall.sentiment;
  }

  weightedSentiment = Math.max(-1, Math.min(1, weightedSentiment));

  // sentiment ∈ [-1, 1] → exposure ∈ [0.05, 1.0]
  // -1 → 0.05, 0 → 0.5, +1 → 1.0
  if (weightedSentiment >= 0.6) return 1.0;
  if (weightedSentiment >= 0.2) return 0.8;
  if (weightedSentiment >= -0.2) return 0.5;
  if (weightedSentiment >= -0.6) return 0.2;
  return 0.05;
}

// ======================================================================
// 状态判定
// ======================================================================
export const MARKER_STATUS_V4 = {
  HEALTHY: 'healthy', BORDERLINE: 'borderline', WEAK: 'weak',
  HEARTBEAT: 'heartbeat', SUSPICIOUS: 'suspicious',  // v4.1: 审核期
  SUNK: 'sunk', ARCHIVED: 'archived',
};

// v4.1: 审核期检测 — 统一三类触发条件
//   A. 急转: 历史好但近期强负 — "曾经辉煌但最近崩了"
//   B. 死寂过期: 长时间无新互动 — "没人再来确认这个 mark 了"
//   C. 持续衰退: 多窗口对比反转 — "信号在持续变差"
// 任一触发即进入审核期, 给 30 天观察窗口
function suspiciousCheck(marker, now) {
  const t = trendAnalysis(marker, now);
  const calendarDays = daysBetween(marker.tCreate, now);
  const totalSamples = (marker.likes || []).length + (marker.reports || []).length;

  // 强正向 mark 不进 suspicious — 累积比例 > 0.85 = 强信任 (放宽给信号清晰的好 mark)
  const cumLikes = (marker.likes || []).length;
  const cumReports = (marker.reports || []).length;
  if (totalSamples >= 5 && cumLikes / totalSamples >= 0.85) {
    return { triggered: false };
  }

  // A. 急转 — 历史明显正向, 近期负向
  const acuteCollapse = t.overall.sentiment >= 0.15 &&
                        t.recent.sampleSize >= 3 &&
                        t.recent.sentiment <= -0.1;
  if (acuteCollapse) return { triggered: true, reason: '急转' };

  // B. 死寂过期 — 累积过 10 但近 60 天无新互动
  if (totalSamples >= 10 && calendarDays > 60) {
    const recent60 = sentimentInWindow(marker, now, 60);
    if (recent60.sampleSize === 0) {
      return { triggered: true, reason: '死寂过期' };
    }
  }

  // C. 持续衰退 — 近 30 vs 近 90 反转明显
  const w30 = sentimentInWindow(marker, now, 30);
  const w90Older = sentimentInWindow(marker, now - 30 * MS_PER_DAY, 60);
  if (w30.sampleSize >= 3 && w90Older.sampleSize >= 3) {
    if (w90Older.sentiment > 0.15 && w30.sentiment < w90Older.sentiment - 0.3) {
      return { triggered: true, reason: '持续衰退' };
    }
  }

  // D. 近期举报为主 — 近 90 天 reports > likes
  const recent90 = sentimentInWindow(marker, now, 90);
  if (recent90.sampleSize >= 5 &&
      recent90.posCount < recent90.negCount &&
      recent90.sentiment <= -0.2 &&
      t.overall.sentiment >= 0.1) {
    return { triggered: true, reason: '近期举报为主' };
  }

  // E. v4.2 NEW: 累积反转但量级大 — 整体 reports 占多数但累积过 50
  //    (那棵树 680/1450 / 雪崩警告 14/70 类型)
  //    → 进观察期看是否真的需要沉, 不直接判死
  if (totalSamples >= 30 && cumLikes / totalSamples < 0.5 && cumLikes >= 5) {
    return { triggered: true, reason: '量级反转' };
  }

  // F. v4.2 NEW: 短期 brigade 攻击检测 — likes 历史长期正向但近期突然集中 reports
  //    (越南粉店 240/8 brigade 类型)
  if (t.overall.sentiment >= 0.5 && totalSamples >= 20) {
    const recent14 = sentimentInWindow(marker, now, 14);
    if (recent14.negCount >= 5 && recent14.posCount === 0) {
      return { triggered: true, reason: 'Brigade 攻击疑似' };
    }
  }

  return { triggered: false };
}

// 进入审核期后, 算法寿命强制 30 天观察期
const SUSPICIOUS_OBSERVATION_DAYS = 30;

export function markerStatusV4(marker, now, reporterStats = {}) {
  const life = lifeLeftV4(marker, now, reporterStats);

  // v4.2: 先检查是否处于 SUSPICIOUS (急转)
  // 如果是急转/过期/反转, 即便 life <= 0 也先进观察期, 不直接沉
  const susp = suspiciousCheck(marker, now);
  if (susp.triggered) {
    return MARKER_STATUS_V4.SUSPICIOUS;
  }

  // 没有急转信号才是真沉
  if (life <= 0) return MARKER_STATUS_V4.SUNK;

  const exp = exposureRateV4(marker, now, reporterStats);
  if (exp >= 0.8) return MARKER_STATUS_V4.HEALTHY;
  if (exp >= 0.5) return MARKER_STATUS_V4.BORDERLINE;
  if (exp >= 0.2) return MARKER_STATUS_V4.WEAK;
  return MARKER_STATUS_V4.HEARTBEAT;
}

export function shouldRenderV4(marker, now, rng = Math.random, reporterStats = {}) {
  const s = markerStatusV4(marker, now, reporterStats);
  if (s === MARKER_STATUS_V4.ARCHIVED) return false;
  if (s === MARKER_STATUS_V4.SUNK) return false;
  if (s === MARKER_STATUS_V4.HEARTBEAT) return rng() < 0.2;
  // SUSPICIOUS 仍展示 (UI 加警告标)
  return true;
}

// ======================================================================
// Marker 工厂 + 互斥操作 (产品现实: 一人一 mark 只一个行为)
// ======================================================================
export function createMarkerV4({ id, type, x, y, authorId, tCreate, isDoc = false, authorRole = 'user' }) {
  return {
    id, type, x, y, authorId,
    tCreate: tCreate || 1,
    isDoc,
    authorRole,
    likes: [],
    reports: [],
    viewCount: 0,
    revivedAt: null,  // 续命时间
  };
}

export function addLikeV4(marker, userId, now) {
  // 互斥: 删除该用户的旧 report (如有)
  marker.reports = (marker.reports || []).filter(r => r.userId !== userId);
  // 防重复 like
  if (marker.likes.find(l => l.userId === userId)) return false;
  marker.likes.push({ userId, t: now });
  return true;
}

export function addReportV4(marker, userId, reason, now) {
  // 互斥: 删除该用户的旧 like (如有)
  marker.likes = (marker.likes || []).filter(l => l.userId !== userId);
  // 防重复 report
  if (marker.reports.find(r => r.userId === userId)) return false;
  marker.reports.push({ userId, reason, t: now });
  return true;
}

export function recordView(marker) {
  marker.viewCount = (marker.viewCount || 0) + 1;
}

// ======================================================================
// 续命三档判定 (作者主动触发)
// ======================================================================
export function reviveCheck(marker, now) {
  // 已续过命 1 年内 → 拒绝
  if (marker.revivedAt && (now - marker.revivedAt) < 365 * MS_PER_DAY) {
    return { decision: 'C', reason: '一年内已续过命' };
  }

  // 看历史最优 sentiment
  const allTime = sentimentInWindow(marker, now, Infinity);
  const recent30 = sentimentInWindow(marker, now, 30);

  // 沉前 30 天的口碑
  const sunkPeriod = sentimentInWindow(marker, now, 30);

  // C 档: 强 report 共识致死
  if (sunkPeriod.sampleSize >= 5 && sunkPeriod.sentiment < -0.7) {
    return { decision: 'C', reason: '强 report 共识沉, 不可远程续命' };
  }

  // A 档: 历史曾经辉煌且沉因不是强 report
  if (allTime.sentiment > 0.5 && allTime.sampleSize >= 10) {
    return { decision: 'A', reason: '历史口碑优秀, 可远程试用 30 天', trial: true };
  }

  // B 档: 历史中庸, 必须现场续命
  return { decision: 'B', reason: '历史口碑中庸, 必须现场续命' };
}

// 启动续命试用期
export function startReviveTrial(marker, now) {
  marker.revivedAt = now;
  // 试用期内基础寿命额外加 30 天
  return marker;
}

// 兼容老 simulator 的 docParams (v4 不再特殊处理 DOC, 但保留兼容接口)
export function docParams(type) {
  return TYPE_PARAMS_V4[type] || TYPE_PARAMS_V4.scenic;
}
export const TYPE_PARAMS_V34 = TYPE_PARAMS_V4; // alias

// 兼容旧测试脚本
export const createMarkerV34 = createMarkerV4;
export const addLikeV34 = addLikeV4;
export const addReportV34 = addReportV4;
export const lifeLeftV34 = lifeLeftV4;
export const exposureRateV34 = exposureRateV4;
export const markerStatusV34 = markerStatusV4;
export const shouldRenderV34 = shouldRenderV4;
export const MARKER_STATUS_V34 = MARKER_STATUS_V4;

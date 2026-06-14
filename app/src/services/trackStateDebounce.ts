/**
 * Track state debounce — R2.7 pure logic.
 *
 * 抽到独立模块让 ARScreen.tsx useEffect 真调,jest 也真测。
 * 反 self-licking: 测试代码跟生产代码同一个函数。
 *
 * 规则:
 * - upgrade to 'tracking' → 立即应用 (但若累计 limited > 200ms,先强制 'limited' 一次)
 * - 'none' (camera 完全失明) → 立即应用,不 debounce
 * - downgrade to 'limited' → 200ms 滞后
 * - same-value → no-op
 */

export type TrackState = 'tracking' | 'limited' | 'none';

export interface TrackDebounceState {
  applied: TrackState;
  limitedAccumMs: number;
  limitedSinceMs: number | null;
  /** Whether a 200ms downgrade timer is currently pending */
  downgradePending: boolean;
}

export const HARD_CAP_MS = 200;
export const DOWNGRADE_DELAY_MS = 200;

export function initialTrackDebounceState(initial: TrackState = 'limited'): TrackDebounceState {
  return {
    applied: initial,
    limitedAccumMs: 0,
    limitedSinceMs: null,
    downgradePending: false,
  };
}

/**
 * 处理新到来的 track event。
 * @param state 当前 debounce 状态
 * @param event 新事件 ({ track, t: 时间戳 ms })
 * @returns 新 state + 是否应该 schedule 一个 200ms 后的 timer (caller 用 setTimeout)
 */
export function onTrackEvent(
  state: TrackDebounceState,
  event: { track: TrackState; t: number },
): { state: TrackDebounceState; scheduleDowngradeAt: number | null } {
  const { track, t } = event;

  // same-value: no-op (sub#A 修订 — 防 same-value re-render 反复 cancel-then-rearm)
  if (track === state.applied) {
    return { state, scheduleDowngradeAt: null };
  }

  // 'none' = camera fully blind, never debounce — apply immediately (sub#A 修订)
  if (track === 'none') {
    return {
      state: {
        applied: 'none',
        limitedAccumMs: 0,
        limitedSinceMs: null,
        downgradePending: false,
      },
      scheduleDowngradeAt: null,
    };
  }

  if (track === 'tracking') {
    // 关闭 limited window
    let accum = state.limitedAccumMs;
    if (state.limitedSinceMs != null) {
      accum += t - state.limitedSinceMs;
    }
    // hard cap: 累计 limited 超 HARD_CAP_MS,先强制 'limited' 一次
    if (accum >= HARD_CAP_MS) {
      return {
        state: {
          applied: 'limited',
          limitedAccumMs: 0,
          limitedSinceMs: null,
          downgradePending: false,
        },
        scheduleDowngradeAt: null,
      };
    }
    // 普通 upgrade
    return {
      state: {
        applied: 'tracking',
        limitedAccumMs: accum,
        limitedSinceMs: null,
        downgradePending: false,
      },
      scheduleDowngradeAt: null,
    };
  }

  // track === 'limited' — schedule 200ms 后 downgrade,仅当当前没有 pending timer (sub#B 修订)
  // 不再 cancel-then-rearm
  let limitedSince = state.limitedSinceMs ?? t;
  if (state.downgradePending) {
    return {
      state: { ...state, limitedSinceMs: limitedSince },
      scheduleDowngradeAt: null,  // 已有 timer 在跑
    };
  }
  return {
    state: {
      ...state,
      limitedSinceMs: limitedSince,
      downgradePending: true,
    },
    scheduleDowngradeAt: t + DOWNGRADE_DELAY_MS,
  };
}

/**
 * Timer fire callback — 200ms 滞后到了,真应用 'limited'。
 */
export function onDowngradeTimerFire(
  state: TrackDebounceState,
  t: number,
): TrackDebounceState {
  let accum = state.limitedAccumMs;
  if (state.limitedSinceMs != null) {
    accum += t - state.limitedSinceMs;
  }
  return {
    applied: 'limited',
    limitedAccumMs: accum,
    limitedSinceMs: null,
    downgradePending: false,
  };
}

/**
 * 累积 limited 窗口的 reset (在稳定 tracking 一段时间后调)。
 */
export function resetLimitedAccum(state: TrackDebounceState): TrackDebounceState {
  return { ...state, limitedAccumMs: 0 };
}

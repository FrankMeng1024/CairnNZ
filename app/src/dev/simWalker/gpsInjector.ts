/**
 * sim-walker gpsInjector — v441 free-walk, dev-controllable speed
 *
 * v441 changes vs v438:
 *   - Single "walk speed" mode, tunable at runtime via setStepConfig()
 *   - Default: 5 m per emit, 1000 ms between emits → 5 m/s ≈ jog pace
 *     (real-user distanceInterval=5m matched; emit rate 3x faster than
 *     real GPS's 3s cadence so testing feels responsive)
 *   - undoSteps also rewinds the tracking store so the visible track
 *     pulls back too (was: rewinds only internal cursor)
 *   - History size grew to 50 to support larger undo counts
 *
 * Every code path logged (feedback_100pct_log_coverage).
 */

import { useTrackingStore } from '../../store/useTrackingStore';
import { log } from '../../services/appLog';

export interface StepConfig {
  step_m: number;         // metres advanced per emit
  emit_ms: number;        // milliseconds between emits
  undo_count: number;     // how many steps ↺ button rewinds
}

export const DEFAULT_STEP_CONFIG: StepConfig = {
  // O1 batch 28.6: 用户拍板 "屏幕视觉快 + GPS 数据像真人走"。
  // 屏幕每 tick 跳 50m,tick 间隔 200ms → 视觉 250m/s (远快过真步速)。
  // 每 tick 时把 50m 分段插值为 50 个 GPS 点 (每点 1m,每点 ts 累加 1s
  // = 真人 1m/s 步速),存到 store 时是真实 walking pace 的数据。
  // 用户目的: 测试向,一个人跑不了那么多地方,要数据像真的。
  step_m: 50,
  emit_ms: 200,
  undo_count: 10,
};

// O1 batch 28.6: 每步插值参数。真人步速 = 1.4m/s,插值每 1m 一个 GPS
// 点,每点 ts +714ms (1000/1.4)。为简化,每点 ts 差用 1000ms,GPS 密度
// 每秒 1 点 = 真机手机默认 GPS 采样率。
const WALKING_STEP_M = 1;           // 每插值点间距 (真实 GPS 密度)
const WALKING_STEP_MS = 1000;       // 每插值点时间差 (~1m/s 步速)

export interface InjectorSnapshot {
  active: boolean;
  currentPos: { lat: number; lng: number } | null;
  bearingDeg: number;
  strength: number;
  ticksEmitted: number;
  historyLen: number;
  stepM: number;
  emitMs: number;
  undoCount: number;
}

export type InjectorListener = (snapshot: InjectorSnapshot) => void;

const EARTH_R_M = 6_378_137;
// O1: 5m 一 sigma = 真机 GPS 水平精度 std,把 sim 数据的抖动结构做得更
// 像真 GPS(之前 2m 太干净),数据入库后 snap-to-road / Kalman 后处理
// 行为跟真机采集数据一致。
const JITTER_M_1_SIGMA = 5;
const HISTORY_SIZE = 50;

function boxMuller(): number {
  const u = Math.max(1e-9, Math.random());
  const v = Math.max(1e-9, Math.random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function moveByBearing(
  lat: number,
  lng: number,
  bearingRad: number,
  distanceM: number,
): { lat: number; lng: number } {
  const dLat = (distanceM * Math.cos(bearingRad)) / EARTH_R_M;
  const dLng = (distanceM * Math.sin(bearingRad)) / (EARTH_R_M * Math.cos((lat * Math.PI) / 180));
  return {
    lat: lat + (dLat * 180) / Math.PI,
    lng: lng + (dLng * 180) / Math.PI,
  };
}

class GpsInjector {
  private currentPos: { lat: number; lng: number } | null = null;
  private bearingRad = 0;
  private strength = 0;
  private ticksEmitted = 0;
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<InjectorListener>();
  private posHistory: Array<{ lat: number; lng: number }> = [];
  private config: StepConfig = { ...DEFAULT_STEP_CONFIG };
  // O1 batch 28.6: 模拟时间累加器。每次 subdivide 插值一个 walking step
  // 就 +WALKING_STEP_MS。存到 store 时 rawPoint.t 用此值 (不是 Date.now)。
  // start() / setStartPosition() 时初始化为 useTrackingStore.startedAt (若
  // 无则 Date.now())。undo 时回退到 trackPoints 尾部 t + WALKING_STEP_MS。
  private simTimeCursor: number | null = null;

  setStartPosition(lat: number, lng: number): void {
    log('v441.simwalker.set_start', {
      new_lat: Number(lat.toFixed(6)),
      new_lng: Number(lng.toFixed(6)),
      history_cleared: this.posHistory.length,
    });
    this.currentPos = { lat, lng };
    this.posHistory = [];
    // O1 batch 28.6: ⟲ 是 pre-hike 用的 (用户明确 2026-07-25),此时
    // simTimeCursor 应重置到 useTrackingStore.startedAt (或 Date.now
    // 若 hike 未 start)。避免带上一次 hike 残余的模拟时间。
    try {
      const st: any = useTrackingStore.getState();
      this.simTimeCursor = st.startedAt ?? Date.now();
    } catch {
      this.simTimeCursor = Date.now();
    }
    // v450: no segmentBreak on ⟲ — user confirmed 2026-07-25 "定位是开始
    // 用的,不会在走一半时用". Since ⟲ is only tapped before hike starts
    // (or right at the first step), there is never an old polyline that
    // needs breaking away from. Drop the discontinuity flag entirely.
    // Also don't force distanceM=0 on next tick — the very first tick's
    // addedDistance is naturally 0 since lastCoordinate matches the new
    // anchor we just wrote.
    // v450: write lastCoordinate unconditionally so the puck jumps to
    // the new anchor immediately, regardless of hike status. User's ⟲
    // is only pressed pre-start, so there's no teleport-gate concern.
    // (v449's status check made ⟲ silently ineffective when status='idle',
    //  which is exactly when the user uses it.)
    try {
      useTrackingStore.setState((s: any) => ({
        ...s,
        lastCoordinate: { lat, lng, alt: null, accuracy: 5, speed: 0 },
        lastCoordinateTime: this.simTimeCursor ?? Date.now(),
      }));
    } catch { /* ignore */ }
    this.notify();
  }

  setJoystick(bearingRad: number, strength: number): void {
    if (Number.isNaN(bearingRad) || Number.isNaN(strength)) {
      log('v441.simwalker.joystick_nan', {});
      return;
    }
    this.bearingRad = bearingRad;
    this.strength = Math.max(0, Math.min(1, strength));
  }

  releaseJoystick(): void {
    log('v441.simwalker.joystick_release', { was_strength: Number(this.strength.toFixed(2)) });
    this.strength = 0;
  }

  setStepConfig(cfg: Partial<StepConfig>): void {
    const next = { ...this.config, ...cfg };
    // Clamp to safe bounds
    next.step_m = Math.max(0.5, Math.min(100, next.step_m));
    next.emit_ms = Math.max(200, Math.min(5000, next.emit_ms));
    next.undo_count = Math.max(1, Math.min(50, Math.round(next.undo_count)));
    const prev = this.config;
    this.config = next;
    log('v441.simwalker.set_step_config', {
      prev,
      applied: next,
    });
    // Restart tick loop if running so new emit_ms takes effect
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = setInterval(() => this.tick(), this.config.emit_ms);
    }
    this.notify();
  }

  getConfig(): StepConfig {
    return { ...this.config };
  }

  /**
   * Rewind currentPos + tracking store track by config.undo_count points.
   */
  undoSteps(): void {
    const n = this.config.undo_count;
    if (n <= 0 || this.posHistory.length === 0) {
      log('v441.simwalker.undo_nop', {
        requested: n,
        history_len: this.posHistory.length,
      });
      return;
    }
    const take = Math.min(n, this.posHistory.length);
    let restored: { lat: number; lng: number } | null = null;
    for (let i = 0; i < take; i++) {
      restored = this.posHistory.pop() ?? null;
    }
    if (restored) this.currentPos = restored;
    // v450: no segmentBreak on undo — user confirmed 2026-07-25 undo
    // should visually pick up from where the trail was rewound to
    // (which IS the restored point). Since undoSteps also trims the
    // tracking store's trackPoints (via __simwalkerRemoveLastN), the
    // polyline naturally resumes from the trimmed tail; no explicit
    // break needed.

    // Also rewind the tracking store so the visible track pulls back.
    let storeRemoved = 0;
    try {
      const st = useTrackingStore.getState() as any;
      if (typeof st.__simwalkerRemoveLastN === 'function') {
        storeRemoved = st.__simwalkerRemoveLastN(take);
      } else {
        // Fallback: directly slice arrays if API not exposed. Safe because
        // sim-walker is a dev tool; production builds don't ship this file.
        useTrackingStore.setState((state: any) => {
          const trim = (arr: any[]) => arr.slice(0, Math.max(0, arr.length - take));
          return {
            trackPoints: trim(state.trackPoints || []),
            trackPointsSmoothed: trim(state.trackPointsSmoothed || []),
            trackPointsRaw: trim(state.trackPointsRaw || []),
          };
        });
        storeRemoved = take;
      }
      // O1 batch 28.6: undo 后 simTimeCursor 回退到剩余 trackPoints 尾部,
      // 避免新点 ts 跳跃出现 gap。
      const finalPts = (useTrackingStore.getState() as any).trackPoints;
      if (Array.isArray(finalPts) && finalPts.length > 0) {
        const lastT = finalPts[finalPts.length - 1]?.t;
        if (typeof lastT === 'number' && Number.isFinite(lastT)) {
          this.simTimeCursor = lastT;
        }
      }
    } catch (err) {
      log('v441.simwalker.undo_store_err', { err: String(err) });
    }

    log('v441.simwalker.undo', {
      requested: n,
      taken: take,
      store_removed: storeRemoved,
      history_remaining: this.posHistory.length,
      new_lat: restored ? Number(restored.lat.toFixed(6)) : null,
      new_lng: restored ? Number(restored.lng.toFixed(6)) : null,
    });
    this.notify();
  }

  start(): void {
    if (this.tickHandle) {
      log('v441.simwalker.start_already_active', {});
      return;
    }
    // O1 batch 28.6: 每次 start 重置 simTimeCursor,避免上一次 hike
    // 残余的模拟时间被继承。
    try {
      const st: any = useTrackingStore.getState();
      this.simTimeCursor = st.startedAt ?? Date.now();
    } catch {
      this.simTimeCursor = Date.now();
    }
    log('v441.simwalker.start', { config: this.config, sim_ts_init: this.simTimeCursor });
    this.tickHandle = setInterval(() => this.tick(), this.config.emit_ms);
  }

  stop(): void {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
      log('v441.simwalker.stop', { ticks_emitted: this.ticksEmitted });
    }
    this.strength = 0;
    // O1 batch 28.6: 清 simTimeCursor,下次 start 重新初始化。
    this.simTimeCursor = null;
  }

  getSnapshot(): InjectorSnapshot {
    return {
      active: this.tickHandle !== null,
      currentPos: this.currentPos,
      bearingDeg: (this.bearingRad * 180) / Math.PI,
      strength: this.strength,
      ticksEmitted: this.ticksEmitted,
      historyLen: this.posHistory.length,
      stepM: this.config.step_m,
      emitMs: this.config.emit_ms,
      undoCount: this.config.undo_count,
    };
  }

  subscribe(fn: InjectorListener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private notify(): void {
    const snap = this.getSnapshot();
    this.listeners.forEach((fn) => {
      try { fn(snap); } catch (err) {
        log('v441.simwalker.listener_err', { err: String(err) });
      }
    });
  }

  private tick(): void {
    // v445 diagnostic: log every tick regardless. If we see many
    // v445.simwalker.tick_enter but few tick_emit, we know tick loop
    // is alive but strength=0 (joystick released) most of the time.
    log('v445.simwalker.tick_enter', {
      hasPos: !!this.currentPos,
      strength: Number(this.strength.toFixed(2)),
      config: this.config,
    });
    if (!this.currentPos) return;
    if (this.strength <= 0) {
      this.notify();
      return;
    }
    // O1 batch 28.6: 屏幕视觉先前进 step_m * strength 米。
    const stepM = this.config.step_m * this.strength;
    const nextScreenPos = moveByBearing(this.currentPos.lat, this.currentPos.lng, this.bearingRad, stepM);
    const startPos = this.currentPos;
    this.currentPos = nextScreenPos;

    // Save history for undo (screen pos, 用于 ⟲/↶ 恢复)
    this.posHistory.push({ lat: nextScreenPos.lat, lng: nextScreenPos.lng });
    if (this.posHistory.length > HISTORY_SIZE) this.posHistory.shift();

    // O1 batch 28.6: 把 startPos → nextScreenPos 这段 (stepM 米) 分成
    // walking pace 的子步子: 每 WALKING_STEP_M=1 米一个 GPS 点。这样存
    // 到 store 里的 GPS 密度是真人手机默认采样 (~1 点/秒),而屏幕视觉
    // 每 tick 跳 stepM 米。
    const subdivideCount = Math.max(1, Math.floor(stepM / WALKING_STEP_M));
    // 初始化 simTimeCursor (若 start() 时未初始化)。
    if (this.simTimeCursor === null) {
      try {
        const st: any = useTrackingStore.getState();
        this.simTimeCursor = st.startedAt ?? Date.now();
      } catch {
        this.simTimeCursor = Date.now();
      }
    }

    this.ticksEmitted += 1;
    const accuracy = 5 + Math.random() * 10;
    const speedMs = WALKING_STEP_M / (WALKING_STEP_MS / 1000); // 1 m/s

    log('v441.simwalker.tick_emit', {
      idx: this.ticksEmitted,
      step_m: Number(stepM.toFixed(2)),
      subdivide: subdivideCount,
      sim_ts_start: this.simTimeCursor,
      strength: Number(this.strength.toFixed(2)),
      bearing_deg: Number(((this.bearingRad * 180) / Math.PI).toFixed(1)),
      history_len: this.posHistory.length,
    });

    // 每个 subdivide 点插值 + emit
    for (let i = 1; i <= subdivideCount; i++) {
      const frac = i / subdivideCount;
      const interpLat = startPos.lat + (nextScreenPos.lat - startPos.lat) * frac;
      const interpLng = startPos.lng + (nextScreenPos.lng - startPos.lng) * frac;
      // 每点单独 jitter,不共享 (让 GPS 抖动看起来独立)
      const jitterMag = Math.abs(boxMuller()) * JITTER_M_1_SIGMA;
      const jitterBearing = Math.random() * 2 * Math.PI;
      const jittered = moveByBearing(interpLat, interpLng, jitterBearing, jitterMag);
      // simTimeCursor 前面已初始化为 non-null (line 289-296 fallback)。
      this.simTimeCursor = (this.simTimeCursor ?? Date.now()) + WALKING_STEP_MS;
      this.emit(jittered.lat, jittered.lng, speedMs, accuracy, this.simTimeCursor);
    }
    this.notify();
  }

  private emit(lat: number, lng: number, speedMs: number, accuracy: number, ts: number): void {
    // v450: segmentBreak removed. sim-walker points now write to store
    // without any discontinuity flag; polyline splitter treats them
    // exactly like real GPS. ⟲/↶ scenarios don't need visual breaks
    // per user 2026-07-25 clarification.
    // O1: alt 从 null 改为合理默认值 (取 lastCoordinate.alt fallback 100m
    // +/- 5m 随机漂移),让 sim 数据长得像真 GPS,不然 altitudeHistory 全 null,
    // elevationGainM 永远 0 → hike detail 显示 "0m elevation" 明显不真。
    const st0 = useTrackingStore.getState() as any;
    const baseAlt = (st0.lastCoordinate && typeof st0.lastCoordinate.alt === 'number')
      ? st0.lastCoordinate.alt
      : 100;
    const alt = baseAlt + (Math.random() - 0.5) * 10; // ±5m 漂移
    let path = 'unknown';
    let threw = false;
    try {
      const st = useTrackingStore.getState() as any;
      if (typeof st.__simwalkerAddTrackPoint === 'function') {
        st.__simwalkerAddTrackPoint(
          { lat, lng, alt, accuracy, speed: speedMs },
          ts,
        );
        path = 'dev_api';
      } else {
        useTrackingStore.setState((s: any) => {
          const p = { lat, lng, alt, accuracy, speed: speedMs, t: Date.now() };
          return {
            trackPoints: [...(s.trackPoints || []), p],
            trackPointsSmoothed: [...(s.trackPointsSmoothed || []), p],
            trackPointsRaw: [...(s.trackPointsRaw || []), p],
            lastCoordinate: { lat, lng, alt, accuracy, speed: speedMs },
            lastCoordinateTime: Date.now(),
          };
        });
        path = 'setState_fallback';
      }
    } catch (err) {
      threw = true;
      log('v444.simwalker.emit_err', { err: String(err) });
    }
    const trackLen = (useTrackingStore.getState() as any).trackPoints?.length ?? -1;
    const distNow = (useTrackingStore.getState() as any).distanceM ?? -1;
    log('v450.simwalker.emit_wrote', {
      path,
      threw,
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      speed: Number(speedMs.toFixed(2)),
      trackPoints_after: trackLen,
      distanceM_after: Number(distNow.toFixed(2)),
    });
  }
}

export const gpsInjector = new GpsInjector();

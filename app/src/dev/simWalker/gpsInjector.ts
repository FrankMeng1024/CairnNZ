/**
 * sim-walker gpsInjector — v441 free-walk, dev-controllable speed
 *
 * v441 changes vs v438:
 *   - Single "walk speed" mode, tunable at runtime via setStepConfig()
 *   - Default: 1.4 m per emit, 1200 ms between emits → 1.17 m/s ≈ walking pace
 *     (matches real pedestrian GPS sampling cadence)
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
  step_m: 1.4,
  emit_ms: 1200,
  undo_count: 10,
};

interface InjectorSnapshot {
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

type InjectorListener = (snapshot: InjectorSnapshot) => void;

const EARTH_R_M = 6_378_137;
const JITTER_M_1_SIGMA = 1;   // realistic GPS noise (< step_m so forward progress is net positive)
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

  setStartPosition(lat: number, lng: number): void {
    log('v441.simwalker.set_start', {
      new_lat: Number(lat.toFixed(6)),
      new_lng: Number(lng.toFixed(6)),
      history_cleared: this.posHistory.length,
    });
    this.currentPos = { lat, lng };
    this.posHistory = [];
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
        lastCoordinate: { lat, lng, alt: 100, accuracy: 5, speed: 0 },
        lastCoordinateTime: Date.now(),
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
    // O5 (2026-07-26): NaN guard. Overlay's TextInput sends strings that
    // pass through parseFloat/parseInt; if user clears the field or types
    // non-numeric input, we get NaN. Math.min/max with NaN returns NaN,
    // which then propagates through moveByBearing into lat/lng of every
    // emitted point → silently broken sim-walker until app reload.
    // Fall back to the previous value when NaN is received.
    if (!Number.isFinite(next.step_m)) next.step_m = this.config.step_m;
    if (!Number.isFinite(next.emit_ms)) next.emit_ms = this.config.emit_ms;
    if (!Number.isFinite(next.undo_count)) next.undo_count = this.config.undo_count;
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
    log('v441.simwalker.start', { config: this.config });
    this.tickHandle = setInterval(() => this.tick(), this.config.emit_ms);
  }

  stop(): void {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
      log('v441.simwalker.stop', { ticks_emitted: this.ticksEmitted });
    }
    this.strength = 0;
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
    // Advance step_m * strength metres in bearing direction
    const stepM = this.config.step_m * this.strength;
    const next = moveByBearing(this.currentPos.lat, this.currentPos.lng, this.bearingRad, stepM);
    this.currentPos = next;

    // Save history for undo
    this.posHistory.push({ lat: next.lat, lng: next.lng });
    if (this.posHistory.length > HISTORY_SIZE) this.posHistory.shift();

    // Apply small jitter for realism
    const jitterMag = Math.abs(boxMuller()) * JITTER_M_1_SIGMA;
    const jitterBearing = Math.random() * 2 * Math.PI;
    const jittered = moveByBearing(next.lat, next.lng, jitterBearing, jitterMag);

    const speedMs = stepM / (this.config.emit_ms / 1000);
    const accuracy = 5 + Math.random() * 10;
    this.ticksEmitted += 1;

    log('v441.simwalker.tick_emit', {
      idx: this.ticksEmitted,
      raw_lat: Number(next.lat.toFixed(6)),
      raw_lng: Number(next.lng.toFixed(6)),
      jittered_lat: Number(jittered.lat.toFixed(6)),
      jittered_lng: Number(jittered.lng.toFixed(6)),
      step_m: Number(stepM.toFixed(2)),
      speed_ms: Number(speedMs.toFixed(2)),
      accuracy_m: Number(accuracy.toFixed(1)),
      strength: Number(this.strength.toFixed(2)),
      bearing_deg: Number(((this.bearingRad * 180) / Math.PI).toFixed(1)),
      history_len: this.posHistory.length,
    });

    this.emit(jittered.lat, jittered.lng, speedMs, accuracy, Date.now());
    this.notify();
  }

  private emit(lat: number, lng: number, speedMs: number, accuracy: number, ts: number): void {
    // v450: segmentBreak removed. sim-walker points now write to store
    // without any discontinuity flag; polyline splitter treats them
    // exactly like real GPS. ⟲/↶ scenarios don't need visual breaks
    // per user 2026-07-25 clarification.
    let path = 'unknown';
    let threw = false;
    try {
      const st = useTrackingStore.getState() as any;
      if (typeof st.__simwalkerAddTrackPoint === 'function') {
        st.__simwalkerAddTrackPoint(
          { lat, lng, alt: 100, accuracy, speed: speedMs },
          ts,
        );
        path = 'dev_api';
      } else {
        useTrackingStore.setState((s: any) => {
          const p = { lat, lng, alt: 100, accuracy, speed: speedMs, t: Date.now() };
          return {
            trackPoints: [...(s.trackPoints || []), p],
            trackPointsSmoothed: [...(s.trackPointsSmoothed || []), p],
            trackPointsRaw: [...(s.trackPointsRaw || []), p],
            lastCoordinate: { lat, lng, alt: 100, accuracy, speed: speedMs },
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

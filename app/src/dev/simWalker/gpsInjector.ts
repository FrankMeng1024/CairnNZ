/**
 * sim-walker gpsInjector — v438 (100% log coverage)
 *
 * v438: every code path logged, per user's "100% log coverage" rule.
 * v437 changes (unchanged):
 *   - Speed modes walk/jog/run
 *   - Dual-cadence 500ms tick + emit every 6 ticks (3s)
 *   - ±3m jitter, accuracy 5-15, ±0.3 m/s speed noise
 *   - 10-sample history for undo
 *
 * Also: emit no longer calls processReading/setLastWatcherFix — that
 * caused mystery memory-circle unlocks without an active hike. Now
 * only addTrackPoint is called; downstream systems decide side effects.
 */

import { useTrackingStore } from '../../store/useTrackingStore';
import { log } from '../../services/appLog';

export type SpeedMode = 'walk' | 'jog' | 'run';

const SPEED_MODES: Record<SpeedMode, number> = {
  walk: 1.4,
  jog: 3.0,
  run: 5.0,
};

export interface InjectorSnapshot {
  active: boolean;
  currentPos: { lat: number; lng: number } | null;
  bearingDeg: number;
  strength: number;
  speedMode: SpeedMode;
  ticksEmitted: number;
  historyLen: number;
}

export type InjectorListener = (snapshot: InjectorSnapshot) => void;

const INTERNAL_TICK_MS = 500;
const EMIT_EVERY_N_TICKS = 6;
const EARTH_R_M = 6_378_137;
const JITTER_M_1_SIGMA = 3;
const SPEED_NOISE_1_SIGMA = 0.3;
const HISTORY_SIZE = 10;

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
  private speedMode: SpeedMode = 'walk';
  private ticksEmitted = 0;
  private internalTickCount = 0;
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<InjectorListener>();
  private posHistory: Array<{ lat: number; lng: number }> = [];

  setStartPosition(lat: number, lng: number): void {
    const prev = this.currentPos;
    log('v438.simwalker.set_start', {
      new_lat: Number(lat.toFixed(6)),
      new_lng: Number(lng.toFixed(6)),
      prev_lat: prev ? Number(prev.lat.toFixed(6)) : null,
      prev_lng: prev ? Number(prev.lng.toFixed(6)) : null,
      history_cleared: this.posHistory.length,
    });
    this.currentPos = { lat, lng };
    this.posHistory = [];
    this.notify();
  }

  setJoystick(bearingRad: number, strength: number): void {
    if (Number.isNaN(bearingRad) || Number.isNaN(strength)) {
      log('v438.simwalker.joystick_nan', {
        bearing_rad: Number.isNaN(bearingRad) ? 'NaN' : bearingRad,
        strength: Number.isNaN(strength) ? 'NaN' : strength,
      });
      return;
    }
    const clamped = Math.max(0, Math.min(1, strength));
    // Log every ~10th call to avoid flooding at 60fps pan gestures
    if (Math.random() < 0.1) {
      log('v438.simwalker.joystick_set', {
        bearing_deg: Number(((bearingRad * 180) / Math.PI).toFixed(1)),
        strength: Number(clamped.toFixed(2)),
      });
    }
    this.bearingRad = bearingRad;
    this.strength = clamped;
  }

  releaseJoystick(): void {
    log('v438.simwalker.joystick_release', { was_strength: Number(this.strength.toFixed(2)) });
    this.strength = 0;
  }

  setSpeedMode(mode: SpeedMode): void {
    const prev = this.speedMode;
    const valid = SPEED_MODES[mode] !== undefined;
    if (valid) this.speedMode = mode;
    log('v438.simwalker.set_speed', {
      requested: mode,
      valid,
      applied: this.speedMode,
      prev_mode: prev,
      mps: SPEED_MODES[this.speedMode],
    });
    this.notify();
  }

  undoSteps(n: number): void {
    if (n <= 0 || this.posHistory.length === 0) {
      log('v438.simwalker.undo_nop', {
        requested: n,
        history_len: this.posHistory.length,
        reason: n <= 0 ? 'invalid_n' : 'empty_history',
      });
      return;
    }
    const take = Math.min(n, this.posHistory.length);
    let restored: { lat: number; lng: number } | null = null;
    for (let i = 0; i < take; i++) {
      restored = this.posHistory.pop() ?? null;
    }
    if (restored) this.currentPos = restored;
    log('v438.simwalker.undo', {
      requested: n,
      taken: take,
      history_remaining: this.posHistory.length,
      new_lat: restored ? Number(restored.lat.toFixed(6)) : null,
      new_lng: restored ? Number(restored.lng.toFixed(6)) : null,
    });
    this.notify();
  }

  start(): void {
    if (this.tickHandle) {
      log('v438.simwalker.start_already_active', { ticks_emitted: this.ticksEmitted });
      return;
    }
    log('v438.simwalker.start', {
      tick_ms: INTERNAL_TICK_MS,
      emit_every_n_ticks: EMIT_EVERY_N_TICKS,
      has_start_pos: this.currentPos !== null,
      start_lat: this.currentPos ? Number(this.currentPos.lat.toFixed(6)) : null,
      start_lng: this.currentPos ? Number(this.currentPos.lng.toFixed(6)) : null,
    });
    this.tickHandle = setInterval(() => this.tick(), INTERNAL_TICK_MS);
  }

  stop(): void {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
      log('v438.simwalker.stop', {
        ticks_emitted: this.ticksEmitted,
        internal_tick_count: this.internalTickCount,
      });
    } else {
      log('v438.simwalker.stop_already_stopped', {});
    }
    this.strength = 0;
  }

  getSnapshot(): InjectorSnapshot {
    return {
      active: this.tickHandle !== null,
      currentPos: this.currentPos,
      bearingDeg: (this.bearingRad * 180) / Math.PI,
      strength: this.strength,
      speedMode: this.speedMode,
      ticksEmitted: this.ticksEmitted,
      historyLen: this.posHistory.length,
    };
  }

  subscribe(fn: InjectorListener): () => void {
    this.listeners.add(fn);
    log('v438.simwalker.subscribe', { listeners_now: this.listeners.size });
    return () => {
      this.listeners.delete(fn);
      log('v438.simwalker.unsubscribe', { listeners_now: this.listeners.size });
    };
  }

  private notify(): void {
    const snap = this.getSnapshot();
    this.listeners.forEach((fn) => {
      try {
        fn(snap);
      } catch (err) {
        log('v438.simwalker.listener_err', { err: String(err) });
      }
    });
  }

  private tick(): void {
    if (!this.currentPos) {
      // Only log every 10th such tick to avoid flooding (typical when
      // sim-walker is running but startPosition hasn't been called yet).
      if (this.internalTickCount % 10 === 0) {
        log('v438.simwalker.tick_no_pos', { internal_count: this.internalTickCount });
      }
      this.internalTickCount += 1;
      return;
    }
    if (this.strength <= 0) {
      // Idle — user isn't pushing the joystick. Log occasionally so we
      // can prove the tick loop is alive even when idle.
      if (this.internalTickCount % 20 === 0) {
        log('v438.simwalker.tick_idle', {
          internal_count: this.internalTickCount,
          lat: Number(this.currentPos.lat.toFixed(6)),
          lng: Number(this.currentPos.lng.toFixed(6)),
        });
      }
      this.internalTickCount += 1;
      this.notify();
      return;
    }

    const speedMs = SPEED_MODES[this.speedMode] * this.strength;
    const stepM = speedMs * (INTERNAL_TICK_MS / 1000);
    const next = moveByBearing(this.currentPos.lat, this.currentPos.lng, this.bearingRad, stepM);
    this.currentPos = next;
    this.internalTickCount += 1;

    const isEmitTick = this.internalTickCount % EMIT_EVERY_N_TICKS === 0;

    if (isEmitTick) {
      // Save pre-jitter position for undo
      let historyShifted = false;
      this.posHistory.push({ lat: next.lat, lng: next.lng });
      if (this.posHistory.length > HISTORY_SIZE) {
        this.posHistory.shift();
        historyShifted = true;
      }

      const jitterMag = Math.abs(boxMuller()) * JITTER_M_1_SIGMA;
      const jitterBearing = Math.random() * 2 * Math.PI;
      const jittered = moveByBearing(next.lat, next.lng, jitterBearing, jitterMag);

      const speedNoisy = Math.max(0, speedMs + boxMuller() * SPEED_NOISE_1_SIGMA);
      const accuracy = 5 + Math.random() * 10;

      log('v438.simwalker.tick_emit', {
        internal_count: this.internalTickCount,
        raw_lat: Number(next.lat.toFixed(6)),
        raw_lng: Number(next.lng.toFixed(6)),
        jittered_lat: Number(jittered.lat.toFixed(6)),
        jittered_lng: Number(jittered.lng.toFixed(6)),
        jitter_m: Number(jitterMag.toFixed(2)),
        speed_ideal: Number(speedMs.toFixed(2)),
        speed_noisy: Number(speedNoisy.toFixed(2)),
        accuracy_m: Number(accuracy.toFixed(1)),
        speed_mode: this.speedMode,
        strength: Number(this.strength.toFixed(2)),
        bearing_deg: Number(((this.bearingRad * 180) / Math.PI).toFixed(1)),
        step_m: Number(stepM.toFixed(2)),
        history_shifted: historyShifted,
        history_len: this.posHistory.length,
      });

      this.emit(jittered.lat, jittered.lng, speedNoisy, accuracy, Date.now());
      this.ticksEmitted += 1;
    } else {
      // Mid-tick (position advanced but no emit)
      if (this.internalTickCount % 3 === 0) {
        // Log every 2nd of the 5 mid-ticks to keep noise reasonable
        log('v438.simwalker.tick_mid', {
          internal_count: this.internalTickCount,
          next_emit_in_ticks: EMIT_EVERY_N_TICKS - (this.internalTickCount % EMIT_EVERY_N_TICKS),
          step_m: Number(stepM.toFixed(2)),
        });
      }
    }
    this.notify();
  }

  private emit(lat: number, lng: number, speedMs: number, accuracy: number, ts: number): void {
    // v437.1: only addTrackPoint. NO processReading, NO setLastWatcherFix.
    // Downstream unlock logic must come from the real hike pipeline.
    const tsStr = new Date(ts).toISOString();
    let addTrackReturned: unknown = 'unknown';
    let threw = false;
    try {
      const result = useTrackingStore.getState().addTrackPoint(
        { lat, lng, alt: null, accuracy, speed: speedMs },
        ts,
      );
      // addTrackPoint may return void or a bool depending on hike state.
      // Capture whatever we got so we can prove it was a no-op when no
      // hike is active.
      addTrackReturned = result === undefined ? 'void' : result;
    } catch (err) {
      threw = true;
      log('v438.simwalker.emit_addTrackPoint_err', {
        err: String(err),
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
      });
    }

    // Log the write outcome so we can prove sim-walker didn't unlock
    // anything by itself — the only side effect is via addTrackPoint,
    // which is a no-op when no hike is active.
    log('v438.simwalker.emit_wrote', {
      threw,
      addTrackPoint_returned: addTrackReturned,
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      speed: Number(speedMs.toFixed(2)),
      accuracy: Number(accuracy.toFixed(1)),
      ts_iso: tsStr,
      ticks_emitted_so_far: this.ticksEmitted + 1,
    });
  }
}

export const gpsInjector = new GpsInjector();

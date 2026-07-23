/**
 * sim-walker gpsInjector — v434 free-walk mode
 *
 * v434 rewrite: removed the "planned route" / A→B / progressM model
 * from the SPIKE-006 version. That was overkill and confusing. The
 * new model is dead simple:
 *
 *   - Overlay pushes a 2D vector (bearing radians, strength 0..1) from
 *     the joystick on every touch move.
 *   - This injector emits a fresh GPS fix every EMIT_PERIOD_MS (500 ms).
 *     Each fix advances the position by `strength * STEP_M` metres
 *     in the given bearing. STEP_M is tuned so strength=1 ≈ 1.4 m/s
 *     (normal human walking).
 *   - No route, no snap-to-road, no arrival phase. User goes wherever
 *     they push the stick.
 *   - When strength drops to 0 (finger released) emission pauses.
 *
 * The 3 emit sinks (useTrackingStore.addTrackPoint,
 * useMemoryStore.setLastWatcherFix, unlockEngine.processReading) are
 * unchanged — this is only the input side.
 *
 * Dev-only. Bundled out of production via isSimMode gate on the caller.
 */

import { useTrackingStore } from '../../store/useTrackingStore';
import { useMemoryStore } from '../../features/memory/store/useMemoryStore';
import { processReading } from '../../features/memory/services/unlockEngine';

export interface InjectorSnapshot {
  active: boolean;
  currentPos: { lat: number; lng: number } | null;
  bearingDeg: number;
  strength: number;
  ticksEmitted: number;
}

export type InjectorListener = (snapshot: InjectorSnapshot) => void;

/** 1.4 m/s * 0.5 s = 0.7 m per step at full stick */
const STEP_M = 0.7;
/** How often we emit a synthesized GPS fix (ms) */
const EMIT_PERIOD_MS = 500;

// Earth radius, WGS84 mean, used to convert metres → degrees.
const EARTH_R_M = 6_378_137;

function moveByBearing(
  lat: number,
  lng: number,
  bearingRad: number,
  distanceM: number,
): { lat: number; lng: number } {
  // Small-distance flat approximation, good enough for <10 m steps.
  const dLat = (distanceM * Math.cos(bearingRad)) / EARTH_R_M;
  const dLng = (distanceM * Math.sin(bearingRad)) / (EARTH_R_M * Math.cos((lat * Math.PI) / 180));
  return {
    lat: lat + (dLat * 180) / Math.PI,
    lng: lng + (dLng * 180) / Math.PI,
  };
}

class GpsInjector {
  private currentPos: { lat: number; lng: number } | null = null;
  private bearingRad = 0; // 0 = north, increasing clockwise
  private strength = 0;   // 0..1
  private ticksEmitted = 0;
  private emitHandle: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<InjectorListener>();

  /** Set the starting position for the sim. Call once when overlay mounts. */
  setStartPosition(lat: number, lng: number): void {
    this.currentPos = { lat, lng };
    this.notify();
  }

  /**
   * Push joystick vector.
   *   bearingRad = angle in radians (0 = north, +π/2 = east)
   *   strength   = 0..1 (0 = released, 1 = full push)
   */
  setJoystick(bearingRad: number, strength: number): void {
    if (Number.isNaN(bearingRad) || Number.isNaN(strength)) return;
    this.bearingRad = bearingRad;
    this.strength = Math.max(0, Math.min(1, strength));
  }

  releaseJoystick(): void {
    this.strength = 0;
  }

  /** Start emitting fixes at EMIT_PERIOD_MS cadence. Idempotent. */
  start(): void {
    if (this.emitHandle) return;
    this.emitHandle = setInterval(() => this.tick(), EMIT_PERIOD_MS);
  }

  stop(): void {
    if (this.emitHandle) {
      clearInterval(this.emitHandle);
      this.emitHandle = null;
    }
    this.strength = 0;
  }

  getSnapshot(): InjectorSnapshot {
    return {
      active: this.emitHandle !== null,
      currentPos: this.currentPos,
      bearingDeg: (this.bearingRad * 180) / Math.PI,
      strength: this.strength,
      ticksEmitted: this.ticksEmitted,
    };
  }

  subscribe(fn: InjectorListener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private notify(): void {
    const snap = this.getSnapshot();
    this.listeners.forEach((fn) => {
      try { fn(snap); } catch { /* isolate */ }
    });
  }

  private tick(): void {
    if (!this.currentPos) return;
    if (this.strength <= 0) {
      // Idle — don't emit stationary fixes.
      this.notify();
      return;
    }
    const stepM = STEP_M * this.strength;
    const next = moveByBearing(
      this.currentPos.lat,
      this.currentPos.lng,
      this.bearingRad,
      stepM,
    );
    this.currentPos = next;
    this.ticksEmitted += 1;
    this.emit(next.lat, next.lng, stepM / (EMIT_PERIOD_MS / 1000), Date.now());
    this.notify();
  }

  private emit(lat: number, lng: number, speedMs: number, ts: number): void {
    try {
      useTrackingStore.getState().addTrackPoint(
        { lat, lng, alt: null, accuracy: 10, speed: speedMs },
        ts,
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[sim-walker] addTrackPoint threw', err);
    }
    try {
      useMemoryStore.getState().setLastWatcherFix(lat, lng, ts);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[sim-walker] setLastWatcherFix threw', err);
    }
    try {
      processReading({ lat, lng, accuracyM: 10, speedMs, timestampMs: ts });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[sim-walker] processReading threw', err);
    }
  }
}

/** Singleton — one injector per app. */
export const gpsInjector = new GpsInjector();

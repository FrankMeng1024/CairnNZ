/**
 * sim-walker gpsInjector — v437 realistic mode
 *
 * v437 changes vs v435:
 *   - Speed modes: walk (1.4 m/s), jog (3.0), run (5.0)
 *   - Dual-cadence: 500 ms internal tick (smooth joystick) + emit
 *     only every 6th tick = 3 s emit period (matches production
 *     `lastSamplingIntervalMs` = 3000 in useTrackingStore, so the
 *     downstream distance/stationary gates behave identically to
 *     real GPS)
 *   - Realism: ±3 m gaussian jitter on lat/lng, accuracy 5-15 m
 *     random, speed ±0.3 m/s gaussian noise
 *   - History buffer for undo (10 samples ring, undo5() rewinds)
 *   - Reset start point via setStartPosition() unchanged
 *
 * See PLAN research notes in _review/v437-plan.
 */

import { useTrackingStore } from '../../store/useTrackingStore';
import { useMemoryStore } from '../../features/memory/store/useMemoryStore';
import { processReading } from '../../features/memory/services/unlockEngine';

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

const INTERNAL_TICK_MS = 500;   // smooth joystick tick
const EMIT_EVERY_N_TICKS = 6;   // emit every 6 * 500 = 3000 ms (prod cadence)
const EARTH_R_M = 6_378_137;
const JITTER_M_1_SIGMA = 3;      // realistic GPS drift
const SPEED_NOISE_1_SIGMA = 0.3; // GPS Doppler noise
const HISTORY_SIZE = 10;         // for undo N

function boxMuller(): number {
  // Standard normal N(0,1) via Box-Muller transform.
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
  private bearingRad = 0;   // 0 = north, clockwise, radians
  private strength = 0;     // 0..1
  private speedMode: SpeedMode = 'walk';
  private ticksEmitted = 0;
  private internalTickCount = 0;
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<InjectorListener>();
  private posHistory: Array<{ lat: number; lng: number }> = [];

  setStartPosition(lat: number, lng: number): void {
    this.currentPos = { lat, lng };
    this.posHistory = [];
    this.notify();
  }

  setJoystick(bearingRad: number, strength: number): void {
    if (Number.isNaN(bearingRad) || Number.isNaN(strength)) return;
    this.bearingRad = bearingRad;
    this.strength = Math.max(0, Math.min(1, strength));
  }

  releaseJoystick(): void {
    this.strength = 0;
  }

  setSpeedMode(mode: SpeedMode): void {
    if (SPEED_MODES[mode] !== undefined) this.speedMode = mode;
    this.notify();
  }

  /** Rewind currentPos by N steps in history. Does NOT touch tracking store. */
  undoSteps(n: number): void {
    if (n <= 0 || this.posHistory.length === 0) return;
    const take = Math.min(n, this.posHistory.length);
    // Pop `take` items; the last popped becomes the new currentPos.
    let restored: { lat: number; lng: number } | null = null;
    for (let i = 0; i < take; i++) {
      restored = this.posHistory.pop() ?? null;
    }
    if (restored) this.currentPos = restored;
    this.notify();
  }

  start(): void {
    if (this.tickHandle) return;
    this.tickHandle = setInterval(() => this.tick(), INTERNAL_TICK_MS);
  }

  stop(): void {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
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
      this.notify();
      return;
    }
    // Advance position smoothly every 500 ms tick.
    const speedMs = SPEED_MODES[this.speedMode] * this.strength;
    const stepM = speedMs * (INTERNAL_TICK_MS / 1000);
    const next = moveByBearing(this.currentPos.lat, this.currentPos.lng, this.bearingRad, stepM);
    this.currentPos = next;
    this.internalTickCount += 1;

    // Emit only every 6 ticks = 3 s cadence (matches production).
    if (this.internalTickCount % EMIT_EVERY_N_TICKS === 0) {
      // Save pre-emit position for undo (history contains emitted positions).
      this.posHistory.push({ lat: next.lat, lng: next.lng });
      if (this.posHistory.length > HISTORY_SIZE) this.posHistory.shift();

      // Apply jitter for realism. Random bearing + normal magnitude.
      const jitterMag = Math.abs(boxMuller()) * JITTER_M_1_SIGMA;
      const jitterBearing = Math.random() * 2 * Math.PI;
      const jittered = moveByBearing(next.lat, next.lng, jitterBearing, jitterMag);

      const speedNoisy = Math.max(0, speedMs + boxMuller() * SPEED_NOISE_1_SIGMA);
      const accuracy = 5 + Math.random() * 10; // 5..15 m
      this.emit(jittered.lat, jittered.lng, speedNoisy, accuracy, Date.now());
      this.ticksEmitted += 1;
    }
    this.notify();
  }

  private emit(lat: number, lng: number, speedMs: number, accuracy: number, ts: number): void {
    try {
      useTrackingStore.getState().addTrackPoint(
        { lat, lng, alt: null, accuracy, speed: speedMs },
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
      processReading({ lat, lng, accuracyM: accuracy, speedMs, timestampMs: ts });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[sim-walker] processReading threw', err);
    }
  }
}

export const gpsInjector = new GpsInjector();

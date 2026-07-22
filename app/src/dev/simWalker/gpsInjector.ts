/**
 * SPIKE-006 sim-walker — gpsInjector
 *
 * Runs a 10 Hz internal tick loop (100ms) that advances `progressM`
 * along a `PlannedRoute` proportional to the current joystick input,
 * and emits GPS fixes into Cairn's stores at 500ms cadence (half of
 * the real watchPosition timeInterval — dense enough to feel live,
 * sparse enough to match production write rates).
 *
 * Emits go to three sinks:
 *   1. useTrackingStore.addTrackPoint  — feeds the hike track polyline
 *      + hike-track disk writer + smoothed track.
 *   2. useMemoryStore.setLastWatcherFix — feeds MemoryScreen's cached
 *      last-fix marker.
 *   3. unlockEngine.processReading     — gates unlock decisions (v334
 *      auto-reveal is disabled, so this is mostly a book-keeping path
 *      for future consumers).
 *
 * Dev-only. Bundled out of production via the isSimMode gate on the
 * caller.
 */

import { useTrackingStore } from '../../store/useTrackingStore';
import { useMemoryStore } from '../../features/memory/store/useMemoryStore';
import { processReading } from '../../features/memory/services/unlockEngine';
import { positionAt, type PlannedRoute } from './routePlanner';

export type InjectorPhase =
  | 'idle'
  | 'walking-forward'
  | 'walking-backward'
  | 'arrived-end'
  | 'arrived-start';

export interface InjectorSnapshot {
  phase: InjectorPhase;
  progressM: number;
  totalM: number;
  speedMs: number;
  currentPos: { lat: number; lng: number } | null;
  ticksEmitted: number;
}

export interface InjectorListener {
  (snapshot: InjectorSnapshot): void;
}

/** Peak sim speed (m/s). 3 m/s ≈ brisk walking pace. */
const MAX_SPEED = 3.0;
/** Internal tick period (ms). Fine-grained for smooth on-screen motion. */
const INTERNAL_TICK_MS = 100;
/** Emit cadence into Cairn stores (ms). Half of watchPosition's 2s. */
const EMIT_PERIOD_MS = 500;
/** Speeds below this |m/s| are treated as "not moving" and skip emit. */
const IDLE_SPEED_THRESHOLD = 0.05;

class GpsInjector {
  private route: PlannedRoute | null = null;
  private progressM = 0;
  private joystickInput = 0; // -1..+1, +ve = forward
  private ticksEmitted = 0;
  private currentPos: { lat: number; lng: number } | null = null;
  private lastTickTs = 0;
  private lastEmitTs = 0;
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<InjectorListener>();
  private phase: InjectorPhase = 'idle';

  /** Load a planned route and reset progress. Does not start ticking. */
  setRoute(route: PlannedRoute): void {
    this.route = route;
    this.progressM = 0;
    this.ticksEmitted = 0;
    this.currentPos = route.coords.length
      ? { lng: route.coords[0][0], lat: route.coords[0][1] }
      : null;
    this.phase = 'idle';
    this.notify();
  }

  clearRoute(): void {
    this.stop();
    this.route = null;
    this.progressM = 0;
    this.ticksEmitted = 0;
    this.currentPos = null;
    this.phase = 'idle';
    this.notify();
  }

  /** Push joystick input in [-1, 1]. Values outside are clamped. */
  setJoystick(v: number): void {
    if (Number.isNaN(v)) return;
    this.joystickInput = Math.max(-1, Math.min(1, v));
  }

  releaseJoystick(): void {
    this.joystickInput = 0;
  }

  /** Start the internal tick loop. Idempotent. */
  start(): void {
    if (this.tickHandle) return;
    this.lastTickTs = Date.now();
    this.lastEmitTs = 0;
    this.tickHandle = setInterval(() => this.tick(), INTERNAL_TICK_MS);
  }

  stop(): void {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
    this.joystickInput = 0;
  }

  isRunning(): boolean {
    return this.tickHandle !== null;
  }

  getSnapshot(): InjectorSnapshot {
    return {
      phase: this.phase,
      progressM: this.progressM,
      totalM: this.route?.totalM ?? 0,
      speedMs: this.joystickInput * MAX_SPEED,
      currentPos: this.currentPos,
      ticksEmitted: this.ticksEmitted,
    };
  }

  subscribe(fn: InjectorListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    const snap = this.getSnapshot();
    this.listeners.forEach((fn) => {
      try {
        fn(snap);
      } catch {
        // Never let a listener take down the tick loop.
      }
    });
  }

  private tick(): void {
    const route = this.route;
    if (!route) return;

    const now = Date.now();
    const dt = (now - this.lastTickTs) / 1000; // seconds
    this.lastTickTs = now;

    const speedMs = this.joystickInput * MAX_SPEED;
    this.progressM += speedMs * dt;
    this.progressM = Math.max(0, Math.min(route.totalM, this.progressM));

    const pos = positionAt(route, this.progressM);
    if (pos) {
      this.currentPos = { lng: pos[0], lat: pos[1] };
    }

    // Phase resolution — used by UI to render "arrived" state
    if (this.progressM >= route.totalM - 0.5) {
      this.phase = 'arrived-end';
    } else if (this.progressM <= 0.5 && speedMs < 0) {
      this.phase = 'arrived-start';
    } else if (Math.abs(speedMs) < IDLE_SPEED_THRESHOLD) {
      this.phase = 'idle';
    } else if (speedMs > 0) {
      this.phase = 'walking-forward';
    } else {
      this.phase = 'walking-backward';
    }

    // Emit to Cairn stores at EMIT_PERIOD_MS cadence, and only when
    // meaningfully moving (avoid spamming duplicate stationary fixes).
    const emitDue = now - this.lastEmitTs >= EMIT_PERIOD_MS;
    if (
      emitDue &&
      this.currentPos &&
      Math.abs(speedMs) >= IDLE_SPEED_THRESHOLD
    ) {
      this.emit(this.currentPos.lat, this.currentPos.lng, speedMs, now);
      this.lastEmitTs = now;
      this.ticksEmitted += 1;
    }

    this.notify();
  }

  private emit(lat: number, lng: number, speedMs: number, ts: number): void {
    try {
      useTrackingStore.getState().addTrackPoint(
        {
          lat,
          lng,
          alt: null,
          accuracy: 10,
          speed: speedMs,
        },
        ts,
      );
    } catch (err) {
      // Store may not have an active session; the write is best-effort
      // in dev-only paths, so swallow rather than crash the tick loop.
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
      processReading({
        lat,
        lng,
        accuracyM: 10,
        speedMs,
        timestampMs: ts,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[sim-walker] processReading threw', err);
    }
  }
}

/** Singleton — one injector per app. */
export const gpsInjector = new GpsInjector();

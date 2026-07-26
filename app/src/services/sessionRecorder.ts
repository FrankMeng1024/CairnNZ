/**
 * SessionRecorder — L3 minute snapshot aggregator.
 *
 * Subscribes to debugLogger events and accumulates per-minute statistics,
 * then flushes a `minute_snapshot` event every 60 seconds.
 *
 * Lifecycle:
 *   - start() — call when tracking begins (after debugLogger.startSession)
 *   - stop() — call when tracking ends
 *
 * Web fallback: same as debugLogger — silently no-op.
 */
import { debugLogger } from './debugLogger';
import { networkMonitor } from './networkMonitor';
import { batteryMonitor } from './batteryMonitor';
import { AppState } from 'react-native';
import type { LogEvent, MinuteSnapshotEvent } from '../types/debugLog';

const SNAPSHOT_INTERVAL_MS = 60_000;

class MinuteAggregator {
  private accuracies: number[] = [];
  private gpsLostStartMs: number | null = null;
  private gpsLostTotalMs = 0;
  private lastGpsTs: number | null = null;
  private errorsCount = 0;
  private networkChangesCount = 0;
  private screenOnStartMs: number | null = null;
  private screenOnTotalMs = 0;
  private inBackgroundStartMs: number | null = null;
  private inBackgroundTotalMs = 0;
  private wasCharging = false;
  private batteryStartLevel: number | null = null;

  constructor() {
    const now = Date.now();
    this.batteryStartLevel = batteryMonitor.getCurrentLevel();
    const appState = AppState.currentState;
    if (appState === 'active') this.screenOnStartMs = now;
    if (appState === 'background') this.inBackgroundStartMs = now;
  }

  ingest(event: LogEvent): void {
    switch (event.event) {
      case 'gps_fix': {
        if (event.accuracy_m !== null) this.accuracies.push(event.accuracy_m);
        const now = event.ts;
        // Track GPS gaps: if previous fix was > 5s ago, count that gap as "lost".
        // This is a simple heuristic — analyze-session.py does the precise version.
        if (this.lastGpsTs !== null && now - this.lastGpsTs > 5_000) {
          this.gpsLostTotalMs += now - this.lastGpsTs;
        }
        this.lastGpsTs = now;
        // Close any explicit open lost period (started by stop()/init)
        if (this.gpsLostStartMs !== null) {
          this.gpsLostTotalMs += now - this.gpsLostStartMs;
          this.gpsLostStartMs = null;
        }
        break;
      }
      case 'error':
        this.errorsCount++;
        break;
      case 'network_change':
        this.networkChangesCount++;
        break;
      case 'app_state_change': {
        const now = event.ts;
        // Close screen_on window
        if (this.screenOnStartMs !== null && event.from === 'active') {
          this.screenOnTotalMs += now - this.screenOnStartMs;
          this.screenOnStartMs = null;
        }
        // Open screen_on window
        if (event.to === 'active') {
          this.screenOnStartMs = now;
        }
        // Close in_background window
        if (this.inBackgroundStartMs !== null && event.from === 'background') {
          this.inBackgroundTotalMs += now - this.inBackgroundStartMs;
          this.inBackgroundStartMs = null;
        }
        // Open in_background window
        if (event.to === 'background') {
          this.inBackgroundStartMs = now;
        }
        break;
      }
      case 'battery_sample':
        if (event.is_charging) this.wasCharging = true;
        break;
    }
  }

  /**
   * Build a minute_snapshot event and reset internal state.
   */
  flush(minuteIndex: number): MinuteSnapshotEvent {
    const now = Date.now();

    // Close any open windows for accurate accounting
    let screenOnMs = this.screenOnTotalMs;
    if (this.screenOnStartMs !== null) {
      screenOnMs += now - this.screenOnStartMs;
    }
    let inBackgroundMs = this.inBackgroundTotalMs;
    if (this.inBackgroundStartMs !== null) {
      inBackgroundMs += now - this.inBackgroundStartMs;
    }

    const sortedAcc = [...this.accuracies].sort((a, b) => a - b);
    const avgAcc = sortedAcc.length
      ? sortedAcc.reduce((a, b) => a + b, 0) / sortedAcc.length
      : null;
    const maxAcc = sortedAcc.length ? sortedAcc[sortedAcc.length - 1] : null;
    const p95Acc = sortedAcc.length
      ? sortedAcc[Math.min(sortedAcc.length - 1, Math.floor(sortedAcc.length * 0.95))]
      : null;

    const batteryEnd = batteryMonitor.getCurrentLevel();
    const netState = networkMonitor.getState();

    const snapshot: MinuteSnapshotEvent = {
      ts: now,
      session_id: debugLogger.getCurrentSessionId() ?? '',
      event: 'minute_snapshot',
      minute_index: minuteIndex,
      gps_points_count: this.accuracies.length,
      gps_avg_accuracy_m: avgAcc !== null ? roundN(avgAcc, 2) : null,
      gps_max_accuracy_m: maxAcc !== null ? roundN(maxAcc, 2) : null,
      gps_p95_accuracy_m: p95Acc !== null ? roundN(p95Acc, 2) : null,
      gps_lost_seconds: Math.round(this.gpsLostTotalMs / 1000),
      battery_start_pct:
        this.batteryStartLevel !== null ? Math.round(this.batteryStartLevel * 100) : null,
      battery_end_pct: batteryEnd !== null ? Math.round(batteryEnd * 100) : null,
      battery_drop_pct:
        this.batteryStartLevel !== null && batteryEnd !== null
          ? Math.round((this.batteryStartLevel - batteryEnd) * 100)
          : null,
      is_charging_any: this.wasCharging || batteryMonitor.getIsCharging(),
      screen_on_seconds: Math.round(screenOnMs / 1000),
      in_background_seconds: Math.round(inBackgroundMs / 1000),
      errors_count: this.errorsCount,
      network_state_end: netState?.state ?? 'offline',
      network_changes_count: this.networkChangesCount,
    };

    return snapshot;
  }

  reset(): void {
    const now = Date.now();
    // Carry forward open windows
    const wasScreenOn = this.screenOnStartMs !== null;
    const wasBackground = this.inBackgroundStartMs !== null;
    this.accuracies = [];
    this.gpsLostStartMs = null;
    this.gpsLostTotalMs = 0;
    this.lastGpsTs = null;
    this.errorsCount = 0;
    this.networkChangesCount = 0;
    this.screenOnStartMs = wasScreenOn ? now : null;
    this.screenOnTotalMs = 0;
    this.inBackgroundStartMs = wasBackground ? now : null;
    this.inBackgroundTotalMs = 0;
    this.wasCharging = false;
    this.batteryStartLevel = batteryMonitor.getCurrentLevel();
  }
}

function roundN(n: number, digits: number): number {
  const m = Math.pow(10, digits);
  return Math.round(n * m) / m;
}

class SessionRecorder {
  private aggregator: MinuteAggregator | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private minuteIndex = 0;

  start(): void {
    if (this.timer) return; // already running
    this.aggregator = new MinuteAggregator();
    this.minuteIndex = 0;

    this.unsubscribe = debugLogger.subscribe((event) => {
      if (this.aggregator) this.aggregator.ingest(event);
    });

    this.timer = setInterval(() => {
      if (!this.aggregator) return;
      const snapshot = this.aggregator.flush(this.minuteIndex);
      this.minuteIndex++;
      // Log directly via debugLogger (don't double-ingest — subscribe is called sync from log)
      // Use a flag to prevent re-ingest? Actually safe: aggregator.ingest doesn't handle minute_snapshot.
      debugLogger.log(snapshot);
      this.aggregator.reset();
    }, SNAPSHOT_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    // Final partial snapshot if there's data
    if (this.aggregator) {
      const snapshot = this.aggregator.flush(this.minuteIndex);
      // Only log if there's any data
      if (
        snapshot.gps_points_count > 0 ||
        snapshot.errors_count > 0
      ) {
        debugLogger.log(snapshot);
      }
      this.aggregator = null;
    }
  }
}

export const sessionRecorder = new SessionRecorder();
export default sessionRecorder;

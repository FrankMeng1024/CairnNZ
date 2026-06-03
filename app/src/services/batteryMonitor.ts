/**
 * BatteryMonitor — wraps expo-battery to emit battery_sample events for debug logger.
 *
 * Triggers samples on:
 *   - Initial start (session_start)
 *   - Every 60s (timer_60s)
 *   - Battery level change ≥ 2% (level_change)
 *   - is_charging or batteryState change (state_change)
 *   - On request (manual call)
 *
 * Web fallback: no-op.
 */
import { AppState } from 'react-native';
import { debugLogger } from './debugLogger';

type BatteryModule = typeof import('expo-battery');
let Battery: BatteryModule | null = null;
let loadAttempted = false;

async function getBattery(): Promise<BatteryModule | null> {
  if (Battery) return Battery;
  if (loadAttempted) return null;
  loadAttempted = true;
  try {
    // require() for jest compatibility (no --experimental-vm-modules needed)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Battery = require('expo-battery');
    return Battery;
  } catch {
    return null;
  }
}

const SAMPLE_INTERVAL_MS = 60_000;
const LEVEL_CHANGE_THRESHOLD = 0.02; // 2%

class BatteryMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private levelListener: { remove: () => void } | null = null;
  private stateListener: { remove: () => void } | null = null;
  private lastSampledLevel: number | null = null;
  private isCharging: boolean = false;
  private batteryState: 'unknown' | 'unplugged' | 'charging' | 'full' = 'unknown';
  private active: boolean = false;
  private starting: boolean = false; // re-entrancy guard

  async start(): Promise<void> {
    if (this.active || this.starting) return;
    this.starting = true;
    try {
      const battery = await getBattery();
      if (!battery) {
        this.starting = false;
        return; // web — silently no-op
      }

      this.active = true;

      // Initial sample
      await this.sample('session_start');

      // Periodic
      this.timer = setInterval(() => {
        this.sample('timer_60s').catch(() => {});
      }, SAMPLE_INTERVAL_MS);

      // Level change listener
      try {
        this.levelListener = battery.addBatteryLevelListener(({ batteryLevel }) => {
          const last = this.lastSampledLevel;
          if (last === null || Math.abs(batteryLevel - last) >= LEVEL_CHANGE_THRESHOLD) {
            this.sample('level_change').catch(() => {});
          }
        });
      } catch (err) {
        debugLogger.logError(err, 'batteryMonitor:level_listener');
      }

      // State change listener
      try {
        this.stateListener = battery.addBatteryStateListener(({ batteryState }) => {
          const stateMap = ['unknown', 'unplugged', 'charging', 'full'] as const;
          const newState = stateMap[batteryState] ?? 'unknown';
          if (newState !== this.batteryState) {
            this.batteryState = newState;
            this.isCharging = newState === 'charging' || newState === 'full';
            this.sample('state_change').catch(() => {});
          }
        });
      } catch (err) {
        debugLogger.logError(err, 'batteryMonitor:state_listener');
      }
    } finally {
      this.starting = false;
    }
  }

  async stop(): Promise<void> {
    if (!this.active) return;
    this.active = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    try { this.levelListener?.remove(); } catch { /* ignore */ }
    try { this.stateListener?.remove(); } catch { /* ignore */ }
    this.levelListener = null;
    this.stateListener = null;

    // Final sample
    await this.sample('session_end');
  }

  /**
   * Synchronous read of last known battery level (0-1).
   * Returns null if monitor never read battery yet.
   */
  getCurrentLevel(): number | null {
    return this.lastSampledLevel;
  }

  /**
   * Synchronous read of last known charging state.
   */
  getIsCharging(): boolean {
    return this.isCharging;
  }

  /**
   * Read fresh battery level immediately (async).
   * Use sparingly — most callers should use getCurrentLevel().
   */
  async readLevel(): Promise<number | null> {
    const battery = await getBattery();
    if (!battery) return null;
    try {
      return await battery.getBatteryLevelAsync();
    } catch {
      return null;
    }
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private async sample(
    trigger: 'timer_60s' | 'level_change' | 'state_change' | 'session_start' | 'session_end',
  ): Promise<void> {
    const battery = await getBattery();
    if (!battery) return;

    try {
      const level = await battery.getBatteryLevelAsync();
      const state = await battery.getBatteryStateAsync();
      const stateMap = ['unknown', 'unplugged', 'charging', 'full'] as const;
      const batteryState = stateMap[state] ?? 'unknown';

      // iOS Low Power Mode (Power Saving on Android) — affects background work.
      let lowPowerMode = false;
      try {
        if (typeof battery.isLowPowerModeEnabledAsync === 'function') {
          lowPowerMode = await battery.isLowPowerModeEnabledAsync();
        }
      } catch { /* swallow */ }

      this.lastSampledLevel = level;
      this.batteryState = batteryState;
      this.isCharging = batteryState === 'charging' || batteryState === 'full';

      const appState = AppState.currentState;
      const appStateNorm: 'active' | 'background' | 'inactive' =
        appState === 'active' ? 'active' :
        appState === 'background' ? 'background' : 'inactive';

      debugLogger.log({
        ts: Date.now(),
        event: 'battery_sample',
        level_pct: Math.round(level * 100),
        is_charging: this.isCharging,
        battery_state: batteryState,
        screen_on: appState === 'active',
        app_state: appStateNorm,
        trigger,
        // Custom field — analyze script may use this to explain weird behavior.
        // (Not in MinuteSnapshot type, just BatterySample raw event.)
        ...(lowPowerMode ? { low_power_mode: true } : {}),
      } as any);
    } catch (err) {
      debugLogger.logError(err, 'batteryMonitor:sample');
    }
  }
}

export const batteryMonitor = new BatteryMonitor();
export default batteryMonitor;

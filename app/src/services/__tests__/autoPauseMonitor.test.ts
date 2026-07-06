/**
 * Sprint 72 STORY-00552 — Auto-pause monitor unit tests.
 *
 * Uses jest fake timers to advance wall-clock through the idle detection
 * window without waiting for real minutes to pass.
 */
// Mock modules that pull in native code before importing the SUT
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));
jest.mock('react-native', () => ({
  __esModule: true,
  Platform: { OS: 'ios' },
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) },
}));
jest.mock('../crashLogger', () => ({
  __esModule: true,
  crashLogger: { breadcrumb: () => {} },
}));

import { AUTO_PAUSE, startAutoPauseMonitor, stopAutoPauseMonitor } from '../autoPauseMonitor';

describe('autoPauseMonitor — Sprint 72 STORY-00552', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    stopAutoPauseMonitor();
  });
  afterEach(() => {
    stopAutoPauseMonitor();
    jest.useRealTimers();
  });

  test('exports sensible default constants', () => {
    expect(AUTO_PAUSE.PROMPT_AFTER_MS).toBe(15 * 60_000);
    expect(AUTO_PAUSE.AUTO_END_AFTER_MS).toBe(30 * 60_000);
    expect(AUTO_PAUSE.IDLE_SPEED_THRESHOLD_MS).toBe(0.5);
    expect(AUTO_PAUSE.IDLE_RADIUS_M).toBe(50);
  });

  test('static points for 15 min → prompt; 30 min later → silent end', () => {
    // Use modern timers so both setInterval and Date.now advance together.
    jest.useFakeTimers({ doNotFake: [] });
    jest.setSystemTime(new Date('2026-07-06T10:00:00Z'));
    const initialNow = Date.now();
    // 20-min-wide history window of stationary points
    const staticPoints: Array<{ latitude: number; longitude: number; timestamp: number; speed: number }> = [];
    for (let i = 0; i <= 20; i++) {
      staticPoints.push({
        latitude: 31.2320, longitude: 121.4340,
        timestamp: initialNow - (20 - i) * 60_000, speed: 0,
      });
    }
    let silent = false;
    startAutoPauseMonitor({
      getStatus: () => 'tracking',
      // Return points sliding along fake time so they stay in idle window
      getPoints: () => {
        const now = Date.now();
        return staticPoints.map(p => ({ ...p, timestamp: now - (initialNow - p.timestamp) }));
      },
      onSilentEnd: () => { silent = true; },
    });
    // First tick — sets idleSince=now
    jest.advanceTimersByTime(AUTO_PAUSE.EVAL_TICK_MS);
    // Advance PROMPT_AFTER_MS more — prompt fires but not silent yet
    jest.advanceTimersByTime(AUTO_PAUSE.PROMPT_AFTER_MS);
    expect(silent).toBe(false);
    // Advance AUTO_END_AFTER_MS more — now silent-end
    jest.advanceTimersByTime(AUTO_PAUSE.AUTO_END_AFTER_MS);
    expect(silent).toBe(true);
  });

  test('moving points reset the idle timer', () => {
    let points: Array<{ latitude: number; longitude: number; timestamp: number; speed: number }> = [];
    let silent = false;
    startAutoPauseMonitor({
      getStatus: () => 'tracking',
      getPoints: () => points,
      onSilentEnd: () => { silent = true; },
    });
    const now = Date.now();
    // Feed static points first for 20 min worth
    for (let i = 0; i <= 20; i++) {
      points.push({ latitude: 31.2320, longitude: 121.4340, timestamp: now - (20 - i) * 60_000, speed: 0 });
    }
    jest.advanceTimersByTime(AUTO_PAUSE.EVAL_TICK_MS);
    // Now inject a moving point (far away, high speed)
    points.push({ latitude: 31.2400, longitude: 121.4400, timestamp: now + AUTO_PAUSE.EVAL_TICK_MS, speed: 2.0 });
    jest.advanceTimersByTime(AUTO_PAUSE.EVAL_TICK_MS);
    // silent should NOT fire because idle got reset
    jest.advanceTimersByTime(AUTO_PAUSE.PROMPT_AFTER_MS + AUTO_PAUSE.AUTO_END_AFTER_MS);
    expect(silent).toBe(false);
  });

  test('does nothing when status !== tracking', () => {
    let silent = false;
    const now = Date.now();
    const staticPoints = [{ latitude: 31.2320, longitude: 121.4340, timestamp: now, speed: 0 }];
    startAutoPauseMonitor({
      getStatus: () => 'idle',
      getPoints: () => staticPoints,
      onSilentEnd: () => { silent = true; },
    });
    jest.advanceTimersByTime(AUTO_PAUSE.PROMPT_AFTER_MS + AUTO_PAUSE.AUTO_END_AFTER_MS + 10 * 60_000);
    expect(silent).toBe(false);
  });

  test('stopAutoPauseMonitor cleanly cancels', () => {
    let ticks = 0;
    startAutoPauseMonitor({
      getStatus: () => { ticks++; return 'tracking'; },
      getPoints: () => [],
      onSilentEnd: () => {},
    });
    jest.advanceTimersByTime(AUTO_PAUSE.EVAL_TICK_MS);
    expect(ticks).toBeGreaterThan(0);
    const snapshot = ticks;
    stopAutoPauseMonitor();
    jest.advanceTimersByTime(AUTO_PAUSE.EVAL_TICK_MS * 5);
    expect(ticks).toBe(snapshot);
  });
});

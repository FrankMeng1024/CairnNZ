/**
 * Sprint 72 STORY-00552 — Auto-pause / idle detector.
 *
 * Watches the tracking store's trackPoints buffer during active tracking.
 * If the user is essentially stationary for AUTO_PAUSE.PROMPT_AFTER_MS
 * (default 15 min), fires a local iOS notification "You still on the trail?".
 * If they remain stationary for another AUTO_PAUSE.AUTO_END_AFTER_MS
 * (default 30 min), the session is auto-ended so battery isn't drained
 * recording the user's couch after they got home.
 *
 * Everything is time-driven off wall-clock, not GPS callback frequency —
 * so the detector still fires even when sampling is downgraded to 15s
 * in background+low-battery mode.
 *
 * Constants exported so real-device tuning is a one-file change.
 */
import { AppState } from 'react-native';
import { crashLogger } from './crashLogger';

export const AUTO_PAUSE = {
  IDLE_SPEED_THRESHOLD_MS: 0.5,     // m/s — below this = "not moving"
  IDLE_RADIUS_M: 50,                // meters — total drift within window
  IDLE_WINDOW_MS: 15 * 60_000,      // must be idle for 15 min continuously
  PROMPT_AFTER_MS: 15 * 60_000,     // send notification after 15 min idle
  AUTO_END_AFTER_MS: 30 * 60_000,   // silently end 30 min after prompt
  EVAL_TICK_MS: 60_000,             // re-evaluate every 60s
};

interface AutoPauseHooks {
  getStatus: () => 'idle' | 'tracking' | 'paused' | string;
  getPoints: () => Array<{ latitude: number; longitude: number; timestamp: number; speed?: number }>;
  onSilentEnd: () => void;
}

interface State {
  timer: ReturnType<typeof setInterval> | null;
  idleSince: number | null;
  promptedAt: number | null;
  active: boolean;
}

const state: State = {
  timer: null,
  idleSince: null,
  promptedAt: null,
  active: false,
};

function haversineM(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function isIdle(points: State extends never ? never : Array<{ latitude: number; longitude: number; timestamp: number; speed?: number }>, windowMs: number, now: number): boolean {
  if (points.length === 0) return false;
  const cutoff = now - windowMs;
  const recent = points.filter(p => p.timestamp >= cutoff);
  if (recent.length < 2) return false;
  // Speed check — average speed under threshold
  let speedSum = 0;
  let speedCount = 0;
  for (const p of recent) {
    if (typeof p.speed === 'number' && !Number.isNaN(p.speed)) {
      speedSum += Math.max(0, p.speed);
      speedCount++;
    }
  }
  const avgSpeed = speedCount > 0 ? speedSum / speedCount : 0;
  if (avgSpeed > AUTO_PAUSE.IDLE_SPEED_THRESHOLD_MS) return false;
  // Radius check — max drift within window
  let maxDrift = 0;
  const first = recent[0];
  for (const p of recent) {
    const d = haversineM(first, p);
    if (d > maxDrift) maxDrift = d;
    if (maxDrift > AUTO_PAUSE.IDLE_RADIUS_M) return false;
  }
  return true;
}

async function sendPromptNotification(): Promise<void> {
  try {
    const N = await import('expo-notifications');
    await N.scheduleNotificationAsync({
      content: {
        title: 'Cairn',
        body: 'You still on the trail? Tap to continue or end your hike.',
      },
      trigger: null,
    });
  } catch {
    // Notifications may not be available (web / permission denied). Silent.
  }
}

/**
 * Start monitoring. Idempotent — safe to call multiple times.
 */
export function startAutoPauseMonitor(hooks: AutoPauseHooks): void {
  if (state.active) return;
  state.active = true;
  state.idleSince = null;
  state.promptedAt = null;
  state.timer = setInterval(() => {
    try {
      if (hooks.getStatus() !== 'tracking') {
        // Reset when not tracking; auto-pause only cares about active hikes.
        state.idleSince = null;
        state.promptedAt = null;
        return;
      }
      const points = hooks.getPoints();
      const now = Date.now();
      const idle = isIdle(points, AUTO_PAUSE.IDLE_WINDOW_MS, now);
      if (!idle) {
        if (state.idleSince != null) {
          crashLogger.breadcrumb('auto_pause:movement_resumed reset_idle=true');
        }
        state.idleSince = null;
        state.promptedAt = null;
        return;
      }
      if (state.idleSince == null) {
        state.idleSince = now;
        crashLogger.breadcrumb(`auto_pause:idle_detected window_ms=${AUTO_PAUSE.IDLE_WINDOW_MS}`);
      }
      const idleFor = now - (state.idleSince ?? now);
      // Prompt after PROMPT_AFTER_MS if not yet prompted.
      if (state.promptedAt == null && idleFor >= AUTO_PAUSE.PROMPT_AFTER_MS) {
        state.promptedAt = now;
        crashLogger.breadcrumb('auto_pause:prompt_sent');
        // Only send notification if app is backgrounded — foreground user is
        // watching, an Alert would be intrusive. Foreground behavior can be
        // extended later.
        if (AppState.currentState !== 'active') {
          void sendPromptNotification();
        }
      }
      // Silent end after AUTO_END_AFTER_MS past prompt.
      if (state.promptedAt != null && now - state.promptedAt >= AUTO_PAUSE.AUTO_END_AFTER_MS) {
        crashLogger.breadcrumb('auto_pause:silent_end');
        try { hooks.onSilentEnd(); } catch { /* swallow */ }
        // Stop monitoring — session is ending.
        stopAutoPauseMonitor();
      }
    } catch { /* swallow */ }
  }, AUTO_PAUSE.EVAL_TICK_MS);
}

export function stopAutoPauseMonitor(): void {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  state.active = false;
  state.idleSince = null;
  state.promptedAt = null;
}


// O1 batch 36: __resetAutoPauseForTest and autoPauseUserContinued removed — 0 external callers.


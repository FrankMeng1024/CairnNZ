/**
 * crashLogger — global JS error handler that captures crashes BEFORE they
 * surface to the native layer.
 *
 * Why: native iOS crash logs (.ips files) only show C++ frames, not JS
 * source. Without this, every crash report is uninterpretable. With this,
 * we capture the JS error + stack + lifecycle context and either:
 *   1. Persist to AsyncStorage under `cairn_last_crash` for next-launch upload
 *   2. On next launch, POST directly to /api/telemetry/sessions as a
 *      synthetic standalone session (bypasses debugLogger which only flushes
 *      when a tracking session ends — which doesn't happen for a sign-out
 *      crash, etc.)
 *
 * Triggers:
 *   - Uncaught JS exceptions: ErrorUtils.setGlobalHandler
 *   - Unhandled promise rejections: process listener
 *
 * Setup: call install() once at App.tsx top level. Call uploadCrashIfAny()
 * during boot (App.tsx useEffect).
 */
import { Platform } from 'react-native';
import { storage } from '../store/storage';

const CRASH_KEY = 'cairn_last_crash';

interface CrashReport {
  ts: number;
  type: 'js_error' | 'unhandled_rejection';
  message: string;
  stack: string;
  isFatal?: boolean;
  appState?: string;
  reactNativeVersion?: string;
  lastEvents?: string[];
}

// Module-level ring buffer — captures last N events even if logger session is off.
// v29 raised from 20 → 500 because AR debugging needs a wide window: GPS-driven
// populate cycles and per-frame samples otherwise drown out the buildCairn /
// populate:add breadcrumbs that pinpoint a bug.
let recentEvents: string[] = [];
const MAX_RECENT = 500;

function recordRecent(line: string): void {
  recentEvents.push(`${new Date().toISOString()} ${line}`);
  if (recentEvents.length > MAX_RECENT) recentEvents.shift();
}

async function persistCrash(report: CrashReport): Promise<void> {
  try {
    await storage.setItem(CRASH_KEY, JSON.stringify(report));
  } catch {
    /* nothing more we can do */
  }
}

/**
 * Build a synthetic single-event JSONL session that the existing
 * /api/telemetry/sessions endpoint accepts.
 */
function buildCrashJsonl(report: CrashReport): { sessionId: string; jsonl: string } {
  // Generate a session_id that's clearly a crash report
  const sessionId = `crash-${report.ts}-${Math.random().toString(36).slice(2, 10)}`;
  const event = {
    ts: report.ts,
    session_id: sessionId,
    event: 'crash',
    type: report.type,
    message: report.message,
    stack: report.stack,
    is_fatal: report.isFatal ?? true,
    rn_version: report.reactNativeVersion,
    breadcrumbs: report.lastEvents ?? [],
  };
  return { sessionId, jsonl: JSON.stringify(event) };
}

export const crashLogger = {
  /**
   * Install global error + rejection handlers. Idempotent.
   */
  install(): void {
    if ((global as any).__cairnCrashLoggerInstalled) return;
    (global as any).__cairnCrashLoggerInstalled = true;

    // 1. Uncaught JS exceptions
    const ErrorUtils = (global as any).ErrorUtils;
    if (ErrorUtils && typeof ErrorUtils.setGlobalHandler === 'function') {
      const prevHandler = ErrorUtils.getGlobalHandler?.();
      ErrorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
        const report: CrashReport = {
          ts: Date.now(),
          type: 'js_error',
          message: error?.message ?? String(error),
          stack: error?.stack ?? 'no stack',
          isFatal,
          reactNativeVersion: Platform.constants?.reactNativeVersion
            ? JSON.stringify(Platform.constants.reactNativeVersion)
            : undefined,
          lastEvents: [...recentEvents],
        };
        // Persist FIRST (sync-ish via Promise — RN may still kill us mid-flight,
        // but AsyncStorage on iOS uses fast NSUserDefaults for small writes).
        persistCrash(report);
        // Then defer to RN's default handler so the redbox / native crash
        // still surfaces to the user (don't swallow fatal errors).
        if (prevHandler) prevHandler(error, isFatal);
      });
    }

    // 2. Unhandled promise rejections
    const p = (global as any).process;
    if (p && typeof p.on === 'function') {
      p.on('unhandledRejection', (reason: any) => {
        const report: CrashReport = {
          ts: Date.now(),
          type: 'unhandled_rejection',
          message: reason?.message ?? String(reason),
          stack: reason?.stack ?? 'no stack',
          lastEvents: [...recentEvents],
        };
        persistCrash(report);
      });
    }
  },

  /**
   * Add a breadcrumb to the recent-events ring buffer.
   * Call from key user actions (screen navigation, button taps, etc.)
   * so the crash report shows what the user was doing.
   */
  breadcrumb(line: string): void {
    recordRecent(line);
  },

  /**
   * Snapshot of the recent-events ring buffer. Used by debug overlays
   * (e.g. AR diagnostic banner) to surface recent activity in the UI
   * without waiting for a crash to upload.
   */
  getRecent(): string[] {
    return [...recentEvents];
  },

  /**
   * Read & clear the last persisted crash. Call on app startup;
   * if a crash was persisted, send it to backend telemetry.
   */
  async drainLastCrash(): Promise<CrashReport | null> {
    try {
      const raw = await storage.getItem(CRASH_KEY);
      if (!raw) return null;
      const report = JSON.parse(raw) as CrashReport;
      await storage.removeItem(CRASH_KEY);
      return report;
    } catch {
      return null;
    }
  },

  /**
   * v163: read AsyncStorage 'cairn_v163_last_step' and upload as a
   * synthetic crash report if it exists. Set by ViroARRitualOverlay
   * before each shader-material registration. If the previous launch
   * died mid-loop, this key tells us exactly which step was running
   * when the native renderer brought the process down.
   *
   * Call from App.tsx boot, after uploadCrashIfAny.
   */
  async uploadV163CheckpointIfAny(apiBaseUrl: string): Promise<void> {
    try {
      const raw = await storage.getItem('cairn_v163_last_step');
      if (!raw) return;
      // Don't double-upload — clear it.
      await storage.removeItem('cairn_v163_last_step');
      // Successful completion is also stored; only treat 'about-to' as crash.
      const isCrashCheckpoint = raw.startsWith('about-to-');
      const sessionId = `v163-${isCrashCheckpoint ? 'CRASH' : 'OK'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const ts = Date.now();
      const event = JSON.stringify({
        ts,
        session_id: sessionId,
        event: 'v163_checkpoint',
        checkpoint: raw,
        is_crash: isCrashCheckpoint,
      });
      const url = apiBaseUrl.replace(/\/$/, '') + '/api/telemetry/sessions';
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-ndjson',
          'X-Cairn-Device-Os': 'ios',
          'X-Cairn-App-Version': '0.2.0',
          'X-Cairn-Activity-Mode': 'v163-checkpoint',
          'X-Cairn-Started-At': String(ts),
          'X-Cairn-Ended-At': String(ts),
        },
        body: event,
      }).catch(() => {});
      console.warn('[crashLogger] v163 checkpoint uploaded:', sessionId, raw);
    } catch {
      /* swallow */
    }
  },

  /**
   * Drain any persisted crash and POST it directly to backend telemetry.
   * Bypasses debugLogger / session lifecycle (which only flush on tracking
   * end). Best-effort: silently swallows network errors so app boot is
   * never blocked.
   */
  async uploadCrashIfAny(apiBaseUrl: string): Promise<void> {
    try {
      const report = await this.drainLastCrash();
      if (!report) return;
      const { sessionId, jsonl } = buildCrashJsonl(report);
      const url = apiBaseUrl.replace(/\/$/, '') + '/api/telemetry/sessions';
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-ndjson',
          'X-Cairn-Device-Os': 'ios',
          'X-Cairn-App-Version': '0.2.0',
          'X-Cairn-Activity-Mode': 'crash',
          'X-Cairn-Started-At': String(report.ts),
          'X-Cairn-Ended-At': String(report.ts),
        },
        body: jsonl,
      }).catch(() => { /* swallow — already persisted is gone, but next crash will try again */ });
      // eslint-disable-next-line no-console
      console.warn('[crashLogger] uploaded crash report:', sessionId, report.message);
    } catch {
      /* swallow */
    }
  },

  /**
   * Proactively upload current breadcrumb buffer as a diagnostic snapshot.
   * Bypasses the crash flow — no error is required, no persistence happens.
   * Used by AR screen to send recent activity for live debugging without
   * waiting for a crash. Session is tagged with `diag-{tag}-{ts}` and
   * activity_mode='diagnostic' so it's easy to filter on the backend.
   *
   * Best-effort, fire-and-forget. Returns the session_id used so the caller
   * can show it on screen (so the user can tell the operator which one to look at).
   */
  async uploadDiagnostic(apiBaseUrl: string, tag: string): Promise<string> {
    const ts = Date.now();
    const sessionId = `diag-${tag}-${ts}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const events = recentEvents.map((line) => {
        // Parse "ISO breadcrumb-text" → structured event
        const m = line.match(/^([\d-]+T[\d:.]+Z)\s+(.+)$/);
        if (m) {
          return JSON.stringify({
            ts: new Date(m[1]).getTime(),
            session_id: sessionId,
            event: 'breadcrumb',
            message: m[2],
          });
        }
        return JSON.stringify({
          ts,
          session_id: sessionId,
          event: 'breadcrumb',
          message: line,
        });
      });
      // Header event (so first JSONL line carries session_id even if events is empty)
      const headerEvent = JSON.stringify({
        ts,
        session_id: sessionId,
        event: 'diagnostic_header',
        tag,
        breadcrumb_count: events.length,
      });
      const body = [headerEvent, ...events].join('\n');
      const url = apiBaseUrl.replace(/\/$/, '') + '/api/telemetry/sessions';
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-ndjson',
          'X-Cairn-Device-Os': 'ios',
          'X-Cairn-App-Version': '0.2.0',
          'X-Cairn-Activity-Mode': 'diagnostic',
          'X-Cairn-Started-At': String(ts),
          'X-Cairn-Ended-At': String(ts),
        },
        body,
      }).catch(() => { /* swallow */ });
      // eslint-disable-next-line no-console
      console.warn('[crashLogger] uploaded diagnostic:', sessionId);
    } catch {
      /* swallow */
    }
    return sessionId;
  },
};


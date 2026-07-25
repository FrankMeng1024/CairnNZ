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
import * as Application from 'expo-application';
import { storage } from '../store/storage';

// v224 — single source of truth for the IPA's native binary version.
// expo-application reads CFBundleShortVersionString (iOS) at IPA-build time
// and is IMMUTABLE across OTA bundles. Do NOT use Constants.expoConfig.version
// here — that value is JS-bundle-time, so a v0.2.2 IPA running an OTA bundle
// built when app.json said 0.2.0 would report "0.2.0" (which is exactly the
// v0.2.2 telemetry symptom we're fixing).
const APP_VERSION_HEADER = Application.nativeApplicationVersion ?? 'unknown';

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
    // Sprint 72 STORY-00557: expose breadcrumb ring to Playwright on web.
    // Guarded to Platform.OS==='web' so native iOS/Android production builds
    // never leak recentEvents onto window. Playwright runs against `--no-dev`
    // builds where __DEV__ is false, so we deliberately do NOT gate on __DEV__.
    try {
      if (Platform.OS === 'web' && typeof globalThis !== 'undefined') {
        (globalThis as unknown as { __cairnBreadcrumbs?: string[] }).__cairnBreadcrumbs = recentEvents;
      }
    } catch { /* ignore */ }
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

  // O1: uploadV163CheckpointIfAny removed — v163 AR shader checkpoint
  // 逻辑,ViroARRitualOverlay 早被 v417 移除,setter 从此不存在,
  // AsyncStorage 'cairn_v163_last_step' 永远读到 null。每次 boot 死跑
  // storage.getItem() + early return,浪费一次 IO。

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
          'X-Cairn-App-Version': APP_VERSION_HEADER,
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
          'X-Cairn-App-Version': APP_VERSION_HEADER,
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


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
import { BUILD_HASH } from '../constants/buildHash';

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
// v29 raised from 20 → 500: GPS-driven populate cycles and per-frame samples
// otherwise drown out the buildCairn / populate:add breadcrumbs that pinpoint a bug.
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

  // O1 batch 37: getRecent removed — 0 external callers (debug overlay was never wired up).

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

  // O1: uploadV163CheckpointIfAny removed — v163 shader checkpoint
  // AsyncStorage 'cairn_v163_last_step' was never written after v417;
  // reader was a dead boot-time IO round-trip.

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
      // Sprint 6 round-24 R24: include X-API-Key when configured in
      // settings. Same rationale as telemetryUploader.ts fix — a
      // future coordinated Sprint will enable server-side key enforcement,
      // and by that time this header must already be shipping in the
      // client. Header omitted when key isn't configured, matching the
      // server-side pass-through behavior today.
      const crashHeaders: Record<string, string> = {
        'Content-Type': 'application/x-ndjson',
        'X-Cairn-Device-Os': 'ios',
        'X-Cairn-App-Version': APP_VERSION_HEADER,
        'X-Cairn-Build-Hash': BUILD_HASH,
        'X-Cairn-Activity-Mode': 'crash',
        'X-Cairn-Started-At': String(report.ts),
        'X-Cairn-Ended-At': String(report.ts),
      };
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { useSettingsStore } = require('../store/useSettingsStore');
        const key = useSettingsStore.getState().telemetryApiKey;
        if (key) crashHeaders['X-API-Key'] = key;
      } catch { /* silent — settings store not loaded during crash boot */ }
      await fetch(url, {
        method: 'POST',
        headers: crashHeaders,
        body: jsonl,
      }).catch(() => { /* swallow — already persisted is gone, but next crash will try again */ });
      // eslint-disable-next-line no-console
      console.warn('[crashLogger] uploaded crash report:', sessionId, report.message);
    } catch {
      /* swallow */
    }
  },

  // O1 batch 37: uploadDiagnostic removed — 0 external callers (debug screen was never wired up).

  /**
   * R100 (2026-08-05) — boot-ok snapshot upload.
   *
   * Fires once per app lifetime after the user successfully reaches Home.
   * Uploads the same shape as a crash report but with type='boot_ok', so
   * we can validate that:
   *   1. The bundle currently running is the one we just pushed (BUILD_HASH)
   *   2. The full auth → hydrate → Home flow completed without a crash
   *   3. Recent breadcrumbs from any tested user flow reach the server
   *      even when no crash occurs (e.g. user says "I tested Memory tab
   *      and everything worked" — we still get their breadcrumb trail)
   *
   * Debounced by a module flag + AsyncStorage key so we don't spam the
   * server on every foreground/background cycle. Cold boot resets the
   * in-memory flag; AsyncStorage `cairn_boot_ok_uploaded_ts` prevents
   * repeat uploads within the same 60min window unless forced.
   *
   * force=true bypasses the debounce — call this from a "Report status"
   * button if we ever add one.
   */
  async uploadBootSnapshot(apiBaseUrl: string, reason: string, opts?: { force?: boolean }): Promise<void> {
    try {
      const force = opts?.force === true;
      if (!force) {
        // Module-level flag: only once per app lifetime by default.
        if ((global as any).__cairnBootOkUploaded) return;
      }

      // Set flag BEFORE await so re-renders during in-flight fetch don't
      // fire a 2nd upload. On failure we clear it back so a next-tick retry
      // can attempt. (Subagent Arch review 2026-08-05 R100 issue #1.)
      (global as any).__cairnBootOkUploaded = true;

      const ts = Date.now();
      const sessionId = `boot-ok-${ts}-${Math.random().toString(36).slice(2, 10)}`;
      const event = {
        ts,
        session_id: sessionId,
        event: 'boot_ok',
        reason,
        build_hash: BUILD_HASH,
        breadcrumbs: [...recentEvents],
      };
      const jsonl = JSON.stringify(event);

      const url = apiBaseUrl.replace(/\/$/, '') + '/api/telemetry/sessions';
      const headers: Record<string, string> = {
        'Content-Type': 'application/x-ndjson',
        'X-Cairn-Device-Os': Platform.OS,
        'X-Cairn-App-Version': APP_VERSION_HEADER,
        'X-Cairn-Build-Hash': BUILD_HASH,
        'X-Cairn-Activity-Mode': 'boot_ok',
        'X-Cairn-Started-At': String(ts),
        'X-Cairn-Ended-At': String(ts),
      };
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { useSettingsStore } = require('../store/useSettingsStore');
        const key = useSettingsStore.getState().telemetryApiKey;
        if (key) headers['X-API-Key'] = key;
      } catch { /* silent */ }

      await fetch(url, { method: 'POST', headers, body: jsonl })
        .then(() => {
          // eslint-disable-next-line no-console
          console.warn('[crashLogger] uploaded boot-ok snapshot:', sessionId, reason);
        })
        .catch(() => {
          // Clear the flag so a subsequent retry (e.g. next Home render) can
          // attempt the upload. Note: with debounce-before-await this only
          // grants a retry AFTER the failed attempt returns; concurrent
          // renders during the failed fetch will still see the flag as true
          // and skip. That's acceptable — we don't spam on transient failures.
          (global as any).__cairnBootOkUploaded = false;
        });
    } catch {
      /* swallow — best effort */
      (global as any).__cairnBootOkUploaded = false;
    }
  },
};


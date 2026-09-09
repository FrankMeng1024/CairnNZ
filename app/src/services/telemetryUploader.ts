/**
 * TelemetryUploader — auto-upload session JSONL to backend.
 *
 * Triggers:
 *   - On session end (debugLogger.endSession)
 *   - On network online (retry queue)
 *   - On manual user request (DebugScreen "Re-upload")
 *
 * Behavior:
 *   - Reads telemetryUploadEnabled / telemetryWifiOnly / telemetryBackendUrl /
 *     telemetryApiKey from useSettingsStore
 *   - WiFi-only mode: defers upload until WiFi available
 *   - Failure: marks session as un-uploaded, retries on next online event
 *   - Idempotent: backend uses ON DUPLICATE KEY UPDATE so re-uploads are safe
 *
 * Web fallback: no-op.
 */
import { Platform, AppState, type AppStateStatus } from 'react-native';
import * as Application from 'expo-application';
import { debugLogger } from './debugLogger';
import { networkMonitor } from './networkMonitor';
import { useSettingsStore } from '../store/useSettingsStore';
import type { SessionMetadata, DeviceInfo } from '../types/debugLog';
import { getToken } from './tokenStore';
import { sanitizeTelemetryJsonlForUpload } from './telemetryPrivacy';

export type UploadResult =
  | { ok: true; sessionId: string; bytes: number }
  | { ok: false; sessionId: string; error: string; retryable: boolean };

class TelemetryUploader {
  private uploadInProgress = new Set<string>();
  private networkUnsub: (() => void) | null = null;
  private appStateSub: { remove: () => void } | null = null;

  /**
   * Initialize: subscribe to network online + app foreground to auto-retry.
   * Call once at app start.
   */
  init(): void {
    if (this.networkUnsub) return;
    this.networkUnsub = networkMonitor.onChange((state) => {
      if (state.state === 'online' && (!this.requireWifi() || state.type === 'wifi')) {
        this.retryAll().catch(() => {});
        void import('../features/activitySimulator/simulatorLog')
          .then(module => module.retryPendingQaTelemetryUploads())
          .catch(() => {});
      }
    });
    // Foreground trigger: when user returns to the app, flush any pending
    // uploads that accumulated while backgrounded. This catches sessions
    // that ended while the network listener was inactive (e.g. iOS suspend).
    this.appStateSub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active' &&
          networkMonitor.isOnline() &&
          (!this.requireWifi() || networkMonitor.isWifi())) {
        this.retryAll().catch(() => {});
        void import('../features/activitySimulator/simulatorLog')
          .then(module => module.retryPendingQaTelemetryUploads())
          .catch(() => {});
      }
    });
    // Also retry on init in case the app starts up with sessions waiting
    // and we're already online (no state change to trigger the listener).
    setTimeout(() => {
      if (networkMonitor.isOnline() && (!this.requireWifi() || networkMonitor.isWifi())) {
        this.retryAll().catch(() => {});
        void import('../features/activitySimulator/simulatorLog')
          .then(module => module.retryPendingQaTelemetryUploads())
          .catch(() => {});
      }
    }, 5_000); // small delay so settings hydration completes first
  }

  shutdown(): void {
    if (this.networkUnsub) {
      this.networkUnsub();
      this.networkUnsub = null;
    }
    if (this.appStateSub) {
      try { this.appStateSub.remove(); } catch { /* no-op */ }
      this.appStateSub = null;
    }
  }

  /**
   * Upload a single session by ID. Idempotent.
   * Returns immediately if upload is already in progress for this session.
   */
  async upload(sessionId: string): Promise<UploadResult> {
    if (this.uploadInProgress.has(sessionId)) {
      return { ok: false, sessionId, error: 'Upload already in progress', retryable: false };
    }

    const settings = useSettingsStore.getState();
    if (!settings.telemetryUploadEnabled) {
      return { ok: false, sessionId, error: 'Upload disabled in settings', retryable: false };
    }

    const backendUrl = this.getBackendUrl();
    if (!backendUrl) {
      return { ok: false, sessionId, error: 'No backend URL configured', retryable: true };
    }

    // WiFi gate
    if (settings.telemetryWifiOnly && !networkMonitor.isWifi()) {
      return { ok: false, sessionId, error: 'WiFi-only mode: waiting for WiFi', retryable: true };
    }

    // Online gate
    if (!networkMonitor.isOnline()) {
      return { ok: false, sessionId, error: 'Offline', retryable: true };
    }

    this.uploadInProgress.add(sessionId);
    try {
      // If user is uploading the *current* active session (rare but possible
      // via DebugScreen), force a flush first so the file on disk is up to date.
      if (sessionId === debugLogger.getCurrentSessionId()) {
        await debugLogger.flush();
      }

      const localJsonl = await debugLogger.readSessionContent(sessionId);
      if (!localJsonl) {
        return { ok: false, sessionId, error: 'Session file not found', retryable: false };
      }
      const jsonl = sanitizeTelemetryJsonlForUpload(localJsonl);
      if (!jsonl) return { ok: false, sessionId, error: 'No safe events to upload', retryable: false };

      // Read metadata to enrich payload
      const metas = await debugLogger.listSessions();
      const meta = metas.find((m) => m.session_id === sessionId);

      const url = `${backendUrl.replace(/\/$/, '')}/api/telemetry/sessions`;

      // Send raw JSONL with device-info encoded into headers so backend can
      // populate the metadata columns even though the body is JSONL.
      // Backend routes/telemetry.js reads X-Cairn-* headers when content-type is x-ndjson.
      const deviceInfo = this.getDeviceInfo();
      // Send either configured operations authentication, the signed-in app
      // credential below, or both. The repository backend accepts uploads
      // through either path and reserves operations credentials for reads.
      const uploadHeaders: Record<string, string> = {
        'Content-Type': 'application/x-ndjson',
        'X-Cairn-Device-Model': deviceInfo.model ?? '',
        'X-Cairn-Device-Os': deviceInfo.os ?? '',
        'X-Cairn-Os-Version': deviceInfo.os_version ?? '',
        'X-Cairn-App-Version': deviceInfo.app_version ?? '',
        'X-Cairn-Build-Number': deviceInfo.build_number ?? '',
        'X-Cairn-Activity-Mode': meta?.activity_mode ?? '',
        'X-Cairn-Started-At': meta?.started_at ? String(meta.started_at) : '',
        'X-Cairn-Ended-At': meta?.ended_at ? String(meta.ended_at) : '',
      };
      if (settings.telemetryApiKey) {
        uploadHeaders['X-API-Key'] = settings.telemetryApiKey;
      }
      const token = await getToken();
      if (token) uploadHeaders.Authorization = `Bearer ${token}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: uploadHeaders,
        body: jsonl,
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => 'unknown');
        const retryable = resp.status >= 500 || resp.status === 0 || resp.status === 408;
        await debugLogger.updateSessionMeta(sessionId, {
          uploaded: false,
          upload_attempts: (meta?.upload_attempts ?? 0) + 1,
          upload_last_error: `HTTP ${resp.status}: ${errText}`,
        });
        return {
          ok: false,
          sessionId,
          error: `HTTP ${resp.status}: ${errText}`,
          retryable,
        };
      }

      const result = await resp.json().catch(() => ({}));
      await debugLogger.updateSessionMeta(sessionId, {
        uploaded: true,
        upload_attempts: (meta?.upload_attempts ?? 0) + 1,
        upload_last_error: undefined,
      });

      return {
        ok: true,
        sessionId,
        bytes: result.bytes ?? jsonl.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const metas = await debugLogger.listSessions().catch(() => []);
      const meta = metas.find((m) => m.session_id === sessionId);
      await debugLogger.updateSessionMeta(sessionId, {
        uploaded: false,
        upload_attempts: (meta?.upload_attempts ?? 0) + 1,
        upload_last_error: message,
      });
      return {
        ok: false,
        sessionId,
        error: message,
        retryable: true,
      };
    } finally {
      this.uploadInProgress.delete(sessionId);
    }
  }

  /** Upload a bounded live Internal-QA snapshot to the existing endpoint. */
  async uploadQaSession(input: {
    sessionId: string;
    jsonl: string;
    startedAt: number;
    endedAt?: number | null;
  }): Promise<UploadResult> {
    const { sessionId } = input;
    if (this.uploadInProgress.has(sessionId)) {
      return { ok: false, sessionId, error: 'Upload already in progress', retryable: false };
    }
    const settings = useSettingsStore.getState();
    if (!settings.telemetryUploadEnabled) {
      return { ok: false, sessionId, error: 'Internal QA upload is disabled', retryable: false };
    }
    const backendUrl = this.getBackendUrl();
    if (!backendUrl) return { ok: false, sessionId, error: 'No backend URL configured', retryable: true };
    if (settings.telemetryWifiOnly && !networkMonitor.isWifi()) {
      return { ok: false, sessionId, error: 'WiFi-only mode: waiting for WiFi', retryable: true };
    }
    if (!networkMonitor.isOnline()) return { ok: false, sessionId, error: 'Offline', retryable: true };
    const jsonl = sanitizeTelemetryJsonlForUpload(input.jsonl);
    if (!jsonl) return { ok: false, sessionId, error: 'No safe events to upload', retryable: false };
    if (jsonl.length > 512 * 1024) {
      return { ok: false, sessionId, error: 'QA payload exceeds 512 KiB', retryable: false };
    }
    this.uploadInProgress.add(sessionId);
    try {
      const deviceInfo = this.getDeviceInfo();
      const headers: Record<string, string> = {
        'Content-Type': 'application/x-ndjson',
        'X-Cairn-Device-Model': deviceInfo.model ?? '',
        'X-Cairn-Device-Os': deviceInfo.os ?? '',
        'X-Cairn-Os-Version': deviceInfo.os_version ?? '',
        'X-Cairn-App-Version': deviceInfo.app_version ?? '',
        'X-Cairn-Build-Number': deviceInfo.build_number ?? '',
        'X-Cairn-Activity-Mode': 'qa_activity',
        'X-Cairn-Started-At': String(input.startedAt),
        'X-Cairn-Ended-At': input.endedAt ? String(input.endedAt) : '',
      };
      if (settings.telemetryApiKey) headers['X-API-Key'] = settings.telemetryApiKey;
      const token = await getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetch(`${backendUrl.replace(/\/$/, '')}/api/telemetry/sessions`, {
        method: 'POST',
        headers,
        body: jsonl,
      });
      if (!response.ok) {
        const message = await response.text().catch(() => 'unknown');
        return {
          ok: false,
          sessionId,
          error: `HTTP ${response.status}: ${message}`,
          retryable: response.status >= 500 || response.status === 0 || response.status === 408 || response.status === 429,
        };
      }
      const result = await response.json().catch(() => ({}));
      return { ok: true, sessionId, bytes: result.bytes ?? jsonl.length };
    } catch (error) {
      return {
        ok: false,
        sessionId,
        error: error instanceof Error ? error.message : String(error),
        retryable: true,
      };
    } finally {
      this.uploadInProgress.delete(sessionId);
    }
  }

  /**
   * Retry all sessions that have failed or never been uploaded.
   * Skips sessions that have already failed > MAX_AUTO_RETRIES times — those
   * require manual re-upload via DebugScreen so we don't spam the backend.
   */
  async retryAll(): Promise<UploadResult[]> {
    const MAX_AUTO_RETRIES = 20;
    const sessions = await debugLogger.listSessions();
    const pending = sessions.filter(
      (s) =>
        !s.uploaded &&
        s.ended_at !== null &&
        (s.upload_attempts ?? 0) < MAX_AUTO_RETRIES,
    );
    const results: UploadResult[] = [];
    for (const s of pending) {
      const r = await this.upload(s.session_id);
      results.push(r);
    }
    return results;
  }

  /**
   * Get device info for upload payload.
   */
  getDeviceInfo(): DeviceInfo {
    return {
      model: Application.nativeApplicationVersion ? 'iOS-or-Android' : null, // best effort; refined below
      os: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web',
      os_version: Platform.Version != null ? String(Platform.Version) : null,
      app_version: Application.nativeApplicationVersion ?? null,
      build_number: Application.nativeBuildVersion ?? null,
    };
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private getBackendUrl(): string {
    const settings = useSettingsStore.getState();
    // 1. User-overridden URL (DebugScreen) wins
    if (settings.telemetryBackendUrl) return settings.telemetryBackendUrl;
    // 2. Fall back to dedicated telemetry backend env (rare — usually unset)
    const tel = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').trim();
    if (tel) return tel;
    // 3. Default to the same backend the app talks to for everything else.
    //    Telemetry shares /api/telemetry/sessions on the main backend.
    const api = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').trim();
    return api;
  }

  private requireWifi(): boolean {
    return useSettingsStore.getState().telemetryWifiOnly;
  }
}

export const telemetryUploader = new TelemetryUploader();
export default telemetryUploader;

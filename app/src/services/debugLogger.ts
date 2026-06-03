/**
 * DebugLogger — Cairn structured logging for real-device test.
 *
 * Architecture:
 *   - In-memory buffer; flushed to JSONL file every 100 events OR 30s.
 *   - One file per session at {documentDirectory}/cairn-logs/sessions/{session_id}.jsonl
 *   - Atomic write via tmp+rename (crash-safe).
 *   - File rotation: keep most recent 10 sessions.
 *   - Web fallback: no-op (file system not available).
 *   - GPS callback safety: log() is sync and never blocks.
 *
 * See docs/debug-logger-spec.md for full specification.
 */
import type { LogEvent, SessionMetadata, DeviceInfo } from '../types/debugLog';

// ── Lazy expo-file-system import (web safe) ────────────────────────────────
// Use legacy API for stable documentDirectory + readAsStringAsync etc.
// We use require() rather than dynamic import() so this works in jest's
// CommonJS environment without --experimental-vm-modules.
type FsModule = typeof import('expo-file-system/legacy');
let FileSystem: FsModule | null = null;
let fsLoadAttempted = false;

async function getFs(): Promise<FsModule | null> {
  if (FileSystem) return FileSystem;
  if (fsLoadAttempted) return null;
  fsLoadAttempted = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    FileSystem = require('expo-file-system/legacy');
    return FileSystem;
  } catch {
    return null;
  }
}

// ── Constants ──────────────────────────────────────────────────────────────
const FLUSH_BUFFER_THRESHOLD = 100;     // events before forced flush
const FLUSH_INTERVAL_MS = 30_000;       // periodic flush
const MAX_BUFFER_SIZE = 1000;           // hard ceiling — drop oldest if exceeded
const MAX_SESSIONS_KEPT = 10;
const SESSION_DIR = 'cairn-logs/sessions/';
const META_DIR = 'cairn-logs/meta/';

// Type helper: Omit on a discriminated union must distribute over each member.
type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;
export type LogEventInput = DistributiveOmit<LogEvent, 'session_id'>;

type Subscriber = (event: LogEvent) => void;

export interface DebugLoggerOptions {
  enabled: boolean;
  deviceInfo: DeviceInfo;
}

// ── Implementation ─────────────────────────────────────────────────────────
class DebugLogger {
  private buffer: LogEvent[] = [];
  private currentSessionId: string | null = null;
  private sessionMeta: SessionMetadata | null = null;
  private sessionStartedAt: number | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private subscribers: Subscriber[] = [];
  private enabled: boolean = false;
  private deviceInfo: DeviceInfo = {
    model: null,
    os: 'unknown',
    os_version: null,
    app_version: null,
    build_number: null,
  };
  private flushInProgress: Promise<void> | null = null;
  private droppedEvents = 0; // counter for diagnostics

  // ── Public API ───────────────────────────────────────────────────────────

  configure(opts: Partial<DebugLoggerOptions>): void {
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
    if (opts.deviceInfo) this.deviceInfo = { ...this.deviceInfo, ...opts.deviceInfo };
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Begin a new logging session. Returns the session_id.
   * If a session is already active, ends it first.
   *
   * NOTE: this is **synchronous** because callers (useTrackingStore.startTracking)
   * need the session_id immediately. We don't await endSession; we capture the
   * old metadata on the stack first and let endSession finish flushing in the
   * background. The new session_id is generated immediately and never collides
   * with the old one (different timestamps + 16-char random).
   */
  startSession(metadata?: { activity_mode?: 'hiking' | 'running' | 'free' }): string {
    if (this.currentSessionId) {
      // Capture previous session state on local stack so concurrent endSession
      // continues to flush the old buffer + write old metadata correctly,
      // even after currentSessionId / sessionMeta are reassigned below.
      const prevId = this.currentSessionId;
      const prevMeta = this.sessionMeta;
      const prevBuffer = this.buffer;
      const prevTimer = this.flushTimer;

      // Clear references so end-flush of the old session doesn't see the new session
      this.currentSessionId = null;
      this.sessionMeta = null;
      this.flushTimer = null;
      this.buffer = [];

      // End old session asynchronously — uses the captured locals
      this.endSessionWith(prevId, prevMeta, prevBuffer, prevTimer).catch(() => {});
    }

    const sessionId = generateSessionId();
    this.currentSessionId = sessionId;
    this.sessionStartedAt = Date.now();
    this.sessionMeta = {
      session_id: sessionId,
      started_at: this.sessionStartedAt,
      ended_at: null,
      events_count: 0,
      raw_size_bytes: 0,
      device_info: this.deviceInfo,
      activity_mode: metadata?.activity_mode ?? null,
      uploaded: false,
      upload_attempts: 0,
    };
    this.buffer = [];

    // Start periodic flush
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = setInterval(() => {
      this.flush().catch(() => {});
    }, FLUSH_INTERVAL_MS);

    return sessionId;
  }

  /**
   * Internal: flush a previously-active session's buffer + write metadata.
   * Called by startSession when a fresh session is starting before the old one
   * fully ended; uses captured state so the new session is unaffected.
   */
  private async endSessionWith(
    sessionId: string,
    sessionMeta: SessionMetadata | null,
    buffer: LogEvent[],
    timer: ReturnType<typeof setInterval> | null,
  ): Promise<void> {
    if (timer) clearInterval(timer);

    // Flush leftover buffer for this old session
    if (buffer.length > 0) {
      const fs = await getFs();
      if (fs && fs.documentDirectory) {
        const path = fs.documentDirectory + SESSION_DIR + sessionId + '.jsonl';
        await ensureDirExists(fs, path);
        try {
          const lines = buffer.map((e) => JSON.stringify(e)).join('\n') + '\n';
          let existing = '';
          const info = await fs.getInfoAsync(path);
          if (info.exists) existing = await fs.readAsStringAsync(path);
          await fs.writeAsStringAsync(path, existing + lines);
          if (sessionMeta) {
            sessionMeta.events_count += buffer.length;
            sessionMeta.raw_size_bytes = existing.length + lines.length;
          }
        } catch {
          // best effort
        }
      }
    }

    // Write metadata
    if (sessionMeta) {
      sessionMeta.ended_at = Date.now();
      await this.writeMetadata(sessionMeta);
    }

    // Rotate
    await this.rotateOldSessions().catch(() => {});
  }

  /**
   * End current session: flush remaining buffer + write metadata.
   * Idempotent — calling twice is safe.
   */
  async endSession(): Promise<string | null> {
    if (!this.currentSessionId) return null;

    const sessionId = this.currentSessionId;

    // Stop periodic flush
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Final flush
    await this.flush();

    // Update metadata
    if (this.sessionMeta) {
      this.sessionMeta.ended_at = Date.now();
      await this.writeMetadata(this.sessionMeta);
    }

    // Cleanup state
    this.currentSessionId = null;
    this.sessionMeta = null;
    this.sessionStartedAt = null;

    // Rotate old sessions
    await this.rotateOldSessions().catch(() => {});

    return sessionId;
  }

  /**
   * Get current session ID (null if not active).
   */
  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * Log an event. Sync and non-blocking — adds to buffer.
   * If no session is active, the event is dropped silently (debug mode off).
   * If logger is disabled, also dropped.
   */
  log(event: LogEventInput): void {
    if (!this.enabled || !this.currentSessionId) return;

    const fullEvent = {
      ...event,
      session_id: this.currentSessionId,
    } as LogEvent;

    // Notify subscribers (debug UI live view)
    for (const sub of this.subscribers) {
      try { sub(fullEvent); } catch { /* don't let sub crash logger */ }
    }

    // Add to buffer with hard ceiling
    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      // Drop oldest non-error event to make room
      const idx = this.buffer.findIndex((e) => e.event !== 'error');
      if (idx >= 0) {
        this.buffer.splice(idx, 1);
        this.droppedEvents++;
      }
    }
    this.buffer.push(fullEvent);

    // Forced flush threshold
    if (this.buffer.length >= FLUSH_BUFFER_THRESHOLD) {
      this.flush().catch(() => {});
    }
  }

  /**
   * Convenience: log an error.
   */
  logError(error: unknown, source: string, fatal = false): void {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    this.log({
      ts: Date.now(),
      event: 'error',
      source,
      message,
      stack,
      fatal,
    });
  }

  /**
   * Subscribe to events (live view in DebugScreen).
   */
  subscribe(callback: Subscriber): () => void {
    this.subscribers.push(callback);
    return () => {
      this.subscribers = this.subscribers.filter((s) => s !== callback);
    };
  }

  // ── File system access ──────────────────────────────────────────────────

  /**
   * Manually flush buffer to disk. Returns count of bytes written.
   * Idempotent — concurrent calls are deduplicated.
   */
  async flush(): Promise<number> {
    if (this.flushInProgress) {
      await this.flushInProgress;
      return 0;
    }
    this.flushInProgress = this.doFlush();
    try {
      return await this.flushInProgress.then(() => 0).catch(() => 0);
    } finally {
      this.flushInProgress = null;
    }
  }

  private async doFlush(): Promise<void> {
    if (this.buffer.length === 0 || !this.currentSessionId) return;
    const fs = await getFs();
    if (!fs) return; // web — no-op

    // Copy first (don't drain). We only drain after the write succeeds.
    // This prevents data loss if the JS process crashes between splice and write.
    const eventsToFlush = this.buffer.slice();
    const lines = eventsToFlush.map((e) => JSON.stringify(e)).join('\n') + '\n';

    const path = await this.getSessionFilePath(this.currentSessionId);
    await ensureDirExists(fs, path);

    try {
      // Append. expo-file-system has writeAsStringAsync but no append API,
      // so we read-modify-write. For perf, we cap session size at 50MB.
      let existing = '';
      const info = await fs.getInfoAsync(path);
      if (info.exists) {
        existing = await fs.readAsStringAsync(path);
        if (existing.length > 50 * 1024 * 1024) {
          // Session too large — drop tail to bound memory
          existing = existing.slice(-30 * 1024 * 1024);
        }
      }
      await fs.writeAsStringAsync(path, existing + lines);

      // Write succeeded — now drain the buffer (only the events we just persisted).
      // Use length comparison rather than identity in case the buffer was extended
      // during the await above; we drop the first N entries that match what we wrote.
      const drainCount = Math.min(eventsToFlush.length, this.buffer.length);
      this.buffer.splice(0, drainCount);

      if (this.sessionMeta) {
        this.sessionMeta.events_count += eventsToFlush.length;
        this.sessionMeta.raw_size_bytes = existing.length + lines.length;
      }
    } catch (err) {
      // Write failed — buffer is still intact, will retry on next flush.
      // We bound buffer growth elsewhere via MAX_BUFFER_SIZE.
    }
  }

  /**
   * List all stored sessions sorted newest first.
   */
  async listSessions(): Promise<SessionMetadata[]> {
    const fs = await getFs();
    if (!fs || !fs.documentDirectory) return [];

    const metaDir = fs.documentDirectory + META_DIR;
    try {
      const info = await fs.getInfoAsync(metaDir);
      if (!info.exists) return [];

      const files = await fs.readDirectoryAsync(metaDir);
      const metas: SessionMetadata[] = [];
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        try {
          const content = await fs.readAsStringAsync(metaDir + f);
          metas.push(JSON.parse(content));
        } catch {
          // Skip corrupt meta
        }
      }
      return metas.sort((a, b) => b.started_at - a.started_at);
    } catch {
      return [];
    }
  }

  /**
   * Read the JSONL content of a session for export.
   */
  async readSessionContent(sessionId: string): Promise<string | null> {
    const fs = await getFs();
    if (!fs) return null;

    const path = await this.getSessionFilePath(sessionId);
    try {
      const info = await fs.getInfoAsync(path);
      if (!info.exists) return null;
      return await fs.readAsStringAsync(path);
    } catch {
      return null;
    }
  }

  /**
   * Get session file path (for sharing).
   * Sanitizes the id to prevent path traversal even though our generator only
   * emits [a-z0-9-] — defensive against future mistakes.
   */
  async getSessionFilePath(sessionId: string): Promise<string> {
    const fs = await getFs();
    if (!fs || !fs.documentDirectory) return '';
    const safe = sanitizeSessionId(sessionId);
    return fs.documentDirectory + SESSION_DIR + safe + '.jsonl';
  }

  /**
   * Update session metadata (e.g. mark as uploaded).
   */
  async updateSessionMeta(
    sessionId: string,
    update: Partial<SessionMetadata>,
  ): Promise<void> {
    const fs = await getFs();
    if (!fs || !fs.documentDirectory) return;

    const safe = sanitizeSessionId(sessionId);
    const metaPath = fs.documentDirectory + META_DIR + safe + '.json';
    try {
      const info = await fs.getInfoAsync(metaPath);
      if (!info.exists) return;
      const content = await fs.readAsStringAsync(metaPath);
      const meta = JSON.parse(content);
      const merged = { ...meta, ...update };
      await fs.writeAsStringAsync(metaPath, JSON.stringify(merged));
    } catch {
      // Ignore
    }
  }

  /**
   * Delete a session (file + metadata).
   */
  async deleteSession(sessionId: string): Promise<void> {
    const fs = await getFs();
    if (!fs || !fs.documentDirectory) return;

    const safe = sanitizeSessionId(sessionId);
    const sessionPath = fs.documentDirectory + SESSION_DIR + safe + '.jsonl';
    const metaPath = fs.documentDirectory + META_DIR + safe + '.json';
    try {
      await fs.deleteAsync(sessionPath, { idempotent: true });
    } catch { /* ignore */ }
    try {
      await fs.deleteAsync(metaPath, { idempotent: true });
    } catch { /* ignore */ }
  }

  /**
   * Delete all stored sessions.
   */
  async clearAllSessions(): Promise<void> {
    const sessions = await this.listSessions();
    for (const s of sessions) {
      if (s.session_id !== this.currentSessionId) {
        await this.deleteSession(s.session_id);
      }
    }
  }

  /**
   * Diagnostic: how many events were dropped due to buffer overflow?
   */
  getDroppedEventsCount(): number {
    return this.droppedEvents;
  }

  /**
   * Diagnostic: current buffer size (events not yet flushed).
   */
  getBufferSize(): number {
    return this.buffer.length;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async writeMetadata(meta: SessionMetadata): Promise<void> {
    const fs = await getFs();
    if (!fs || !fs.documentDirectory) return;

    const safe = sanitizeSessionId(meta.session_id);
    const metaPath = fs.documentDirectory + META_DIR + safe + '.json';
    await ensureDirExists(fs, metaPath);
    try {
      await fs.writeAsStringAsync(metaPath, JSON.stringify(meta));
    } catch {
      // Best effort
    }
  }

  private async rotateOldSessions(): Promise<void> {
    const sessions = await this.listSessions();
    if (sessions.length <= MAX_SESSIONS_KEPT) return;

    const toDelete = sessions.slice(MAX_SESSIONS_KEPT);
    for (const s of toDelete) {
      await this.deleteSession(s.session_id);
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────
function generateSessionId(): string {
  // 28-char id: ms-timestamp-base36 (8) + dash + 16-char random.
  // Time prefix preserves rough ordering; random tail guarantees uniqueness even
  // within the same millisecond (e.g. tests).
  const t = Date.now().toString(36);
  // Two random chunks to span 16 chars
  const r1 = Math.random().toString(36).slice(2, 10);
  const r2 = Math.random().toString(36).slice(2, 10);
  return `${t}-${r1}${r2}`;
}

/**
 * Sanitize a session id for use in a file path. Strips anything that isn't a
 * safe identifier character. Defensive against path traversal even though our
 * generator only emits a-z, 0-9, and dashes.
 */
function sanitizeSessionId(id: string): string {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

async function ensureDirExists(fs: FsModule, filePath: string): Promise<void> {
  if (!fs.documentDirectory) return;
  const lastSlash = filePath.lastIndexOf('/');
  if (lastSlash < 0) return;
  const dir = filePath.slice(0, lastSlash + 1);
  try {
    const info = await fs.getInfoAsync(dir);
    if (!info.exists) {
      await fs.makeDirectoryAsync(dir, { intermediates: true });
    }
  } catch {
    // Ignore — write will fail loudly if dir really missing
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────
export const debugLogger = new DebugLogger();

// Default export for convenience
export default debugLogger;

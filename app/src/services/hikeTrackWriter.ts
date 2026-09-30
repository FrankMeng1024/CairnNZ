import { consumeSnapLabTerminalWalReadFault } from '../features/activitySimulator/snapLabFaultInjection';

/**
 * hikeTrackWriter — v409 独立 hike 磁盘落盘服务
 *
 * Purpose:
 *   - every accepted GPS callback awaits one append-only journal commit
 *   - stopTracking 时 rename 到 completed/ 目录
 *   - hydrate 时可读 tail 恢复未完成 hike
 *
 * Design decisions (see docs/review/free-activity-final):
 *   - Expo FileSystem FileHandle appends without rereading/replacing history
 *   - Crash safety: checksummed records stop at a partial/corrupt tail; legacy
 *     active/next/bak snapshots remain readable for one-time recovery
 *   - 与 debugLogger 完全解耦(独立目录 cairn-hike-tracks/, 独立 gate)
 *   - every accepted point commits immediately; there is no long-lived buffer
 *
 * JSONL v2 schema per line:
 *   { "v": 2, "p": { "t": 1720260000000, "lat": -36.848461,
 *     "lng": 174.763336, "acc": 8.5, "src": "fg|bg|slc|sim", ... },
 *     "c": "fnv1a32" }
 * Existing plain-JSONL records remain readable through the recovery adapter.
 *
 * File layout:
 *   {docDir}/cairn-hike-tracks/
 *     ├── active/{sid}.jsonl
 *     ├── completed/{sid}.jsonl
 *     └── meta/{sid}.json  ({ started_at, remote_id, activity_mode, last_ts, total_points, uploaded })
 *
 * Web/test fallback uses a localStorage-backed append model; native uses a
 * FileHandle opened at EOF so normal commits never reread historical points.
 * Native TaskManager background path (backgroundLocationTask.ts:74) reuses this
 * same file layout via appendDirectlyToHikeTrack().
 */

const HIKE_DIR = 'cairn-hike-tracks/';
const QA_HIKE_DIR = 'cairn-snap-lab/hike-tracks/';

/** Snap Lab identities are deliberately routed to a different filesystem
 * namespace. They can exercise the real WAL implementation without becoming
 * discoverable by ordinary unfinished-Activity recovery or cleanup. */
export function isSnapLabActivityId(sessionId: string): boolean {
  return sessionId.startsWith('qa-snap-');
}

const hikeDirFor = (sessionId: string) => isSnapLabActivityId(sessionId) ? QA_HIKE_DIR : HIKE_DIR;
const activeDirFor = (sessionId: string) => hikeDirFor(sessionId) + 'active/';
const completedDirFor = (sessionId: string) => hikeDirFor(sessionId) + 'completed/';
const metaDirFor = (sessionId: string) => hikeDirFor(sessionId) + 'meta/';
const activePathFor = (fs: any, sessionId: string) => (
  fs.documentDirectory + activeDirFor(sessionId) + sessionId + '.jsonl'
);
const completedPathFor = (fs: any, sessionId: string) => (
  fs.documentDirectory + completedDirFor(sessionId) + sessionId + '.jsonl'
);

const terminalPathFor = (fs: any, sessionId: string) => (
  fs.documentDirectory + metaDirFor(sessionId) + sessionId + '.terminal.json'
);

// Commit policy: flush every accepted point. The former timer/count buffer
// routinely lost an accepted foreground tail on abrupt process death.

export interface HikePoint {
  t: number;
  lat: number;
  lng: number;
  acc?: number | null;
  alt?: number | null;
  speed?: number | null;
  speedAccuracy?: number | null;
  vAcc?: number | null;
  course?: number | null;
  courseAccuracy?: number | null;
  rawOrdinal?: number;
  src?: 'fg' | 'bg' | 'slc' | 'sim';
  conf?: number; // 1=high (GPS), 0.5=low (cell/WiFi), 0=gap fill only
  clientActivityId: string;
  ownerGeneration: string;
  segmentId: string;
  segmentStartReason?: 'start' | 'resume' | 'process-recovery' | 'gps-reacquired' | 'legacy';
}

/**
 * Canonical recovery shape. Storage abbreviations end here; reducers and
 * classifiers must never branch on `acc` versus `accuracy` (RI-1).
 */
export interface CanonicalJournalPoint {
  t: number;
  lat: number;
  lng: number;
  alt: number | null;
  accuracy: number | null;
  verticalAccuracy: number | null;
  speed: number | null;
  speedAccuracy: number | null;
  course: number | null;
  courseAccuracy: number | null;
  rawOrdinal?: number;
  source: 'foreground' | 'background' | 'significant-change' | 'simulator';
  clientActivityId: string;
  ownerGeneration: string;
  segmentId: string;
  segmentStartReason?: 'start' | 'resume' | 'process-recovery' | 'gps-reacquired' | 'legacy';
}

export type HikeTerminalSnapshotUncertainReason =
  | 'storage-unavailable'
  | 'terminal-marker-stat-failed'
  | 'terminal-marker-missing'
  | 'terminal-marker-read-failed'
  | 'terminal-marker-invalid'
  | 'terminal-owner-mismatch'
  | 'terminal-cutoff-mismatch'
  | 'truncation-marker-stat-failed'
  | 'truncation-marker-read-failed'
  | 'truncation-marker-invalid'
  | 'journal-stat-failed'
  | 'journal-missing'
  | 'journal-read-failed'
  | 'journal-corrupt-or-partial'
  | 'journal-session-mismatch'
  | 'journal-after-terminal-cutoff'
  | 'bounded-recovery-incomplete';

/**
 * A Finish caller must never confuse a recoverable prefix with a complete
 * Activity. `readActiveHikeTail` remains deliberately permissive for the
 * unfinished-session UI; this result is the fail-closed terminal authority.
 */
export type HikeTerminalSnapshot =
  | {
    status: 'complete';
    points: CanonicalJournalPoint[];
    source: 'active' | 'bounded-recovery';
    cutoffAt: number;
    ownerGeneration?: string;
  }
  | {
    status: 'uncertain';
    recoverablePoints: CanonicalJournalPoint[];
    reason: HikeTerminalSnapshotUncertainReason;
  };

export interface JournalEfficiencyMetrics {
  /** Checksummed point records committed, including records in native batches. */
  appendCount: number;
  /** Physical EOF write operations; background batches can contain many records. */
  appendOperationCount: number;
  logicalBytes: number;
  actualAppendBytes: number;
  checkpointCount: number;
  checkpointBytes: number;
  totalCommitMs: number;
  maxCommitMs: number;
}

const emptyJournalMetrics = (): JournalEfficiencyMetrics => ({
  appendCount: 0,
  appendOperationCount: 0,
  logicalBytes: 0,
  actualAppendBytes: 0,
  checkpointCount: 0,
  checkpointBytes: 0,
  totalCommitMs: 0,
  maxCommitMs: 0,
});
let journalMetrics = emptyJournalMetrics();

export function resetJournalEfficiencyMetrics(): void {
  journalMetrics = emptyJournalMetrics();
}

export function getJournalEfficiencyMetrics(): JournalEfficiencyMetrics {
  return { ...journalMetrics };
}

/** Deterministic complexity model used by the 30 min / 2 h / 5 h gate. */
export function estimateJournalWriteWork(pointCount: number, recordBytes: number): {
  appendOnlyBytes: number;
  legacySnapshotBytes: number;
} {
  const count = Math.max(0, Math.floor(pointCount));
  const bytes = Math.max(0, Math.floor(recordBytes));
  return {
    appendOnlyBytes: count * bytes,
    legacySnapshotBytes: bytes * count * (count + 1) / 2,
  };
}

export interface HikeMeta {
  session_id: string;
  started_at: number;
  ended_at?: number;
  activity_mode: 'hiking' | 'running';
  user_id?: string;
  owner_generation?: string;
  remote_id?: number;
  last_ts?: number;
  total_points: number;
  uploaded: boolean;
  /** Local-only provider identity used to restore Simulator Activities. */
  location_source?: 'real' | 'simulator';
}

const metaPathFor = (fs: any, sessionId: string) => (
  fs.documentDirectory + metaDirFor(sessionId) + sessionId + '.json'
);

const metaCandidates = (fs: any, sessionId: string): string[] => {
  const base = metaPathFor(fs, sessionId);
  return [base, `${base}.next`, `${base}.bak`];
};

function parseHikeMeta(raw: string, sessionId: string): HikeMeta | null {
  try {
    const parsed = JSON.parse(raw) as HikeMeta;
    if (!parsed
      || parsed.session_id !== sessionId
      || !Number.isFinite(parsed.started_at)
      || (parsed.activity_mode !== 'hiking' && parsed.activity_mode !== 'running')
      || !Number.isFinite(parsed.total_points)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Base is the committed authority; staged/backup candidates recover a torn swap. */
async function readHikeMeta(fs: any, sessionId: string): Promise<HikeMeta> {
  for (const path of metaCandidates(fs, sessionId)) {
    try {
      const parsed = parseHikeMeta(await fs.readAsStringAsync(path), sessionId);
      if (parsed) return parsed;
    } catch { /* try the next crash-recovery candidate */ }
  }
  throw new Error('activity_meta_unavailable');
}

interface HikeTerminalMarker {
  v: 1;
  session_id: string;
  owner_generation?: string;
  cutoff_at: number;
}

async function readTerminalMarker(fs: any, sessionId: string): Promise<HikeTerminalMarker | null> {
  const base = terminalPathFor(fs, sessionId);
  for (const path of [base, `${base}.next`]) {
    try {
      const parsed = JSON.parse(await fs.readAsStringAsync(path));
      if (parsed?.v === 1 && parsed.session_id === sessionId && Number.isFinite(parsed.cutoff_at)) {
        return parsed as HikeTerminalMarker;
      }
    } catch { /* absent or an interrupted staging write */ }
  }
  return null;
}

/**
 * Cross-runtime Finish fence. TaskManager may run in another JS runtime, so a
 * module Promise is not ownership. The verified marker is the linearization
 * point consulted again at the background journal commit boundary.
 */
export async function sealHikeTrackForFinish(
  sessionId: string,
  ownerGeneration: string | undefined,
  cutoffAt: number,
): Promise<void> {
  const fs = await getFs();
  if (!fs) return;
  await ensureDirs(fs, sessionId);
  const marker: HikeTerminalMarker = {
    v: 1,
    session_id: sessionId,
    owner_generation: ownerGeneration,
    cutoff_at: cutoffAt,
  };
  const base = terminalPathFor(fs, sessionId);
  const next = `${base}.next`;
  const encoded = JSON.stringify(marker);
  await fs.writeAsStringAsync(next, encoded);
  if (await fs.readAsStringAsync(next) !== encoded) throw new Error('activity_terminal_stage_verify_failed');
  try { await fs.deleteAsync(base, { idempotent: true }); } catch {}
  await fs.moveAsync({ from: next, to: base });
  const committed = await readTerminalMarker(fs, sessionId);
  if (!committed || committed.cutoff_at !== cutoffAt) throw new Error('activity_terminal_commit_verify_failed');
}

/**
 * Abort a Finish fence that never acquired a durable completion authority.
 * This is intentionally narrower than deleting Activity data: it only removes
 * the matching terminal lease while the journal is still active, metadata is
 * non-terminal, and no completed journal exists. A completed/mismatched owner
 * can therefore never be reopened by an error-recovery path.
 */
export async function releaseHikeTrackFinishSeal(
  sessionId: string,
  expectedOwnerGeneration?: string,
  options: { shouldContinue?: () => boolean } = {},
): Promise<boolean> {
  const fs = await getFs();
  if (options.shouldContinue && !options.shouldContinue()) return false;
  if (!fs) return true;
  await ensureDirs(fs, sessionId);
  await flushChainTail.catch(() => {});
  await durableWriteTail.catch(() => {});
  if (options.shouldContinue && !options.shouldContinue()) return false;
  const marker = await readTerminalMarker(fs, sessionId);
  if (!marker) return true;
  if (expectedOwnerGeneration && marker.owner_generation
    && marker.owner_generation !== expectedOwnerGeneration) return false;
  try {
    const meta = await readHikeMeta(fs, sessionId);
    if (options.shouldContinue && !options.shouldContinue()) return false;
    if (meta.ended_at) return false;
    if (expectedOwnerGeneration && meta.owner_generation
      && meta.owner_generation !== expectedOwnerGeneration) return false;
  } catch {
    // Missing/corrupt ownership metadata is preserved for support rather than
    // guessing that this terminal marker belongs to the mounted Activity.
    return false;
  }
  try {
    if ((await fs.getInfoAsync(completedPathFor(fs, sessionId))).exists) {
      return false;
    }
  } catch { return false; }
  if (options.shouldContinue && !options.shouldContinue()) return false;
  const terminalPath = terminalPathFor(fs, sessionId);
  await deleteAndVerifyAbsent(fs, terminalPath);
  await deleteAndVerifyAbsent(fs, `${terminalPath}.next`);
  return (await readTerminalMarker(fs, sessionId)) === null;
}

interface WriterState {
  sessionId: string;
  buffer: HikePoint[];
  totalPoints: number;
  lastFlushError: string | null;
}

let state: WriterState | null = null;
let durableWriteTail: Promise<void> = Promise.resolve();

/**
 * Dynamic import expo-file-system/legacy — same pattern as
 * backgroundLocationTask.ts. Falls back to localStorage-backed shim on
 * web where expo-file-system is not available. Native iOS/Android always
 * uses the real fs.
 *
 * v409 Playwright web coverage: the localStorage shim lets us test disk
 * write / read / listActiveHikes / cache clean on web without shipping
 * anything native-affecting (Platform.OS !== 'web' → real fs unchanged).
 */
async function getFs(): Promise<any | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const legacy = await import('expo-file-system/legacy');
    if (legacy && legacy.documentDirectory) return legacy;
  } catch {
    /* fallthrough to web shim */
  }
  // Web fallback: localStorage-backed shim. Keyspace: 'cairn-fs://<path>'.
  // Only activated when real fs unavailable (web browser). Native RN always
  // returns the real fs above. Testing-only path.
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    const PREFIX = 'cairn-fs://';
    const docDir = PREFIX;
    const appendCountKey = (path: string) => `${path}::__append_count__`;
    const appendChunkKey = (path: string, index: number) => `${path}::__append__:${index}`;
    const appendCount = (path: string) => Number(window.localStorage.getItem(appendCountKey(path)) ?? '0') || 0;
    const clearAppendChunks = (path: string) => {
      const count = appendCount(path);
      for (let index = 0; index < count; index += 1) {
        window.localStorage.removeItem(appendChunkKey(path, index));
      }
      window.localStorage.removeItem(appendCountKey(path));
    };
    const trackParentFile = (path: string) => {
      const parent = path.substring(0, path.lastIndexOf('/') + 1);
      const listKey = parent + '__files__';
      const raw = window.localStorage.getItem(listKey);
      const list: string[] = raw ? JSON.parse(raw) : [];
      const filename = path.substring(parent.length);
      if (!list.includes(filename)) {
        list.push(filename);
        window.localStorage.setItem(listKey, JSON.stringify(list));
      }
    };
    const shim = {
      documentDirectory: docDir,
      async getInfoAsync(path: string) {
        const raw = window.localStorage.getItem(path);
        // Directory tracking: paths ending in '/' are dirs, tracked as JSON list.
        if (path.endsWith('/')) {
          const dirEntry = window.localStorage.getItem(path + '__dir__');
          return { exists: !!dirEntry, isDirectory: true, uri: path };
        }
        const count = appendCount(path);
        let size = raw?.length ?? 0;
        for (let index = 0; index < count; index += 1) {
          size += window.localStorage.getItem(appendChunkKey(path, index))?.length ?? 0;
        }
        return { exists: raw !== null || count > 0, isDirectory: false, uri: path, size };
      },
      async makeDirectoryAsync(path: string, _opts?: { intermediates?: boolean }) {
        if (!path.endsWith('/')) path = path + '/';
        window.localStorage.setItem(path + '__dir__', '1');
      },
      async writeAsStringAsync(path: string, content: string) {
        clearAppendChunks(path);
        window.localStorage.setItem(path, content);
        // Track parent directory listing so readDirectoryAsync works.
        trackParentFile(path);
      },
      async appendAsStringAsync(path: string, content: string) {
        // localStorage has no native append. Keeping one immutable chunk per
        // QA commit preserves append-only semantics without rewriting the
        // entire journey on every point (which made long Web acceptance runs
        // quadratic). Native continues to use FileHandle EOF writes.
        const snapLabJournal = path.includes(QA_HIKE_DIR);
        const count = appendCount(path);
        const base = window.localStorage.getItem(path);
        // Retain a small directly inspectable prefix. Besides making short QA
        // journals simple to debug, this preserves the web crash/race probes
        // that intercept the ordinary file key. Once bounded, all subsequent
        // commits are immutable O(new-record) chunks.
        // Snap Lab deliberately measures callback work. Its sealed namespace
        // starts immutable chunks at the first point so the Web shim models
        // native EOF append rather than repeatedly rewriting a growing JSONL
        // prefix. Ordinary web crash/race probes retain the inspectable prefix
        // behavior below; native storage is unaffected.
        if (!snapLabJournal && count === 0 && (base?.length ?? 0) + content.length <= 32 * 1024) {
          window.localStorage.setItem(path, (base ?? '') + content);
          trackParentFile(path);
          return;
        }
        window.localStorage.setItem(appendChunkKey(path, count), content);
        window.localStorage.setItem(appendCountKey(path), String(count + 1));
        trackParentFile(path);
      },
      async readAsStringAsync(path: string): Promise<string> {
        const raw = window.localStorage.getItem(path);
        const count = appendCount(path);
        if (raw === null && count === 0) throw new Error('File not found: ' + path);
        let value = raw ?? '';
        for (let index = 0; index < count; index += 1) {
          value += window.localStorage.getItem(appendChunkKey(path, index)) ?? '';
        }
        return value;
      },
      async readSuffixAsStringAsync(path: string, maximumBytes: number): Promise<string> {
        const count = appendCount(path);
        let value = '';
        for (let index = count - 1; index >= 0 && value.length < maximumBytes; index -= 1) {
          value = (window.localStorage.getItem(appendChunkKey(path, index)) ?? '') + value;
        }
        if (value.length < maximumBytes) {
          value = (window.localStorage.getItem(path) ?? '') + value;
        }
        return value.slice(-maximumBytes);
      },
      async readDirectoryAsync(path: string): Promise<string[]> {
        if (!path.endsWith('/')) path = path + '/';
        const raw = window.localStorage.getItem(path + '__files__');
        return raw ? JSON.parse(raw) : [];
      },
      async deleteAsync(path: string, _opts?: { idempotent?: boolean }) {
        clearAppendChunks(path);
        window.localStorage.removeItem(path);
        // Remove from parent listing
        const parent = path.substring(0, path.lastIndexOf('/') + 1);
        const listKey = parent + '__files__';
        const raw = window.localStorage.getItem(listKey);
        if (raw) {
          const list: string[] = JSON.parse(raw);
          const filename = path.substring(parent.length);
          const idx = list.indexOf(filename);
          if (idx >= 0) {
            list.splice(idx, 1);
            window.localStorage.setItem(listKey, JSON.stringify(list));
          }
        }
      },
      async moveAsync(opts: { from: string; to: string }) {
        let raw: string;
        try { raw = await this.readAsStringAsync(opts.from); } catch { return; }
        await this.writeAsStringAsync(opts.to, raw);
        await this.deleteAsync(opts.from);
      },
    };
    return shim;
  }
  return null;
}

async function ensureDirs(fs: any, sessionId = ''): Promise<void> {
  const root = sessionId ? hikeDirFor(sessionId) : HIKE_DIR;
  for (const d of [root, root + 'active/', root + 'completed/', root + 'meta/']) {
    const path = fs.documentDirectory + d;
    try {
      const info = await fs.getInfoAsync(path);
      if (!info.exists) await fs.makeDirectoryAsync(path, { intermediates: true });
    } catch { /* best effort */ }
  }
}

function activeCandidates(basePath: string): string[] {
  return [basePath, `${basePath}.next`, `${basePath}.bak`];
}

const truncationPath = (basePath: string) => `${basePath}.truncate.json`;

function isSaneStoredCoordinate(point: any): boolean {
  return Number.isFinite(point?.t)
    && point.t > 0
    && Number.isFinite(point?.lat)
    && point.lat >= -90
    && point.lat <= 90
    && Number.isFinite(point?.lng)
    && point.lng >= -180
    && point.lng <= 180;
}

type JournalEnvelope = { v: 2; p: HikePoint; c: string };

function checksum(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function encodeJournalPoint(point: HikePoint): string {
  const payload = JSON.stringify(point);
  return JSON.stringify({ v: 2, p: point, c: checksum(payload) } satisfies JournalEnvelope);
}

function decodeJournalLine(line: string): HikePoint | null {
  try {
    const parsed = JSON.parse(line);
    if (parsed?.v === 2) {
      if (!parsed.p || typeof parsed.c !== 'string') return null;
      if (checksum(JSON.stringify(parsed.p)) !== parsed.c) return null;
      return isSaneStoredCoordinate(parsed.p) ? parsed.p : null;
    }
    // Existing unfinished Activities used plain JSONL. Keep the migration
    // read-only and idempotent; all new records use the checksummed envelope.
    return isSaneStoredCoordinate(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function toStoredPoint(point: HikePoint | CanonicalJournalPoint): HikePoint {
  if ('accuracy' in point || 'source' in point) {
    const canonical = point as CanonicalJournalPoint;
    return {
      t: canonical.t,
      lat: canonical.lat,
      lng: canonical.lng,
      acc: canonical.accuracy,
      alt: canonical.alt,
      speed: canonical.speed,
      speedAccuracy: canonical.speedAccuracy,
      vAcc: canonical.verticalAccuracy,
      course: canonical.course,
      courseAccuracy: canonical.courseAccuracy,
      rawOrdinal: canonical.rawOrdinal,
      src: canonical.source === 'simulator'
        ? 'sim'
        : canonical.source === 'background'
          ? 'bg'
          : canonical.source === 'significant-change' ? 'slc' : 'fg',
      conf: 1,
      clientActivityId: canonical.clientActivityId,
      ownerGeneration: canonical.ownerGeneration,
      segmentId: canonical.segmentId,
      segmentStartReason: canonical.segmentStartReason,
    };
  }
  return point as HikePoint;
}

/** The only persisted/raw -> reducer/classifier adapter. */
export function toCanonicalJournalPoint(point: HikePoint, sessionId: string): CanonicalJournalPoint {
  return {
    t: point.t,
    lat: point.lat,
    lng: point.lng,
    alt: point.alt ?? null,
    accuracy: point.acc ?? null,
    verticalAccuracy: point.vAcc ?? null,
    speed: point.speed ?? null,
    speedAccuracy: point.speedAccuracy ?? null,
    course: point.course ?? null,
    courseAccuracy: point.courseAccuracy ?? null,
    rawOrdinal: point.rawOrdinal,
    source: point.src === 'sim'
      ? 'simulator'
      : point.src === 'bg' ? 'background' : point.src === 'slc' ? 'significant-change' : 'foreground',
    clientActivityId: typeof point.clientActivityId === 'string' ? point.clientActivityId : sessionId,
    ownerGeneration: typeof point.ownerGeneration === 'string' ? point.ownerGeneration : 'legacy',
    segmentId: typeof point.segmentId === 'string' ? point.segmentId : 'legacy-0',
    ...(typeof point.segmentStartReason === 'string'
      ? { segmentStartReason: point.segmentStartReason }
      : {}),
  };
}

function utf8Bytes(value: string): Uint8Array {
  // Hermes does not guarantee a global TextEncoder on every supported build.
  const encoded = unescape(encodeURIComponent(value));
  const bytes = new Uint8Array(encoded.length);
  for (let index = 0; index < encoded.length; index += 1) bytes[index] = encoded.charCodeAt(index);
  return bytes;
}

async function readBestSnapshot(fs: any, basePath: string): Promise<string> {
  let maximumLines: number | null = null;
  try {
    const raw = await fs.readAsStringAsync(truncationPath(basePath));
    const value = Number(JSON.parse(raw)?.maximumLines);
    if (Number.isInteger(value) && value >= 0) maximumLines = value;
  } catch { /* no pending crash-safe truncation */ }
  let best = '';
  let bestLines = -1;
  for (const path of activeCandidates(basePath)) {
    try {
      const info = await fs.getInfoAsync(path);
      if (!info.exists) continue;
      const value = await fs.readAsStringAsync(path);
      const valid: string[] = [];
      for (const line of value.split('\n')) {
        if (!line.trim()) continue;
        try {
          const point = decodeJournalLine(line);
          if (!point) break;
          valid.push(line);
        } catch { break; }
      }
      const bounded = maximumLines === null ? valid : valid.slice(0, maximumLines);
      const validLines = bounded.length;
      if (validLines > bestLines) {
        best = bounded.length > 0 ? `${bounded.join('\n')}\n` : '';
        bestLines = validLines;
      }
    } catch { /* try the next crash-recovery candidate */ }
  }
  return best;
}

async function completePendingTruncation(fs: any, basePath: string): Promise<void> {
  let pending = false;
  try {
    pending = (await fs.getInfoAsync(truncationPath(basePath))).exists;
  } catch { /* no pending correction */ }
  if (!pending) return;
  const replacement = await readBestSnapshot(fs, basePath);
  const nextPath = `${basePath}.next`;
  const backupPath = `${basePath}.bak`;
  await fs.writeAsStringAsync(nextPath, replacement);
  if (await fs.readAsStringAsync(nextPath) !== replacement) {
    throw new Error('activity_journal_repair_verification_failed');
  }
  try { await fs.deleteAsync(backupPath, { idempotent: true }); } catch {}
  try {
    if ((await fs.getInfoAsync(basePath)).exists) {
      await fs.moveAsync({ from: basePath, to: backupPath });
    }
  } catch { /* marker still bounds every candidate on retry */ }
  await fs.moveAsync({ from: nextPath, to: basePath });
  try { await fs.deleteAsync(backupPath, { idempotent: true }); } catch {}
  await fs.deleteAsync(truncationPath(basePath), { idempotent: true });
  journalMetrics.checkpointCount += 1;
  journalMetrics.checkpointBytes += utf8Bytes(replacement).length;
}

function decodeUtf8Bytes(bytes: Uint8Array): string {
  let encoded = '';
  for (let index = 0; index < bytes.length; index += 1) encoded += String.fromCharCode(bytes[index]);
  // Journal records contain numeric coordinates and bounded ASCII ids. A
  // suffix can begin midway through an unrelated legacy UTF-8 sequence;
  // callers discard that first partial line.
  return encoded;
}

async function readJournalSuffix(
  fs: any,
  basePath: string,
  maximumBytes: number,
): Promise<{ value: string; beginsMidFile: boolean }> {
  if (typeof fs.readSuffixAsStringAsync === 'function') {
    try {
      const value = await fs.readSuffixAsStringAsync(basePath, maximumBytes);
      return { value, beginsMidFile: value.length >= maximumBytes };
    } catch {
      return { value: '', beginsMidFile: false };
    }
  }
  if (typeof fs.appendAsStringAsync === 'function') {
    try {
      const value = await fs.readAsStringAsync(basePath);
      return { value, beginsMidFile: false };
    } catch {
      return { value: '', beginsMidFile: false };
    }
  }
  try {
    const modern = await import('expo-file-system');
    const handle = new modern.File(basePath).open();
    try {
      const size = handle.size ?? 0;
      if (size <= 0) return { value: '', beginsMidFile: false };
      const offset = Math.max(0, size - maximumBytes);
      handle.offset = offset;
      return {
        value: decodeUtf8Bytes(handle.readBytes(size - offset)),
        beginsMidFile: offset > 0,
      };
    } finally {
      handle.close();
    }
  } catch {
    return { value: '', beginsMidFile: false };
  }
}

/** O(last-record) detection for both torn writes and checksum corruption. */
async function hasInvalidTail(fs: any, basePath: string): Promise<boolean> {
  const { value } = await readJournalSuffix(fs, basePath, 8 * 1024);
  if (!value) return false;
  if (!value.endsWith('\n')) return true;
  const lines = value.split('\n');
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].trim()) continue;
    return decodeJournalLine(lines[index]) === null;
  }
  return false;
}

async function replaceSnapshotWithPrefixUnlocked(
  fs: any,
  basePath: string,
  replacement: string,
  maximumLines: number,
): Promise<void> {
  const nextPath = `${basePath}.next`;
  const backupPath = `${basePath}.bak`;
  // This cap is committed first. If iOS kills the process during the swap,
  // recovery bounds every old/new candidate to the corrected Activity tail.
  await fs.writeAsStringAsync(truncationPath(basePath), JSON.stringify({ maximumLines }));
  await fs.writeAsStringAsync(nextPath, replacement);
  const verified = await fs.readAsStringAsync(nextPath);
  if (verified !== replacement) throw new Error('activity_journal_truncation_verification_failed');
  try { await fs.deleteAsync(backupPath, { idempotent: true }); } catch {}
  try {
    const current = await fs.getInfoAsync(basePath);
    if (current.exists) await fs.moveAsync({ from: basePath, to: backupPath });
  } catch { /* active may already have moved before a process interruption */ }
  await fs.moveAsync({ from: nextPath, to: basePath });
  try { await fs.deleteAsync(backupPath, { idempotent: true }); } catch {}
  await fs.deleteAsync(truncationPath(basePath), { idempotent: true });
  journalMetrics.checkpointCount += 1;
  journalMetrics.checkpointBytes += utf8Bytes(replacement).length;
}

/**
 * Append-only WAL commit. Native FileHandle writes at EOF, so per-fix work is
 * proportional to the new record rather than total Activity history. A torn
 * last write has no newline or checksum-valid envelope and is ignored on
 * recovery; a later append first repairs that bounded tail once.
 */
async function appendSnapshot(fs: any, basePath: string, lines: string): Promise<void> {
  const run = durableWriteTail.then(async () => {
    const commitStartedAt = Date.now();
    // A crash-interrupted QA correction is rare, but it must be completed
    // before append or its durable prefix cap would hide the new record.
    await completePendingTruncation(fs, basePath);
    // A killed process can leave a checksum-incomplete final record. Repair
    // that one exceptional tail before appending so later healthy records do
    // not become unreachable behind it. This is the only O(n) recovery path;
    // ordinary commits inspect one byte and append one record.
    if (await hasInvalidTail(fs, basePath)) {
      const validPrefix = await readBestSnapshot(fs, basePath);
      const validLineCount = validPrefix ? validPrefix.trimEnd().split('\n').length : 0;
      await replaceSnapshotWithPrefixUnlocked(fs, basePath, validPrefix, validLineCount);
    }
    const bytes = utf8Bytes(lines);
    if (typeof fs.appendAsStringAsync === 'function') {
      await fs.appendAsStringAsync(basePath, lines);
    } else {
      const modern = await import('expo-file-system');
      const file = new modern.File(basePath);
      const handle = file.open();
      try {
        handle.offset = handle.size ?? 0;
        handle.writeBytes(bytes);
      } finally {
        handle.close();
      }
    }
    const elapsedMs = Math.max(0, Date.now() - commitStartedAt);
    journalMetrics.appendCount += lines.split('\n').filter(line => line.length > 0).length;
    journalMetrics.appendOperationCount += 1;
    journalMetrics.logicalBytes += bytes.length;
    journalMetrics.actualAppendBytes += bytes.length;
    journalMetrics.totalCommitMs += elapsedMs;
    journalMetrics.maxCommitMs = Math.max(journalMetrics.maxCommitMs, elapsedMs);
  });
  durableWriteTail = run.catch(() => {});
  await run;
}

async function replaceSnapshotWithPrefix(fs: any, basePath: string, replacement: string, maximumLines: number): Promise<void> {
  const run = durableWriteTail.then(async () => {
    await replaceSnapshotWithPrefixUnlocked(fs, basePath, replacement, maximumLines);
  });
  durableWriteTail = run.catch(() => {});
  await run;
}

/**
 * Start writing a new hike track. Called from useTrackingStore.startTracking.
 * Overwrites any prior state — caller must call renameToCompleted() first
 * if a previous session should be preserved.
 */
export async function startHikeTrack(
  sessionId: string,
  meta: Omit<HikeMeta, 'session_id' | 'total_points' | 'uploaded' | 'last_ts'>,
  options: { shouldContinue?: () => boolean } = {},
): Promise<void> {
  const fs = await getFs();
  if (options.shouldContinue && !options.shouldContinue()) throw new Error('activity_owner_changed');
  if (!fs) {
    state = { sessionId, buffer: [], totalPoints: 0, lastFlushError: 'web-no-fs' };
    return;
  }
  await ensureDirs(fs, sessionId);
  if (options.shouldContinue && !options.shouldContinue()) throw new Error('activity_owner_changed');
  // Truncate every crash-recovery snapshot with the same immutable id.
  const activePath = activePathFor(fs, sessionId);
  for (const path of activeCandidates(activePath)) {
    try {
      const info = await fs.getInfoAsync(path);
      if (info.exists) await fs.deleteAsync(path, { idempotent: true });
    } catch { /* best effort */ }
  }
  try { await fs.deleteAsync(truncationPath(activePath), { idempotent: true }); } catch {}
  const terminalPath = terminalPathFor(fs, sessionId);
  for (const path of [terminalPath, `${terminalPath}.next`]) {
    try { await fs.deleteAsync(path, { idempotent: true }); } catch {}
  }
  for (const path of metaCandidates(fs, sessionId)) {
    try { await fs.deleteAsync(path, { idempotent: true }); } catch {}
  }
  // Write initial meta
  const fullMeta: HikeMeta = {
    session_id: sessionId,
    started_at: meta.started_at,
    activity_mode: meta.activity_mode,
    user_id: meta.user_id,
    owner_generation: meta.owner_generation,
    remote_id: meta.remote_id,
    total_points: 0,
    uploaded: false,
  };
  await fs.writeAsStringAsync(
    metaPathFor(fs, sessionId),
    JSON.stringify(fullMeta),
  );
  if (options.shouldContinue && !options.shouldContinue()) throw new Error('activity_owner_changed');
  // The empty anchor makes a just-started Activity discoverable even if the
  // process dies before CoreLocation delivers its first acceptable sample.
  await fs.writeAsStringAsync(activePath, '');
  state = { sessionId, buffer: [], totalPoints: 0, lastFlushError: null };
}

/**
 * v410 fix (fresh audit v4): Resume writing an existing hike track without
 * truncating disk file or resetting meta. Called from UnfinishedSessionBanner
 * onContinue after readActiveHikeTail restored trackPoints to Zustand store.
 *
 * Without this, hikeTrackWriter.state stays null after cold-boot (module-scoped),
 * appendHikePoint early-returns, new GPS points never hit disk. If user kills
 * app twice in a row, second-time recovery loses the mid-section walked between
 * kills. See docs/qa/v409-evidence/fresh-audit-v4.md Op 2 finding.
 */
export async function resumeHikeTrack(
  sessionId: string,
  options: { shouldContinue?: () => boolean } = {},
): Promise<{ resumed: boolean; totalPoints: number }> {
  const fs = await getFs();
  if (options.shouldContinue && !options.shouldContinue()) throw new Error('activity_owner_changed');
  if (!fs) {
    state = { sessionId, buffer: [], totalPoints: 0, lastFlushError: 'web-no-fs' };
    return { resumed: true, totalPoints: 0 };
  }
  if (await readTerminalMarker(fs, sessionId)) throw new Error('activity_journal_already_finalizing');
  if (options.shouldContinue && !options.shouldContinue()) throw new Error('activity_owner_changed');
  // The append-only journal, not advisory metadata, owns the count. Headless
  // runtimes intentionally never rewrite meta after append because doing so
  // could overwrite a concurrent Finish's `ended_at` with a stale object.
  let existingTotal = 0;
  try {
    existingTotal = (await readActiveHikeTail(sessionId)).length;
  } catch { /* journal absent — start fresh count but don't fail */ }
  if (options.shouldContinue && !options.shouldContinue()) throw new Error('activity_owner_changed');
  state = { sessionId, buffer: [], totalPoints: existingTotal, lastFlushError: null };
  return { resumed: true, totalPoints: existingTotal };
}

/**
 * Append one GPS point and return only after its WAL record commit.
 *
 * NOTE: Only appends if there is an active state (startHikeTrack called).
 * If state is null (e.g. background task fired before session start), the
 * point is dropped here — background task path handles JS-dead case by
 * writing directly via appendDirectlyToHikeTrack.
 */
export function appendHikePoint(point: HikePoint): Promise<void> {
  if (!state || state.sessionId !== point.clientActivityId) return Promise.resolve();
  state.buffer.push(point);
  state.totalPoints++;
  // A foreground point is not accepted by the Activity store until this
  // promise resolves. Flush every accepted point so process death cannot
  // routinely lose a timer-sized tail. The shared append chain keeps
  // foreground/background commits ordered.
  return flushBuffer();
}

// Foreground point, lifecycle and Finish callers can flush concurrently.
// This chain serializes buffer handoff; the WAL append chain also serializes
// foreground and headless-background writers at the file boundary.
let flushChainTail: Promise<void> = Promise.resolve();

async function flushBuffer(): Promise<void> {
  // 排到 chain 尾部,保证前一个 flush 结束才开始。空-buffer 情况在
  // IIFE 内部 early return,占极短时间,不影响吞吐。
  const next = flushChainTail.then(async () => {
    if (!state) return;
    const s = state; // narrow for TS
    if (s.buffer.length === 0) return;
    const toWrite = s.buffer;
    s.buffer = [];
    const fs = await getFs();
    if (!fs) return;
    const activePath = activePathFor(fs, s.sessionId);
    const lines = toWrite.map(encodeJournalPoint).join('\n') + '\n';
    try {
      await appendSnapshot(fs, activePath, lines);
      // Update meta
      const metaPath = metaPathFor(fs, s.sessionId);
      try {
        const metaRaw = await fs.readAsStringAsync(metaPath);
        const meta: HikeMeta = JSON.parse(metaRaw);
        meta.total_points = s.totalPoints;
        meta.last_ts = toWrite[toWrite.length - 1]?.t;
        await fs.writeAsStringAsync(metaPath, JSON.stringify(meta));
      } catch { /* best effort */ }
      s.lastFlushError = null;
    } catch (e) {
      s.lastFlushError = String(e).slice(0, 80);
      // Re-buffer for next attempt (don't drop)
      s.buffer = toWrite.concat(s.buffer);
      throw e;
    }
  });
  // 用 catch 屏蔽 chain 里单次失败,避免一次抛错把整条 chain 变成
  // rejected → 后续 flush 全部秒抛。
  flushChainTail = next.catch(() => {});
  await next;
}

/**
 * Rename active file to completed and mark meta.uploaded=false initially.
 * Called from useTrackingStore.stopTracking.
 */
export async function renameToCompleted(sessionId: string, endedAt: number, remoteId?: number): Promise<void> {
  await flushBuffer();
  const fs = await getFs();
  if (!fs) { state = null; return; }
  const activePath = activePathFor(fs, sessionId);
  const completedPath = completedPathFor(fs, sessionId);
  const metaPath = metaPathFor(fs, sessionId);
  // Legacy/direct callers may not have installed the early Finish fence. Do
  // so before any move, using the current durable generation.
  if (!await readTerminalMarker(fs, sessionId)) {
    let ownerGeneration: string | undefined;
    try {
      ownerGeneration = (await readHikeMeta(fs, sessionId)).owner_generation;
    } catch { /* verification below remains authoritative */ }
    await sealHikeTrackForFinish(sessionId, ownerGeneration, endedAt);
  }
  // Mark metadata terminal before moving the journal. A stale headless writer
  // re-reads this after its append and is forbidden from writing its old meta.
  try {
    const current = await readHikeMeta(fs, sessionId);
    current.ended_at = endedAt;
    if (remoteId !== undefined) current.remote_id = remoteId;
    await fs.writeAsStringAsync(metaPath, JSON.stringify(current));
  } catch { /* the independently verified terminal marker still fences writers */ }
  // Detect whether a JSONL exists before updating its paired metadata.
  // Initialization failures or legacy zero-point sessions can have only meta.
  let activeExisted = false;
  try {
    await durableWriteTail.catch(() => {});
    const snapshot = await readBestSnapshot(fs, activePath);
    if (snapshot) {
      await fs.writeAsStringAsync(completedPath, snapshot);
      for (const candidate of activeCandidates(activePath)) {
        try { await fs.deleteAsync(candidate, { idempotent: true }); } catch {}
      }
      try { await fs.deleteAsync(truncationPath(activePath), { idempotent: true }); } catch {}
      activeExisted = true;
    }
  } catch { /* best effort */ }
  if (activeExisted) {
    // Update meta with ended_at and remote_id so recovery does not surface it.
    try {
      const current = await readHikeMeta(fs, sessionId);
      current.ended_at = endedAt;
      if (remoteId !== undefined) current.remote_id = remoteId;
      await fs.writeAsStringAsync(metaPath, JSON.stringify(current));
    } catch { /* best effort */ }
  } else {
    // No completed JSONL means meta has no counterpart; delete the orphan.
    try {
      await fs.deleteAsync(metaPath, { idempotent: true });
    } catch { /* best effort */ }
  }
  state = null;
}

/** Snap Lab Finish variant with a strict pre-move terminal read and a
 * post-move byte-level evidence check. Product completion keeps its existing
 * compatibility behavior; synthetic QA must fail closed so a green journey
 * can never be based on an uncertain or unretired WAL. */
export async function completeSnapLabHikeTrack(
  sessionId: string,
  expectedUserId: string,
  expectedOwnerGeneration: string | undefined,
  expectedCutoffAt: number,
  endedAt: number,
): Promise<CanonicalJournalPoint[]> {
  if (!isSnapLabActivityId(sessionId)) throw new Error('snap_lab_wal_identity_required');
  const before = await readActiveHikeTerminalSnapshot(sessionId, {
    expectedOwnerGeneration,
    expectedCutoffAt,
  });
  if (before.status !== 'complete') {
    throw new Error(`snap_lab_terminal_snapshot_uncertain:${before.reason}`);
  }
  const fs = await getFs();
  if (!fs) throw new Error('snap_lab_wal_storage_unavailable');
  const metaBefore = await readHikeMeta(fs, sessionId);
  if (String(metaBefore.user_id ?? '') !== String(expectedUserId)) {
    throw new Error('snap_lab_wal_owner_mismatch');
  }
  await renameToCompleted(sessionId, endedAt);
  const active = await Promise.all(activeCandidates(activePathFor(fs, sessionId)).map(path => fs.getInfoAsync(path)));
  if (active.some(info => info.exists)) throw new Error('snap_lab_wal_active_not_retired');
  if (!(await fs.getInfoAsync(completedPathFor(fs, sessionId))).exists) {
    throw new Error('snap_lab_wal_completed_missing');
  }
  const metaAfter = await readHikeMeta(fs, sessionId);
  if (String(metaAfter.user_id ?? '') !== String(expectedUserId)
    || metaAfter.ended_at !== endedAt) {
    throw new Error('snap_lab_wal_terminal_meta_mismatch');
  }
  const marker = await readTerminalMarker(fs, sessionId);
  if (!marker
    || marker.cutoff_at !== expectedCutoffAt
    || marker.owner_generation !== expectedOwnerGeneration) {
    throw new Error('snap_lab_wal_terminal_marker_mismatch');
  }
  const after = await readHikeTrackForProjection(sessionId);
  const same = after.length === before.points.length && after.every((point, index) => {
    const expected = before.points[index];
    return point.t === expected.t
      && point.lat === expected.lat
      && point.lng === expected.lng
      && point.rawOrdinal === expected.rawOrdinal
      && point.segmentId === expected.segmentId
      && point.ownerGeneration === expected.ownerGeneration;
  });
  if (!same) throw new Error('snap_lab_wal_terminal_evidence_mismatch');
  return after;
}

/**
 * List all in-progress (active) hikes. Used at hydrate to detect
 * pendingSessionResume. Each entry is a HikeMeta.
 */
export async function listActiveHikes(): Promise<HikeMeta[]> {
  const fs = await getFs();
  if (!fs) return [];
  const activeDir = fs.documentDirectory + HIKE_DIR + 'active/';
  try {
    const info = await fs.getInfoAsync(activeDir);
    if (!info.exists) return [];
    const files = await fs.readDirectoryAsync(activeDir);
    const metas: HikeMeta[] = [];
    const sessionIds = new Set<string>();
    for (const f of files) {
      const match = f.match(/^(.*)\.jsonl(?:\.next|\.bak)?$/);
      if (match?.[1]) sessionIds.add(match[1]);
    }
    for (const sid of sessionIds) {
      try {
        const meta = await readHikeMeta(fs, sid);
        // A rejected late headless append may leave an active remnant, but a
        // terminal metadata row is a completed Activity, never a resumable one.
        if (!meta.ended_at) metas.push(meta);
      } catch { /* skip malformed */ }
    }
    return metas.sort((a, b) => b.started_at - a.started_at);
  } catch {
    return [];
  }
}

/**
 * Read the tail of an active hike's JSONL file. Skips malformed lines.
 * Used for hydrate replay (Sprint 72 STORY-00551 real implementation).
 */
export async function readActiveHikeTail(
  sessionId: string,
  limit?: number,
): Promise<CanonicalJournalPoint[]> {
  const fs = await getFs();
  if (!fs) return [];
  const activePath = activePathFor(fs, sessionId);
  try {
    await durableWriteTail.catch(() => {});
    const boundedLimit = limit == null ? null : Math.max(0, Math.floor(limit));
    if (boundedLimit === 0) return [];
    let content: string;
    let suffixBeginsMidFile = false;
    let usedBoundedSuffix = false;
    if (boundedLimit !== null && boundedLimit > 0) {
      let correctionPending = false;
      try {
        correctionPending = (await fs.getInfoAsync(truncationPath(activePath))).exists;
      } catch { /* full recovery below */ }
      if (!correctionPending) {
        const suffix = await readJournalSuffix(fs, activePath, Math.max(64 * 1024, boundedLimit * 2 * 1024));
        content = suffix.value;
        suffixBeginsMidFile = suffix.beginsMidFile;
        usedBoundedSuffix = true;
      } else {
        content = await readBestSnapshot(fs, activePath);
      }
    } else {
      content = await readBestSnapshot(fs, activePath);
    }
    if (!content) return [];
    let lines = content.split('\n');
    // The bounded native suffix normally starts inside an older record. It is
    // not corruption and must not enter the adapter.
    if (suffixBeginsMidFile) lines = lines.slice(1);
    if (boundedLimit !== null) lines = lines.filter(line => line.trim()).slice(-boundedLimit);
    const points: CanonicalJournalPoint[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const p = decodeJournalLine(line);
        // New canonical records are explicit. Valid legacy foreground rows
        // remain recoverable as one legacy segment. Debug/background rows in
        // the incompatible {ts,lon} schema are deliberately not reinterpreted.
        if (!p) {
          // A corrupt/checksum-invalid final record is exceptional. Recover
          // its valid prefix once instead of returning a misleading tail.
          if (usedBoundedSuffix) {
            const recovered = await readBestSnapshot(fs, activePath);
            const recoveredLines = recovered.split('\n').filter(item => item.trim());
            return parseCanonicalJournalLines(
              boundedLimit === null ? recoveredLines : recoveredLines.slice(-boundedLimit),
              sessionId,
              boundedLimit === null,
            );
          }
          break;
        }
        if (typeof p.clientActivityId === 'string' && p.clientActivityId !== sessionId) break;
        {
          const canonical = toCanonicalJournalPoint(p, sessionId);
          points.push(boundedLimit === null && points.length === 0 && !canonical.segmentStartReason
            ? { ...canonical, segmentStartReason: 'legacy' }
            : canonical);
        }
      } catch { /* skip malformed */ }
    }
    return points;
  } catch {
    return [];
  }
}

/** Strict projection reader spanning the unfinished and completed WAL
 * locations. Unlike the UI recovery adapter, storage failure is not converted
 * to an empty Activity: the durable Memory projector must retry rather than
 * silently declare responsibility complete. */
export async function readHikeTrackForProjection(
  sessionId: string,
): Promise<CanonicalJournalPoint[]> {
  const fs = await getFs();
  if (!fs) throw new Error('activity_projection_journal_unavailable');
  await durableWriteTail.catch(() => {});
  const paths = [
    activePathFor(fs, sessionId),
    completedPathFor(fs, sessionId),
  ];
  for (const basePath of paths) {
    let artifactExists = false;
    let readable = false;
    let best = '';
    let bestCount = -1;
    for (const path of activeCandidates(basePath)) {
      let info: any;
      try { info = await fs.getInfoAsync(path); } catch {
        throw new Error('activity_projection_journal_stat_failed');
      }
      if (!info.exists) continue;
      artifactExists = true;
      try {
        const value = await fs.readAsStringAsync(path);
        readable = true;
        const valid: string[] = [];
        for (const line of value.split('\n')) {
          if (!line.trim()) continue;
          const decoded = decodeJournalLine(line);
          if (!decoded) break;
          valid.push(line);
        }
        if (valid.length > bestCount) {
          bestCount = valid.length;
          best = valid.join('\n');
        }
      } catch { /* another crash-recovery candidate may remain readable */ }
    }
    if (!artifactExists) continue;
    if (!readable) throw new Error('activity_projection_journal_read_failed');
    return parseCanonicalJournalLines(best ? best.split('\n') : [], sessionId, true);
  }
  throw new Error('activity_projection_journal_missing');
}

function parseCanonicalJournalLines(
  lines: string[],
  sessionId: string,
  markLegacyOrigin: boolean,
): CanonicalJournalPoint[] {
  const points: CanonicalJournalPoint[] = [];
  for (const line of lines) {
    const stored = decodeJournalLine(line);
    if (!stored) break;
    if (typeof stored.clientActivityId === 'string' && stored.clientActivityId !== sessionId) break;
    const canonical = toCanonicalJournalPoint(stored, sessionId);
    points.push(markLegacyOrigin && points.length === 0 && !canonical.segmentStartReason
      ? { ...canonical, segmentStartReason: 'legacy' }
      : canonical);
  }
  return points;
}

type StrictJournalCandidate = {
  complete: boolean;
  points: CanonicalJournalPoint[];
  reason?: Extract<
    HikeTerminalSnapshotUncertainReason,
    'journal-corrupt-or-partial' | 'journal-session-mismatch' | 'journal-after-terminal-cutoff'
  >;
};

function parseStrictJournalCandidate(
  content: string,
  sessionId: string,
  cutoffAt: number,
  maximumLines: number | null,
): StrictJournalCandidate {
  const rawLines = content.split('\n');
  const nonEmptyLines = rawLines.filter(line => line.trim().length > 0);
  const requiredLines = maximumLines === null ? nonEmptyLines.length : maximumLines;
  const points: CanonicalJournalPoint[] = [];
  for (let index = 0; index < requiredLines; index += 1) {
    const line = nonEmptyLines[index];
    if (line === undefined) {
      return { complete: false, points, reason: 'journal-corrupt-or-partial' };
    }
    const stored = decodeJournalLine(line);
    if (!stored) return { complete: false, points, reason: 'journal-corrupt-or-partial' };
    if (typeof stored.clientActivityId === 'string' && stored.clientActivityId !== sessionId) {
      return { complete: false, points, reason: 'journal-session-mismatch' };
    }
    const canonical = toCanonicalJournalPoint(stored, sessionId);
    if (canonical.t > cutoffAt) {
      return { complete: false, points, reason: 'journal-after-terminal-cutoff' };
    }
    points.push(points.length === 0 && !canonical.segmentStartReason
      ? { ...canonical, segmentStartReason: 'legacy' }
      : canonical);
  }
  if (maximumLines === null) {
    // Every append commit ends in a newline. A checksum-valid but unterminated
    // last row can still be a torn write and is not terminal completeness.
    if (content.length > 0 && !content.endsWith('\n')) {
      return { complete: false, points: points.slice(0, -1), reason: 'journal-corrupt-or-partial' };
    }
    // Blank lines can only be the one trailing delimiter. Ignoring an interior
    // blank would make a malformed file look like a complete contiguous WAL.
    if (rawLines.slice(0, -1).some(line => !line.trim())) {
      return { complete: false, points, reason: 'journal-corrupt-or-partial' };
    }
  }
  return { complete: true, points };
}

/**
 * Read the immutable WAL snapshot owned by a committed Finish fence.
 *
 * Unlike unfinished-session recovery this never treats a missing/unreadable
 * file, a corrupt suffix, or an older `.bak` as an empty/complete Activity.
 * A crash-safe truncation marker is the only authority that can bound an
 * auxiliary candidate to a known-complete prefix.
 */
export async function readActiveHikeTerminalSnapshot(
  sessionId: string,
  options: { expectedOwnerGeneration?: string; expectedCutoffAt?: number } = {},
): Promise<HikeTerminalSnapshot> {
  const uncertain = (
    reason: HikeTerminalSnapshotUncertainReason,
    recoverablePoints: CanonicalJournalPoint[] = [],
  ): HikeTerminalSnapshot => ({ status: 'uncertain', reason, recoverablePoints });
  if (isSnapLabActivityId(sessionId)) {
    // This is deliberately below the real terminal reader API. SL22 therefore
    // exercises the same fail-closed Finish branch as an actual unreadable WAL
    // instead of mocking stopTracking's result.
    if (consumeSnapLabTerminalWalReadFault(sessionId)) return uncertain('journal-read-failed');
  }
  const fs = await getFs();
  if (!fs) return uncertain('storage-unavailable');
  await durableWriteTail.catch(() => {});

  const terminalPath = terminalPathFor(fs, sessionId);
  let terminalInfo: any;
  try { terminalInfo = await fs.getInfoAsync(terminalPath); } catch {
    return uncertain('terminal-marker-stat-failed');
  }
  if (!terminalInfo.exists) return uncertain('terminal-marker-missing');
  let terminalRaw: string;
  try { terminalRaw = await fs.readAsStringAsync(terminalPath); } catch {
    return uncertain('terminal-marker-read-failed');
  }
  let marker: HikeTerminalMarker;
  try {
    const parsed = JSON.parse(terminalRaw);
    if (parsed?.v !== 1 || parsed.session_id !== sessionId || !Number.isFinite(parsed.cutoff_at)) {
      return uncertain('terminal-marker-invalid');
    }
    marker = parsed as HikeTerminalMarker;
  } catch {
    return uncertain('terminal-marker-invalid');
  }
  if (options.expectedOwnerGeneration !== undefined
    && marker.owner_generation !== options.expectedOwnerGeneration) {
    return uncertain('terminal-owner-mismatch');
  }
  if (options.expectedCutoffAt !== undefined && marker.cutoff_at !== options.expectedCutoffAt) {
    return uncertain('terminal-cutoff-mismatch');
  }

  const activePath = activePathFor(fs, sessionId);
  const truncatePath = truncationPath(activePath);
  let truncateInfo: any;
  try { truncateInfo = await fs.getInfoAsync(truncatePath); } catch {
    return uncertain('truncation-marker-stat-failed');
  }
  let maximumLines: number | null = null;
  if (truncateInfo.exists) {
    let truncateRaw: string;
    try { truncateRaw = await fs.readAsStringAsync(truncatePath); } catch {
      return uncertain('truncation-marker-read-failed');
    }
    try {
      const value = Number(JSON.parse(truncateRaw)?.maximumLines);
      if (!Number.isInteger(value) || value < 0) return uncertain('truncation-marker-invalid');
      maximumLines = value;
    } catch {
      return uncertain('truncation-marker-invalid');
    }
  }

  const paths = maximumLines === null ? [activePath] : activeCandidates(activePath);
  let anyArtifact = false;
  let anyReadable = false;
  let sawStatFailure = false;
  let bestRecoverable: CanonicalJournalPoint[] = [];
  let lastReason: StrictJournalCandidate['reason'];
  for (const path of paths) {
    let info: any;
    try { info = await fs.getInfoAsync(path); } catch {
      sawStatFailure = true;
      continue;
    }
    if (!info.exists) continue;
    anyArtifact = true;
    let content: string;
    try { content = await fs.readAsStringAsync(path); } catch { continue; }
    anyReadable = true;
    const parsed = parseStrictJournalCandidate(content, sessionId, marker.cutoff_at, maximumLines);
    if (parsed.points.length > bestRecoverable.length) bestRecoverable = parsed.points;
    if (parsed.complete) {
      return {
        status: 'complete',
        points: parsed.points,
        source: path === activePath ? 'active' : 'bounded-recovery',
        cutoffAt: marker.cutoff_at,
        ownerGeneration: marker.owner_generation,
      };
    }
    lastReason = parsed.reason;
  }
  if (sawStatFailure) return uncertain('journal-stat-failed', bestRecoverable);
  if (!anyArtifact) {
    // A committed zero-line truncation cap is complete even if the snapshot
    // swap died before creating a replacement file.
    if (maximumLines === 0) {
      return {
        status: 'complete', points: [], source: 'bounded-recovery',
        cutoffAt: marker.cutoff_at, ownerGeneration: marker.owner_generation,
      };
    }
    return uncertain('journal-missing');
  }
  if (!anyReadable) return uncertain('journal-read-failed');
  if (lastReason) return uncertain(lastReason, bestRecoverable);
  return uncertain(maximumLines === null ? 'journal-corrupt-or-partial' : 'bounded-recovery-incomplete', bestRecoverable);
}

/**
 * Discard an unfinished hike (user tapped Dismiss in ResumeBanner
 * or Discard in the stop sheet).
 *
 * O14 Bug 2 fix: pre-fix, this only deleted the JSONL + meta on
 * disk. Module-scoped `state` was left with sessionId + non-empty
 * buffer and a delayed flush. The flush could recreate the JSONL after
 * deletion. The writer now commits immediately, but invalidating state and
 * waiting for the in-flight write remains necessary before deleting disk.
 */
export async function discardActiveHike(sessionId: string): Promise<void> {
  // (1) invalidate the module state so any queued flushBuffer becomes a no-op
  if (state && state.sessionId === sessionId) {
    state.buffer = [];
    state = null;
  }
  // (2) wait for any in-flight flush chain tail to drain — it may still
  // be mid-write when we get here (an addTrackPoint 50 lines ago triggered
  // an immediate flush that hasn't returned yet)
  try { await flushChainTail; } catch { /* swallow — chain rejects handled elsewhere */ }
  const fs = await getFs();
  if (!fs) return;
  const activePath = activePathFor(fs, sessionId);
  await durableWriteTail.catch(() => {});
  for (const candidate of activeCandidates(activePath)) {
    await deleteAndVerifyAbsent(fs, candidate);
  }
  await deleteAndVerifyAbsent(fs, truncationPath(activePath));
  const terminalPath = terminalPathFor(fs, sessionId);
  await deleteAndVerifyAbsent(fs, terminalPath);
  await deleteAndVerifyAbsent(fs, `${terminalPath}.next`);
  for (const candidate of metaCandidates(fs, sessionId)) {
    await deleteAndVerifyAbsent(fs, candidate);
  }
}

/**
 * Force flush now — used before app suspension / stopTracking.
 */
export async function flushNow(): Promise<void> {
  await flushBuffer();
}

/**
 * Internal-QA Activity tail correction. The crash marker is written before
 * the verified snapshot swap, so recovery can never select the longer
 * pre-correction `.bak` merely because it contains more valid lines.
 */
export async function truncateActiveHikeTrack(
  sessionId: string,
  points: Array<HikePoint | CanonicalJournalPoint>,
): Promise<void> {
  if (!state || state.sessionId !== sessionId) throw new Error('activity_journal_not_active');
  await flushBuffer();
  const fs = await getFs();
  if (!fs) {
    state.totalPoints = points.length;
    state.buffer = [];
    return;
  }
  const activePath = activePathFor(fs, sessionId);
  const replacement = points.length > 0
    ? `${points.map(point => encodeJournalPoint(toStoredPoint(point))).join('\n')}\n`
    : '';
  await replaceSnapshotWithPrefix(fs, activePath, replacement, points.length);
  state.totalPoints = points.length;
  state.buffer = [];
  const metaPath = metaPathFor(fs, sessionId);
  try {
    const metaRaw = await fs.readAsStringAsync(metaPath);
    const meta: HikeMeta = JSON.parse(metaRaw);
    meta.total_points = points.length;
    meta.last_ts = points[points.length - 1]?.t;
    await fs.writeAsStringAsync(metaPath, JSON.stringify(meta));
  } catch {
    // The verified journal is the route authority. A stale advisory count must
    // never turn a successfully committed tail correction into a false failure.
  }
}

/** Persist a late server mapping without changing the client identity. */
export async function updateHikeMeta(
  sessionId: string,
  patch: Partial<Pick<HikeMeta, 'remote_id' | 'owner_generation' | 'user_id'>>,
): Promise<void> {
  const fs = await getFs();
  if (!fs) return;
  const path = metaPathFor(fs, sessionId);
  try {
    const raw = await fs.readAsStringAsync(path);
    await fs.writeAsStringAsync(path, JSON.stringify({ ...JSON.parse(raw), ...patch }));
  } catch { /* recovery remains local even if mapping persistence fails */ }
}

/**
 * Resume changes the callback ownership generation, so best-effort metadata
 * is unsafe there: an old TaskManager runtime could otherwise keep appending
 * under a generation the foreground process has already replaced. This
 * variant proves the new generation is readable before a provider is started.
 */
export async function updateHikeMetaStrict(
  sessionId: string,
  patch: Partial<Pick<HikeMeta, 'remote_id' | 'owner_generation' | 'user_id'>>,
): Promise<void> {
  const fs = await getFs();
  if (!fs) throw new Error('activity_meta_storage_unavailable');
  if (await readTerminalMarker(fs, sessionId)) throw new Error('activity_meta_terminal');
  const path = metaPathFor(fs, sessionId);
  const nextPath = `${path}.next`;
  const backupPath = `${path}.bak`;
  const current = await readHikeMeta(fs, sessionId);
  const next = { ...current, ...patch };
  const encoded = JSON.stringify(next);
  await fs.writeAsStringAsync(nextPath, encoded);
  const staged = parseHikeMeta(await fs.readAsStringAsync(nextPath), sessionId);
  if (!staged) throw new Error('activity_meta_stage_verify_failed');
  if (await readTerminalMarker(fs, sessionId)) {
    await fs.deleteAsync(nextPath, { idempotent: true }).catch(() => undefined);
    throw new Error('activity_meta_terminal');
  }
  await fs.deleteAsync(backupPath, { idempotent: true }).catch(() => undefined);
  const baseInfo = await fs.getInfoAsync(path);
  if (baseInfo.exists) await fs.moveAsync({ from: path, to: backupPath });
  await fs.moveAsync({ from: nextPath, to: path });
  const verified = parseHikeMeta(await fs.readAsStringAsync(path), sessionId);
  if (!verified) throw new Error('activity_meta_commit_verify_failed');
  for (const [key, value] of Object.entries(patch)) {
    if ((verified as any)[key] !== value) throw new Error('activity_meta_write_verify_failed');
  }
}

/** Per-Activity heavy-data cleanup after durable server handoff. */
export async function deleteCompletedHikeTrack(sessionId: string): Promise<void> {
  const fs = await getFs();
  if (!fs) return;
  await flushChainTail.catch(() => {});
  await deleteAndVerifyAbsent(fs, completedPathFor(fs, sessionId));
  const terminalPath = terminalPathFor(fs, sessionId);
  await deleteAndVerifyAbsent(fs, terminalPath);
  await deleteAndVerifyAbsent(fs, `${terminalPath}.next`);
  for (const candidate of metaCandidates(fs, sessionId)) {
    await deleteAndVerifyAbsent(fs, candidate);
  }
}

function snapLabArtifactPaths(fs: any, sessionId: string): string[] {
  const activePath = activePathFor(fs, sessionId);
  const terminalPath = terminalPathFor(fs, sessionId);
  return [
    ...activeCandidates(activePath),
    truncationPath(activePath),
    completedPathFor(fs, sessionId),
    terminalPath,
    `${terminalPath}.next`,
    ...metaCandidates(fs, sessionId),
  ];
}

/** Enumerate QA WAL authority independently of the Snap Lab Activity index.
 * A coordinate artifact without readable ownership metadata is a visible
 * privacy-cleanup failure, never an excuse to silently leave an orphan. */
export async function listSnapLabHikeTrackIdsForOwner(expectedUserId: string): Promise<string[]> {
  if (!expectedUserId || expectedUserId === 'guest') throw new Error('snap_lab_wal_owner_required');
  const fs = await getFs();
  if (!fs) return [];
  const root = fs.documentDirectory + QA_HIKE_DIR;
  const sessionIds = new Set<string>();
  for (const directory of ['active/', 'completed/', 'meta/']) {
    const path = root + directory;
    let files: string[];
    try {
      const info = await fs.getInfoAsync(path);
      if (!info.exists) continue;
      files = await fs.readDirectoryAsync(path);
    } catch {
      throw new Error('snap_lab_wal_enumeration_failed');
    }
    for (const filename of files) {
      const match = directory === 'meta/'
        ? filename.match(/^(qa-snap-.*)\.json(?:\.next|\.bak)?$/)
        : filename.match(/^(qa-snap-.*)\.jsonl(?:\.next|\.bak|\.truncate\.json)?$/);
      if (match?.[1] && !filename.includes('.terminal.')) sessionIds.add(match[1]);
    }
  }
  const owned: string[] = [];
  for (const sessionId of sessionIds) {
    let meta: HikeMeta;
    try {
      meta = await readHikeMeta(fs, sessionId);
    } catch {
      throw new Error(`snap_lab_wal_owner_unavailable:${sessionId}`);
    }
    if (String(meta.user_id ?? '') === String(expectedUserId)) owned.push(sessionId);
  }
  return owned.sort();
}

/** Strict owner-scoped deletion for one synthetic Activity journal. */
export async function deleteSnapLabHikeTrackForOwner(
  sessionId: string,
  expectedUserId: string,
): Promise<void> {
  if (!isSnapLabActivityId(sessionId)) throw new Error('snap_lab_wal_identity_required');
  await assertHikeTrackCleanupOwner(sessionId, expectedUserId);
  if (state?.sessionId === sessionId) {
    state.buffer = [];
    state = null;
  }
  await flushChainTail.catch(() => {});
  await durableWriteTail.catch(() => {});
  const fs = await getFs();
  if (!fs) return;
  for (const path of snapLabArtifactPaths(fs, sessionId)) await deleteAndVerifyAbsent(fs, path);
}

/** Complete owner-scoped QA purge with post-delete re-enumeration. */
export async function purgeSnapLabHikeTracksForOwner(expectedUserId: string): Promise<void> {
  const ids = await listSnapLabHikeTrackIdsForOwner(expectedUserId);
  for (const id of ids) await deleteSnapLabHikeTrackForOwner(id, expectedUserId);
  const remaining = await listSnapLabHikeTrackIdsForOwner(expectedUserId);
  if (remaining.length > 0) throw new Error('snap_lab_wal_cleanup_incomplete');
}

async function deleteAndVerifyAbsent(fs: any, path: string): Promise<void> {
  await fs.deleteAsync(path, { idempotent: true });
  if ((await fs.getInfoAsync(path)).exists) throw new Error('activity_journal_cleanup_incomplete');
}

/**
 * Prove ownership once before a multi-location cleanup removes the meta file.
 * A missing meta is acceptable only when no Activity journal artifact exists.
 */
export async function assertHikeTrackCleanupOwner(sessionId: string, expectedUserId: string): Promise<void> {
  if (!expectedUserId || expectedUserId === 'guest') throw new Error('activity_journal_owner_required');
  const fs = await getFs();
  if (!fs) return;
  const activePath = activePathFor(fs, sessionId);
  const completedPath = completedPathFor(fs, sessionId);
  const terminalPath = terminalPathFor(fs, sessionId);
  const artifactPaths = [
    ...activeCandidates(activePath),
    truncationPath(activePath),
    completedPath,
    terminalPath,
    `${terminalPath}.next`,
    ...metaCandidates(fs, sessionId),
  ];
  const infos = await Promise.all(artifactPaths.map(path => fs.getInfoAsync(path)));
  if (!infos.some(info => info.exists)) return;
  if (!infos.slice(-3).some(info => info.exists)) throw new Error('activity_journal_owner_unavailable');
  const meta = await readHikeMeta(fs, sessionId);
  if (String(meta.user_id ?? '') !== String(expectedUserId)) {
    throw new Error('activity_journal_owner_mismatch');
  }
}

/**
 * ACK cleanup for every heavy Activity-journal location. Ownership metadata
 * is deliberately removed last so a crash/failure after either trace delete
 * can be retried safely on the next launch.
 */
export async function deleteAcknowledgedHikeTrackArtifacts(
  sessionId: string,
  expectedUserId: string,
): Promise<void> {
  if (state && state.sessionId === sessionId) {
    state.buffer = [];
    state = null;
  }
  await flushChainTail.catch(() => {});
  await durableWriteTail.catch(() => {});
  await assertHikeTrackCleanupOwner(sessionId, expectedUserId);
  const fs = await getFs();
  if (!fs) return;
  const activePath = activePathFor(fs, sessionId);
  for (const candidate of activeCandidates(activePath)) {
    await deleteAndVerifyAbsent(fs, candidate);
  }
  await deleteAndVerifyAbsent(fs, truncationPath(activePath));
  await deleteAndVerifyAbsent(fs, completedPathFor(fs, sessionId));
  const terminalPath = terminalPathFor(fs, sessionId);
  await deleteAndVerifyAbsent(fs, terminalPath);
  await deleteAndVerifyAbsent(fs, `${terminalPath}.next`);
  for (const candidate of metaCandidates(fs, sessionId)) {
    await deleteAndVerifyAbsent(fs, candidate);
  }
}

/** Canonical durable entry point used by the headless background task. */
export async function appendBackgroundHikePoints(points: HikePoint[], expectedUserId?: string): Promise<void> {
  if (points.length === 0) return;
  const sessionId = points[0].clientActivityId;
  if (!sessionId || points.some(point => point.clientActivityId !== sessionId)) {
    throw new Error('mixed_activity_background_batch');
  }
  const fs = await getFs();
  if (!fs) return;
  await ensureDirs(fs, sessionId);
  const meta = await readHikeMeta(fs, sessionId);
  if (meta.ended_at) throw new Error('background_activity_already_finalized');
  if (await readTerminalMarker(fs, sessionId)) throw new Error('background_activity_finalizing');
  if (expectedUserId && meta.user_id && meta.user_id !== expectedUserId) {
    throw new Error('stale_background_user');
  }
  if (meta.owner_generation && points.some(point => point.ownerGeneration !== meta.owner_generation)) {
    throw new Error('stale_background_owner_generation');
  }
  const activePath = activePathFor(fs, sessionId);
  const lines = points.map(encodeJournalPoint).join('\n') + '\n';
  // Capture the verified prefix before committing. If a separate runtime's
  // terminal marker wins during the append, the crash-safe truncation marker
  // below can linearize this callback as rejected without losing history.
  const prefixBeforeAppend = await readBestSnapshot(fs, activePath);
  const prefixLineCount = prefixBeforeAppend
    ? prefixBeforeAppend.split('\n').filter(line => line.trim()).length
    : 0;
  await appendSnapshot(fs, activePath, lines);
  // Re-check after the append. If the terminal marker won the race, this
  // callback is rejected and must never rewrite its stale pre-Finish meta.
  // When Finish already moved the historical file, remove only the newly
  // resurrected active remnant. Otherwise leave it for Finish's full drain.
  if (await readTerminalMarker(fs, sessionId)) {
    await replaceSnapshotWithPrefix(fs, activePath, prefixBeforeAppend, prefixLineCount);
    const completedPath = completedPathFor(fs, sessionId);
    if ((await fs.getInfoAsync(completedPath)).exists) {
      // Finish may have moved the just-appended P+L snapshot before this
      // runtime observed the terminal marker. Repair the completed copy to
      // the same pre-append prefix before deleting the active remnant; merely
      // truncating active would leave the rejected late tail in product data.
      await replaceSnapshotWithPrefix(fs, completedPath, prefixBeforeAppend, prefixLineCount);
      for (const candidate of activeCandidates(activePath)) {
        await fs.deleteAsync(candidate, { idempotent: true });
      }
      await fs.deleteAsync(truncationPath(activePath), { idempotent: true });
    }
    throw new Error('background_activity_finalizing');
  }
}

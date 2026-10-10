import { storage } from '../../store/storage';
import type { ActivityStageLedgerExport } from './activityStageLedger';

type NativeGpsEventKind =
  | 'collector-heartbeat'
  | 'collector-retention-start'
  | 'native-callback'
  | 'native-js-delivery'
  | 'native-error';

export interface NativeGpsEvidenceEvent {
  schema: 'cairn-native-gps-evidence';
  version: 2;
  event: NativeGpsEventKind;
  source: 'foreground-streamer' | 'background-task' | 'collector';
  collectorRunId: string;
  retentionEpoch: number;
  sequence: number;
  /** Redacted after the exact owner+Activity scope match. */
  correlationScopeId: 'current-activity';
  evidenceIds: string[];
  receiptWallTimeMs: number;
  receiptMonotonicTimeMs: number;
  firstObservationTimeMs: number | null;
  lastObservationTimeMs: number | null;
  batchCount: number;
  horizontalAccuracyMinM: number | null;
  horizontalAccuracyMaxM: number | null;
  applicationState: string;
  authorizationStatus: string;
  accuracyAuthorization: string;
}

interface NativeGpsEvidenceOnDiskEvent extends Omit<NativeGpsEvidenceEvent, 'correlationScopeId'> {
  correlationScopeId: string;
}

export interface NativeGpsEvidenceExport {
  schema: 'cairn-native-gps-evidence-export';
  version: 2;
  evidenceCompletenessStatus:
    | 'not-observable-current-binary'
    | 'native-file-unreadable'
    | 'owner-correlation-unavailable'
    | 'owner-correlated-evidence-unavailable'
    | 'native-evidence-owner-correlated';
  sourcePath: 'app-documents/CairnDiagnostics/native-gps-evidence-v2.jsonl';
  privacy: {
    coordinatesIncluded: false;
    automaticUpload: false;
    ownerScopeMatchedBeforeExport: true;
    maximumBytes: 524288;
  };
  identityCorrelation: {
    nativeCallbackToDelivery: 'exact-native-evidence-id';
    nativeDeliveryToJsIntake: 'unavailable-no-shared-payload-id';
  };
  malformedLineCount: number;
  unmatchedScopeEventCount: number;
  retentionTruncated: boolean;
  collectorRunCount: number;
  events: NativeGpsEvidenceEvent[];
}

export interface ActivityNativeCrossLedgerReport {
  schema: 'cairn-activity-native-cross-ledger-report';
  version: 1;
  clientActivityId: string | null;
  clockContract: {
    gapBoundary: 'js-receipt-wall-clock';
    nativeGrouping: 'collector-run-and-retention-epoch';
    crossBootMonotonicMerge: false;
    perPointNativeToJsIdentity: 'unavailable';
  };
  nativeEvidenceStatus: NativeGpsEvidenceExport['evidenceCompletenessStatus'];
  gaps: Array<{
    fromWallTimeMs: number;
    toWallTimeMs: number;
    receiptGapDurationMs: number;
    observationTimestampGapMs: number | null;
    collectorCoverage: 'complete' | 'incomplete' | 'unavailable';
    nativeCallbackCount: number;
    nativeDeliveryCount: number;
    callbacksWithoutNativeDelivery: number;
    conclusion:
      | 'no-native-callback-observed-with-complete-collector-coverage'
      | 'native-callback-observed-native-delivery-missing'
      | 'native-delivery-invoked-js-intake-not-observed'
      | 'recording-source-intentionally-inactive'
      | 'collector-coverage-incomplete-cause-unknown'
      | 'native-evidence-unavailable';
  }>;
  interpretationLimits: string[];
}

interface ScopeRecord {
  clientActivityId: string;
  correlationScopeId: string;
  activatedAtMs: number;
  deactivatedAtMs: number | null;
}

interface ScopeIndex {
  schema: 'cairn-native-gps-scope-index';
  version: 1;
  records: ScopeRecord[];
}

const RELATIVE_PATH = 'CairnDiagnostics/native-gps-evidence-v2.jsonl';
const CONTEXT_RELATIVE_PATH = 'CairnDiagnostics/native-gps-context-v1.json';
const SCOPE_ROOT = '@cairn:native-gps-scope:v1:';
const MAX_EVENTS = 1_024;
const MAX_SCOPE_RECORDS = 3;
const HEARTBEAT_COVERAGE_MS = 90_000;
let scopeMutationTail: Promise<void> = Promise.resolve();

function enqueueScopeMutation(work: () => Promise<void>): Promise<void> {
  const next = scopeMutationTail.then(work, work);
  scopeMutationTail = next.catch(() => undefined);
  return next;
}

function scopeKey(ownerUserId: string): string {
  return `${SCOPE_ROOT}${encodeURIComponent(ownerUserId)}`;
}

function opaqueScopeId(): string {
  // Correlation only, never authentication. Keeping this generator local
  // avoids importing network/offline orchestration into privacy cleanup.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
    const random = (Math.random() * 16) | 0;
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function validScopeRecord(value: unknown): value is ScopeRecord {
  const record = value as ScopeRecord | null;
  return !!record
    && typeof record.clientActivityId === 'string'
    && typeof record.correlationScopeId === 'string'
    && record.correlationScopeId.length >= 16
    && Number.isFinite(record.activatedAtMs)
    && (record.deactivatedAtMs === null || Number.isFinite(record.deactivatedAtMs));
}

async function readScopeIndex(ownerUserId: string): Promise<ScopeIndex> {
  try {
    const raw = await storage.getItem(scopeKey(ownerUserId));
    if (!raw) return { schema: 'cairn-native-gps-scope-index', version: 1, records: [] };
    const parsed = JSON.parse(raw) as Partial<ScopeIndex>;
    if (parsed.schema !== 'cairn-native-gps-scope-index' || parsed.version !== 1
      || !Array.isArray(parsed.records)) throw new Error('invalid_native_scope_index');
    return {
      schema: 'cairn-native-gps-scope-index',
      version: 1,
      records: parsed.records.filter(validScopeRecord).slice(-MAX_SCOPE_RECORDS),
    };
  } catch {
    // Corrupt/unreadable ownership metadata must never release a device-global
    // native file into an account export.
    return { schema: 'cairn-native-gps-scope-index', version: 1, records: [] };
  }
}

function getFileSystem(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const imported = require('expo-file-system/legacy');
    return imported?.documentDirectory ? imported : imported?.default ?? null;
  } catch {
    return null;
  }
}

async function writeNativeContext(correlationScopeId: string): Promise<void> {
  const FileSystem = getFileSystem();
  if (!FileSystem?.documentDirectory) return;
  const directory = `${FileSystem.documentDirectory}CairnDiagnostics`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  await FileSystem.writeAsStringAsync(
    `${FileSystem.documentDirectory}${CONTEXT_RELATIVE_PATH}`,
    JSON.stringify({
      schema: 'cairn-native-gps-context',
      version: 1,
      correlationScopeId,
      activatedAtMs: Date.now(),
    }),
  );
}

async function clearNativeContextIfMatching(correlationScopeIds: Set<string>): Promise<void> {
  const FileSystem = getFileSystem();
  if (!FileSystem?.documentDirectory || correlationScopeIds.size === 0) return;
  const path = `${FileSystem.documentDirectory}${CONTEXT_RELATIVE_PATH}`;
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info?.exists) return;
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(path));
    if (!correlationScopeIds.has(String(parsed?.correlationScopeId ?? ''))) return;
    await FileSystem.deleteAsync(path, { idempotent: true });
  } catch {
    // Diagnostic context cleanup is best-effort and never owns Activity state.
  }
}

/**
 * Establish an opaque owner+Activity scope for a future instrumented native
 * binary. Callers intentionally do not await this diagnostic-only path.
 */
export function activateNativeGpsEvidenceScope(
  ownerUserId: string,
  clientActivityId: string,
): Promise<void> {
  if (!ownerUserId || !clientActivityId) return Promise.resolve();
  return enqueueScopeMutation(async () => {
    const index = await readScopeIndex(ownerUserId);
    const existing = index.records.find(record => record.clientActivityId === clientActivityId);
    const record: ScopeRecord = existing
      ? { ...existing, activatedAtMs: Date.now(), deactivatedAtMs: null }
      : {
          clientActivityId,
          correlationScopeId: `activity-${opaqueScopeId()}`,
          activatedAtMs: Date.now(),
          deactivatedAtMs: null,
        };
    const next = [
      ...index.records.filter(item => item.clientActivityId !== clientActivityId),
      record,
    ].slice(-MAX_SCOPE_RECORDS);
    await storage.setItem(scopeKey(ownerUserId), JSON.stringify({ ...index, records: next }));
    await writeNativeContext(record.correlationScopeId).catch(() => undefined);
  });
}

export function deactivateNativeGpsEvidenceScope(
  ownerUserId: string,
  clientActivityId: string,
): Promise<void> {
  if (!ownerUserId || !clientActivityId) return Promise.resolve();
  return enqueueScopeMutation(async () => {
    const index = await readScopeIndex(ownerUserId);
    const matching = index.records.find(record => record.clientActivityId === clientActivityId);
    if (!matching) return;
    const records = index.records.map(record => record.clientActivityId === clientActivityId
      ? { ...record, deactivatedAtMs: Date.now() }
      : record);
    await storage.setItem(scopeKey(ownerUserId), JSON.stringify({ ...index, records }));
    await clearNativeContextIfMatching(new Set([matching.correlationScopeId]));
  });
}

export function purgeNativeGpsEvidenceScopesForOwner(ownerUserId: string): Promise<void> {
  return enqueueScopeMutation(async () => {
    const index = await readScopeIndex(ownerUserId);
    await clearNativeContextIfMatching(new Set(index.records.map(record => record.correlationScopeId)));
    await storage.removeItem(scopeKey(ownerUserId));
  });
}

function safeEvent(value: unknown): NativeGpsEvidenceOnDiskEvent | null {
  const event = value as Partial<NativeGpsEvidenceOnDiskEvent> | null;
  if (!event
    || event.schema !== 'cairn-native-gps-evidence'
    || event.version !== 2
    || !['collector-heartbeat', 'collector-retention-start', 'native-callback', 'native-js-delivery', 'native-error'].includes(String(event.event))
    || !['foreground-streamer', 'background-task', 'collector'].includes(String(event.source))
    || typeof event.collectorRunId !== 'string'
    || typeof event.correlationScopeId !== 'string'
    || !Number.isFinite(event.retentionEpoch)
    || !Number.isFinite(event.sequence)
    || !Array.isArray(event.evidenceIds)
    || event.evidenceIds.some(identity => typeof identity !== 'string')
    || !Number.isFinite(event.receiptWallTimeMs)
    || !Number.isFinite(event.receiptMonotonicTimeMs)
    || !Number.isFinite(event.batchCount)) return null;
  const serialized = JSON.stringify(event).toLowerCase();
  if (serialized.includes('latitude') || serialized.includes('longitude')
    || serialized.includes('"lat"') || serialized.includes('"lng"')) return null;
  return event as NativeGpsEvidenceOnDiskEvent;
}

function baseExport(): Omit<NativeGpsEvidenceExport,
  'evidenceCompletenessStatus' | 'events' | 'malformedLineCount'
  | 'unmatchedScopeEventCount' | 'retentionTruncated' | 'collectorRunCount'> {
  return {
    schema: 'cairn-native-gps-evidence-export',
    version: 2,
    sourcePath: 'app-documents/CairnDiagnostics/native-gps-evidence-v2.jsonl',
    privacy: {
      coordinatesIncluded: false,
      automaticUpload: false,
      ownerScopeMatchedBeforeExport: true,
      maximumBytes: 524_288,
    },
    identityCorrelation: {
      nativeCallbackToDelivery: 'exact-native-evidence-id',
      nativeDeliveryToJsIntake: 'unavailable-no-shared-payload-id',
    },
  };
}

/** User-initiated, bounded and fail-closed owner+Activity native export. */
export async function exportNativeGpsEvidence(
  ownerUserId: string,
  clientActivityId: string | null,
): Promise<NativeGpsEvidenceExport> {
  const base = baseExport();
  const empty = (evidenceCompletenessStatus: NativeGpsEvidenceExport['evidenceCompletenessStatus']) => ({
    ...base,
    evidenceCompletenessStatus,
    malformedLineCount: 0,
    unmatchedScopeEventCount: 0,
    retentionTruncated: false,
    collectorRunCount: 0,
    events: [],
  });
  await scopeMutationTail.catch(() => undefined);
  if (!ownerUserId || !clientActivityId) return empty('owner-correlation-unavailable');
  const index = await readScopeIndex(ownerUserId);
  const scope = index.records.find(record => record.clientActivityId === clientActivityId);
  if (!scope) return empty('owner-correlation-unavailable');
  try {
    const FileSystem = getFileSystem();
    if (!FileSystem?.documentDirectory) return empty('not-observable-current-binary');
    const path = `${FileSystem.documentDirectory}${RELATIVE_PATH}`;
    const info = await FileSystem.getInfoAsync(path);
    if (!info?.exists) return empty('not-observable-current-binary');
    const raw = await FileSystem.readAsStringAsync(path);
    const lines = String(raw).split('\n').filter(Boolean);
    let malformedLineCount = 0;
    let unmatchedScopeEventCount = 0;
    const matching = lines.flatMap(line => {
      try {
        const parsed = safeEvent(JSON.parse(line));
        if (!parsed) {
          malformedLineCount += 1;
          return [];
        }
        if (parsed.correlationScopeId !== scope.correlationScopeId) {
          unmatchedScopeEventCount += 1;
          return [];
        }
        return [{ ...parsed, correlationScopeId: 'current-activity' as const }];
      } catch {
        malformedLineCount += 1;
        return [];
      }
    });
    const events = matching.slice(-MAX_EVENTS);
    if (events.length === 0) {
      return {
        ...empty('owner-correlated-evidence-unavailable'),
        malformedLineCount,
        unmatchedScopeEventCount,
      };
    }
    return {
      ...base,
      evidenceCompletenessStatus: 'native-evidence-owner-correlated',
      malformedLineCount,
      unmatchedScopeEventCount,
      retentionTruncated: matching.length > MAX_EVENTS
        || events.some(event => event.event === 'collector-retention-start'),
      collectorRunCount: new Set(events.map(event => event.collectorRunId)).size,
      events,
    };
  } catch {
    return empty('native-file-unreadable');
  }
}

function coverageForGap(
  events: NativeGpsEvidenceEvent[],
  fromWallTimeMs: number,
  toWallTimeMs: number,
  retentionTruncated: boolean,
): 'complete' | 'incomplete' | 'unavailable' {
  if (events.length === 0) return 'unavailable';
  if (retentionTruncated) return 'incomplete';
  const groups = new Map<string, NativeGpsEvidenceEvent[]>();
  events.forEach(event => {
    const key = `${event.collectorRunId}:${event.retentionEpoch}`;
    groups.set(key, [...(groups.get(key) ?? []), event]);
  });
  for (const group of groups.values()) {
    const heartbeats = group
      .filter(event => event.event === 'collector-heartbeat')
      .map(event => event.receiptWallTimeMs)
      .sort((left, right) => left - right);
    const before = [...heartbeats].reverse().find(time => time <= fromWallTimeMs);
    const after = heartbeats.find(time => time >= toWallTimeMs);
    if (before == null || after == null
      || fromWallTimeMs - before > HEARTBEAT_COVERAGE_MS
      || after - toWallTimeMs > HEARTBEAT_COVERAGE_MS) continue;
    const spanning = heartbeats.filter(time => time >= before && time <= after);
    if (spanning.slice(1).every((time, index) => time - spanning[index] <= HEARTBEAT_COVERAGE_MS)) {
      return 'complete';
    }
  }
  return 'incomplete';
}

/**
 * Correlates only owner-scoped wall-time windows. Monotonic clocks are never
 * compared across collector/JS process boots, and no per-point bridge match is
 * claimed because Expo Location does not carry the native evidence ID to JS.
 */
export function buildActivityNativeCrossLedgerReport(
  ledger: ActivityStageLedgerExport,
  native: NativeGpsEvidenceExport,
): ActivityNativeCrossLedgerReport {
  return {
    schema: 'cairn-activity-native-cross-ledger-report',
    version: 1,
    clientActivityId: ledger.clientActivityId,
    clockContract: {
      gapBoundary: 'js-receipt-wall-clock',
      nativeGrouping: 'collector-run-and-retention-epoch',
      crossBootMonotonicMerge: false,
      perPointNativeToJsIdentity: 'unavailable',
    },
    nativeEvidenceStatus: native.evidenceCompletenessStatus,
    gaps: ledger.observability.longObservationGaps.map(gap => {
      const coverage = native.evidenceCompletenessStatus === 'native-evidence-owner-correlated'
        ? coverageForGap(native.events, gap.fromWallTimeMs, gap.toWallTimeMs, native.retentionTruncated)
        : 'unavailable' as const;
      const inside = native.events.filter(event => event.receiptWallTimeMs > gap.fromWallTimeMs
        && event.receiptWallTimeMs < gap.toWallTimeMs);
      const callbacks = inside.filter(event => event.event === 'native-callback');
      const deliveries = inside.filter(event => event.event === 'native-js-delivery');
      const deliveredIds = new Set(deliveries.flatMap(event => event.evidenceIds));
      const callbacksWithoutNativeDelivery = callbacks.flatMap(event => event.evidenceIds)
        .filter(identity => !deliveredIds.has(identity)).length;
      const conclusion = gap.conclusion === 'recording-source-intentionally-inactive'
        ? 'recording-source-intentionally-inactive' as const
        : coverage === 'unavailable'
        ? 'native-evidence-unavailable' as const
        : callbacksWithoutNativeDelivery > 0
          ? 'native-callback-observed-native-delivery-missing' as const
          : deliveries.length > 0
            ? 'native-delivery-invoked-js-intake-not-observed' as const
            : coverage === 'complete'
              ? 'no-native-callback-observed-with-complete-collector-coverage' as const
              : 'collector-coverage-incomplete-cause-unknown' as const;
      return {
        fromWallTimeMs: gap.fromWallTimeMs,
        toWallTimeMs: gap.toWallTimeMs,
        receiptGapDurationMs: gap.receiptGapDurationMs,
        observationTimestampGapMs: gap.observationTimestampGapMs,
        collectorCoverage: coverage,
        nativeCallbackCount: callbacks.length,
        nativeDeliveryCount: deliveries.length,
        callbacksWithoutNativeDelivery,
        conclusion,
      };
    }),
    interpretationLimits: [
      'A native no-callback conclusion requires uninterrupted owner-scoped heartbeats in one collector run and retention epoch.',
      'Native delivery means Expo invoked its JS delivery boundary; it does not prove the JS task/store accepted the payload.',
      'Native evidence IDs correlate callback to native delivery only. Per-point native-to-JS identity remains unavailable.',
      'Missing heartbeats, rotation, another owner scope, or another process boot leaves the native cause unknown.',
    ],
  };
}

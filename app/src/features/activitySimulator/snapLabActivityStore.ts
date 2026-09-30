import { storage } from '../../store/storage';
import type { TrackPoint, TrackingSession } from '../../store/useSessionStore';
import { segmentTrace, type SegmentedTrackPoint } from '../activity/activityContracts';
import {
  activityGeometryFingerprint,
  buildLocalFinalTrackPoints,
} from '../activity/activityFinalArtifact';
import {
  reconstructPedestrianFinalRoute,
  type PedestrianFinalStats,
} from '../../services/routing/pedestrianFinalRoute';
import {
  exportLatestActivityStageLedger,
  flushActivityStageLedger,
  recordActivityStageEvent,
  type ActivityStageLedgerExport,
} from '../activity/activityStageLedger';
import type { SnapLabTransportReceipt } from './snapLabTransport';

export type SnapLabTransportMode = 'offline' | 'deterministic' | 'captured';
export type SnapLabEvidenceLabel =
  | 'LOCAL_ONLY'
  | 'DETERMINISTIC_TRANSPORT'
  | 'CAPTURED_REAL_RESPONSE';

export interface SnapLabRunContext {
  caseId: string;
  profileId: string;
  seed: number;
  networkCondition: string;
  transportMode: SnapLabTransportMode;
  evidenceLabel: SnapLabEvidenceLabel;
  matrixSha256?: string | null;
  requestIdentity?: string | null;
  clockSpeed?: number;
}

export interface SnapLabRouteSnapshot {
  id: string;
  name: string;
  createdAt: number;
  sourceActivityId: string;
  artifactRevision: number;
  artifactFingerprint: string;
  points: TrackPoint[];
}

export interface SnapLabFinalRun {
  localFinal: TrackPoint[];
  selectedFinal: TrackPoint[];
  selectedSource: 'local' | 'matched' | 'hybrid';
  segmentStats: PedestrianFinalStats[];
  requestCount: number;
  directionsRequestCount: number;
  acceptedIslandCount: number;
  transportReceipts: SnapLabTransportReceipt[];
}

export interface SnapLabActivityRecord {
  format: 'cairn-snap-lab-activity';
  version: 1;
  realm: 'snap-lab';
  ownerUserId: string;
  activityId: string;
  createdAt: number;
  context: SnapLabRunContext;
  session: TrackingSession;
  rawPoints: TrackPoint[];
  canonicalPoints: TrackPoint[];
  liveBeforeFinish: TrackPoint[];
  localFinal: TrackPoint[];
  selectedFinal: TrackPoint[];
  selectedSource: 'local' | 'matched' | 'hybrid';
  segmentStats: PedestrianFinalStats[];
  requestCount: number;
  directionsRequestCount: number;
  acceptedIslandCount: number;
  transportReceipts: SnapLabTransportReceipt[];
  qaMemoryPointCount: number;
  stageTimestamps: Record<string, number | null>;
  stageLedger: ActivityStageLedgerExport | null;
  routeSnapshots: SnapLabRouteSnapshot[];
  roadUpgrade?: {
    attemptedAt: number;
    attemptCount: 1;
    outcome: 'upgraded' | 'retained-local';
    previousFingerprint: string;
    selectedFingerprint: string;
    requestCount: number;
    directionsRequestCount: number;
    transportReceipts: SnapLabTransportReceipt[];
  } | null;
}

const INDEX_PREFIX = '@cairn:snap_lab:activity_index:v1:';
const RECORD_PREFIX = '@cairn:snap_lab:activity:v1:';
const MAX_RECORDS = 240;
const WEB_DB_NAME = 'cairn-snap-lab-v1';
const WEB_DB_STORE = 'activity-records';

const indexKey = (ownerUserId: string) => `${INDEX_PREFIX}${ownerUserId}`;
const recordKey = (ownerUserId: string, activityId: string) => (
  `${RECORD_PREFIX}${ownerUserId}:${activityId}`
);

let activeContext: SnapLabRunContext | null = null;
let activeFetch: typeof fetch | null = null;
let activeReceiptReader: (() => SnapLabTransportReceipt[]) | null = null;
let writeTail: Promise<void> = Promise.resolve();

function webRecordDatabaseAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

function openWebRecordDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(WEB_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(WEB_DB_STORE)) {
        request.result.createObjectStore(WEB_DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('snap_lab_indexeddb_open_failed'));
    request.onblocked = () => reject(new Error('snap_lab_indexeddb_blocked'));
  });
}

async function webRecordRequest<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openWebRecordDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(WEB_DB_STORE, mode);
      const request = operation(transaction.objectStore(WEB_DB_STORE));
      let value: T;
      request.onsuccess = () => { value = request.result; };
      request.onerror = () => reject(request.error ?? new Error('snap_lab_indexeddb_request_failed'));
      transaction.oncomplete = () => resolve(value);
      transaction.onabort = () => reject(transaction.error ?? new Error('snap_lab_indexeddb_transaction_aborted'));
      transaction.onerror = () => reject(transaction.error ?? new Error('snap_lab_indexeddb_transaction_failed'));
    });
  } finally {
    db.close();
  }
}

async function readEncodedRecord(key: string): Promise<string | null> {
  if (!webRecordDatabaseAvailable()) return storage.getItem(key);
  const value = await webRecordRequest('readonly', store => store.get(key));
  return typeof value === 'string' ? value : null;
}

async function writeEncodedRecord(key: string, value: string): Promise<void> {
  if (!webRecordDatabaseAvailable()) {
    await storage.setItem(key, value, { strict: true });
    return;
  }
  await webRecordRequest('readwrite', store => store.put(value, key));
}

async function removeEncodedRecord(key: string): Promise<void> {
  if (!webRecordDatabaseAvailable()) {
    await storage.removeItem(key, { strict: true });
    return;
  }
  await webRecordRequest('readwrite', store => store.delete(key));
}

async function encodedRecordKeys(): Promise<string[]> {
  if (webRecordDatabaseAvailable()) {
    const keys = await webRecordRequest<IDBValidKey[]>('readonly', store => store.getAllKeys());
    return keys.filter((key): key is string => typeof key === 'string');
  }
  return typeof storage.getAllKeysStrict === 'function'
    ? storage.getAllKeysStrict()
    : [];
}

async function enumerateSnapLabActivityIds(ownerUserId: string, settleWrites = true): Promise<string[]> {
  if (settleWrites) await writeTail.catch(() => {});
  const prefix = `${RECORD_PREFIX}${ownerUserId}:`;
  const actual = (await encodedRecordKeys())
    .filter(key => key.startsWith(prefix))
    .map(key => key.slice(prefix.length))
    .filter(id => id.startsWith('qa-snap-'));
  const indexed = await readIndex(ownerUserId);
  return [...new Set([...indexed, ...actual])];
}

async function removeSnapLabActivityRecord(ownerUserId: string, activityId: string): Promise<void> {
  const key = recordKey(ownerUserId, activityId);
  await removeEncodedRecord(key);
  if (await readEncodedRecord(key) !== null) throw new Error('snap_lab_activity_cleanup_incomplete');
}

export function configureSnapLabRun(
  context: SnapLabRunContext,
  fetchImpl?: typeof fetch,
  receiptReader?: () => SnapLabTransportReceipt[],
): void {
  activeContext = { ...context };
  activeFetch = fetchImpl ?? null;
  activeReceiptReader = receiptReader ?? null;
}

export function clearSnapLabRunConfiguration(): void {
  activeContext = null;
  activeFetch = null;
  activeReceiptReader = null;
}

export function updateSnapLabRunContext(patch: Partial<SnapLabRunContext>): SnapLabRunContext {
  activeContext = { ...currentSnapLabRunContext(), ...patch };
  return { ...activeContext };
}

export function snapLabTransportConfigured(): boolean {
  return activeFetch !== null;
}

export function currentSnapLabRunContext(): SnapLabRunContext {
  return activeContext ? { ...activeContext } : {
    caseId: 'manual-replay',
    profileId: 'interactive',
    seed: 1,
    networkCondition: 'offline',
    transportMode: 'offline',
    evidenceLabel: 'LOCAL_ONLY',
    clockSpeed: 1,
  };
}

function validRecord(
  value: unknown,
  ownerUserId: string,
  activityId: string,
): value is SnapLabActivityRecord {
  const record = value as SnapLabActivityRecord | null;
  return record?.format === 'cairn-snap-lab-activity'
    && record.version === 1
    && record.realm === 'snap-lab'
    && record.ownerUserId === ownerUserId
    && record.activityId === activityId
    && record.session?.qaProvenance === 'snap_lab'
    && Array.isArray(record.selectedFinal);
}

async function readIndex(ownerUserId: string): Promise<string[]> {
  const raw = await storage.getItem(indexKey(ownerUserId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string' && id.startsWith('qa-snap-'))
      : [];
  } catch {
    return [];
  }
}

export async function saveSnapLabActivity(record: SnapLabActivityRecord): Promise<void> {
  if (!validRecord(record, record.ownerUserId, record.activityId)) {
    throw new Error('snap_lab_activity_invalid');
  }
  const run = writeTail.then(async () => {
    const encoded = JSON.stringify(record);
    const key = recordKey(record.ownerUserId, record.activityId);
    await writeEncodedRecord(key, encoded);
    if (await readEncodedRecord(key) !== encoded) throw new Error('snap_lab_activity_verify_failed');
    const existing = await enumerateSnapLabActivityIds(record.ownerUserId, false);
    const ordered = [record.activityId, ...existing.filter(id => id !== record.activityId)];
    const next = ordered.slice(0, MAX_RECORDS);
    await storage.setItem(indexKey(record.ownerUserId), JSON.stringify(next), { strict: true });
    // Retention is a privacy boundary, not only an index cap. Remove evicted
    // coordinates and their isolated WAL before considering the save complete.
    const evicted = ordered.slice(MAX_RECORDS);
    if (evicted.length > 0) {
      const writer = await import('../../services/hikeTrackWriter');
      for (const activityId of evicted) {
        await writer.deleteSnapLabHikeTrackForOwner(activityId, record.ownerUserId);
        await removeSnapLabActivityRecord(record.ownerUserId, activityId);
      }
    }
  });
  writeTail = run.catch(() => {});
  await run;
}

export async function loadSnapLabActivity(
  ownerUserId: string,
  activityId: string,
): Promise<SnapLabActivityRecord | null> {
  await writeTail.catch(() => {});
  const raw = await readEncodedRecord(recordKey(ownerUserId, activityId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return validRecord(parsed, ownerUserId, activityId) ? parsed : null;
  } catch {
    return null;
  }
}

export async function deleteSnapLabActivityForOwner(
  ownerUserId: string,
  activityId: string,
): Promise<void> {
  if (!activityId.startsWith('qa-snap-')) throw new Error('snap_lab_activity_identity_required');
  const run = writeTail.then(async () => {
    await removeSnapLabActivityRecord(ownerUserId, activityId);
    const remaining = (await readIndex(ownerUserId)).filter(id => id !== activityId);
    if (remaining.length > 0) {
      await storage.setItem(indexKey(ownerUserId), JSON.stringify(remaining), { strict: true });
    } else {
      await storage.removeItem(indexKey(ownerUserId), { strict: true });
    }
  });
  writeTail = run.catch(() => {});
  await run;
}

export async function listSnapLabActivities(ownerUserId: string): Promise<SnapLabActivityRecord[]> {
  const ids = await enumerateSnapLabActivityIds(ownerUserId);
  const records = await Promise.all(ids.map(id => loadSnapLabActivity(ownerUserId, id)));
  return records.filter((record): record is SnapLabActivityRecord => record !== null);
}

export async function saveSnapLabRouteSnapshot(
  ownerUserId: string,
  activityId: string,
  name: string,
): Promise<SnapLabRouteSnapshot> {
  const record = await loadSnapLabActivity(ownerUserId, activityId);
  if (!record) throw new Error('snap_lab_activity_missing');
  const snapshot: SnapLabRouteSnapshot = {
    id: `qa-route-${activityId}-${Date.now().toString(36)}`,
    name: name.trim().slice(0, 80) || 'QA Route snapshot',
    createdAt: Date.now(),
    sourceActivityId: activityId,
    artifactRevision: record.session.finalGeometryRevision ?? 1,
    artifactFingerprint: record.session.finalGeometryFingerprint
      ?? activityGeometryFingerprint(record.selectedFinal),
    points: record.selectedFinal.map(point => ({ ...point })),
  };
  await recordActivityStageEvent({
    ownerUserId,
    clientActivityId: activityId,
    stage: 'detail-selected',
    details: {
      realm: 'snap-lab',
      consumer: 'qa-save-as-route',
      artifactRevision: snapshot.artifactRevision,
      artifactFingerprint: snapshot.artifactFingerprint,
    },
  });
  await flushActivityStageLedger(ownerUserId);
  const stageLedger = await exportLatestActivityStageLedger(ownerUserId, 'snap-lab');
  await saveSnapLabActivity({
    ...record,
    routeSnapshots: [...record.routeSnapshots, snapshot],
    stageLedger,
  });
  return snapshot;
}

/** Persist a cold/open Detail consumer receipt back into the exportable QA
 * record. It records selected identity only; no coordinates enter the ledger. */
export async function recordSnapLabDetailLoaded(
  ownerUserId: string,
  activityId: string,
): Promise<void> {
  const record = await loadSnapLabActivity(ownerUserId, activityId);
  if (!record) throw new Error('snap_lab_activity_missing');
  await recordActivityStageEvent({
    ownerUserId,
    clientActivityId: activityId,
    stage: 'detail-selected',
    details: {
      realm: 'snap-lab',
      consumer: 'activity-detail',
      artifactRevision: record.session.finalGeometryRevision ?? 1,
      artifactFingerprint: record.session.finalGeometryFingerprint
        ?? activityGeometryFingerprint(record.selectedFinal),
      loadKind: 'persisted-qa-record',
    },
  });
  await flushActivityStageLedger(ownerUserId);
  const stageLedger = await exportLatestActivityStageLedger(ownerUserId, 'snap-lab');
  await saveSnapLabActivity({ ...record, stageLedger });
}

/** Explicit owner-scoped cleanup. It is never called automatically after a
 * successful matrix so the owner can inspect the preserved Activities. */
export async function clearSnapLabActivities(ownerUserId: string): Promise<void> {
  const ids = await enumerateSnapLabActivityIds(ownerUserId);
  const run = writeTail.then(async () => {
    for (const id of ids) await removeSnapLabActivityRecord(ownerUserId, id);
    await storage.removeItem(indexKey(ownerUserId), { strict: true });
    const remaining = (await encodedRecordKeys()).filter(key => (
      key.startsWith(`${RECORD_PREFIX}${ownerUserId}:`)
    ));
    if (remaining.length > 0) throw new Error('snap_lab_activity_cleanup_incomplete');
  });
  writeTail = run.catch(() => {});
  await run;
}

/** Explicit owner action for the complete QA realm. Every dependency below
 * has a Snap-Lab-specific storage boundary; product Activities and Personal
 * Memory are deliberately outside this cleanup transaction. */
export async function clearSnapLabRealmForOwner(ownerUserId: string): Promise<void> {
  const writer = await import('../../services/hikeTrackWriter');
  await writer.purgeSnapLabHikeTracksForOwner(ownerUserId);
  const [{ purgeSnapLabActivityRegistryForOwner }, { purgeActivityStageLedgerRealmForOwner }, memory] = await Promise.all([
    import('../activity/activityRegistry'),
    import('../activity/activityStageLedger'),
    import('../memory/services/memoryPersistence'),
  ]);
  await clearSnapLabActivities(ownerUserId);
  await purgeSnapLabActivityRegistryForOwner(ownerUserId);
  await purgeActivityStageLedgerRealmForOwner(ownerUserId, 'snap-lab');
  await memory.clearSyntheticMemoryForUser(ownerUserId);
  if ((await enumerateSnapLabActivityIds(ownerUserId)).length > 0
    || (await writer.listSnapLabHikeTrackIdsForOwner(ownerUserId)).length > 0) {
    throw new Error('snap_lab_realm_cleanup_incomplete');
  }
}

function projectSelectedSegment(source: SegmentedTrackPoint[], points: Array<{
  lat: number;
  lng: number;
  alt?: number | null;
  t?: number;
}>): SegmentedTrackPoint[] {
  const first = source[0];
  const last = source[source.length - 1];
  return points.map((point, index) => ({
    lat: point.lat,
    lng: point.lng,
    ...(point.alt != null ? { alt: point.alt } : {}),
    t: point.t ?? first.t + Math.round((last.t - first.t) * index / Math.max(1, points.length - 1)),
    segmentId: first.segmentId,
    ...(index === 0 && first.segmentStartReason
      ? { segmentStartReason: first.segmentStartReason }
      : {}),
  }));
}

/** Runs the exact production request builder, gates, selector and assembler,
 * but with a QA-controlled HTTP boundary and no production governor ledger. */
export async function runSnapLabFinal(canonical: TrackPoint[]): Promise<SnapLabFinalRun> {
  const context = currentSnapLabRunContext();
  const localFinal = buildLocalFinalTrackPoints(canonical);
  if (context.transportMode === 'offline') {
    return {
      localFinal,
      selectedFinal: localFinal,
      selectedSource: 'local',
      segmentStats: [],
      requestCount: 0,
      directionsRequestCount: 0,
      acceptedIslandCount: 0,
      transportReceipts: [],
    };
  }
  if (!activeFetch) throw new Error('snap_lab_transport_unconfigured');

  const sourceSegments = segmentTrace(canonical).segments;
  const selectedSegments = segmentTrace(localFinal).segments.map(segment => segment.slice());
  if (sourceSegments.length !== selectedSegments.length) throw new Error('snap_lab_segment_structure_mismatch');
  const segmentStats: PedestrianFinalStats[] = [];
  let matchedSegmentCount = 0;
  let acceptedIslandCount = 0;
  let hasLocalCoverage = false;
  for (const [segmentIndex, segment] of sourceSegments.entries()) {
    if (segment.length < 2) continue;
    const result = await reconstructPedestrianFinalRoute(segment, {
      mapboxToken: 'snap-lab-isolated-authority',
      fetchImpl: activeFetch,
      totalTimeoutMs: 10_000,
      perCallTimeoutMs: 2_600,
      concurrency: 2,
      maxDirectionsRequests: 2,
      requestPhase: 'final',
      requestReason: `snap-lab:${context.caseId}:${context.profileId}`,
    });
    segmentStats.push(result.stats);
    if (!result.ok || result.points.length < 2 || result.stats.acceptedMatchedDistanceM <= 0.5) {
      hasLocalCoverage = true;
      continue;
    }
    selectedSegments[segmentIndex] = projectSelectedSegment(segment, result.points);
    matchedSegmentCount += 1;
    acceptedIslandCount += result.stats.matchedIslandCount + result.stats.directionsIslandCount;
    if (result.stats.canonicalFallbackDistanceM > 0.5) hasLocalCoverage = true;
  }
  const selectedFinal = selectedSegments.flat();
  return {
    localFinal,
    selectedFinal,
    selectedSource: matchedSegmentCount === 0
      ? 'local'
      : hasLocalCoverage || matchedSegmentCount < sourceSegments.length ? 'hybrid' : 'matched',
    segmentStats,
    requestCount: segmentStats.reduce((sum, stats) => sum + stats.mapMatchingRequestCount, 0),
    directionsRequestCount: segmentStats.reduce((sum, stats) => sum + stats.directionsRequestCount, 0),
    acceptedIslandCount,
    transportReceipts: activeReceiptReader?.() ?? [],
  };
}

/** One explicit post-Finish road-aware opportunity for an offline QA Activity.
 * The immutable canonical evidence, metrics, QA Memory, and any already-saved
 * route snapshot are untouched. A second invocation is a persisted no-op. */
export async function upgradeSnapLabActivityOnce(
  ownerUserId: string,
  activityId: string,
): Promise<{ status: 'upgraded' | 'retained-local' | 'already-terminal'; record: SnapLabActivityRecord }> {
  const record = await loadSnapLabActivity(ownerUserId, activityId);
  if (!record) throw new Error('snap_lab_activity_missing');
  if (record.roadUpgrade || record.session.finalGeometryRevision !== 1
    || record.session.roadRefinementPending !== true) {
    return { status: 'already-terminal', record };
  }
  const run = await runSnapLabFinal(record.canonicalPoints);
  const previousFingerprint = record.session.finalGeometryFingerprint
    ?? activityGeometryFingerprint(record.selectedFinal);
  const upgraded = run.selectedSource !== 'local'
    && run.acceptedIslandCount > 0
    && activityGeometryFingerprint(run.selectedFinal) !== previousFingerprint;
  const selectedFinal = upgraded ? run.selectedFinal : record.selectedFinal;
  const selectedFingerprint = activityGeometryFingerprint(selectedFinal);
  const attemptedAt = Date.now();
  const next: SnapLabActivityRecord = {
    ...record,
    selectedFinal: selectedFinal.map(point => ({ ...point })),
    selectedSource: upgraded ? run.selectedSource : record.selectedSource,
    segmentStats: run.segmentStats,
    requestCount: record.requestCount + run.requestCount,
    directionsRequestCount: record.directionsRequestCount + run.directionsRequestCount,
    acceptedIslandCount: upgraded ? run.acceptedIslandCount : record.acceptedIslandCount,
    transportReceipts: [...record.transportReceipts, ...run.transportReceipts],
    session: {
      ...record.session,
      trackPoints: selectedFinal.map(point => ({ ...point })),
      finalGeometryState: upgraded ? 'enhanced' : 'base_ready',
      finalGeometryRevision: upgraded ? 2 : 1,
      finalGeometryFingerprint: selectedFingerprint,
      roadRefinementPending: false,
    },
    roadUpgrade: {
      attemptedAt,
      attemptCount: 1,
      outcome: upgraded ? 'upgraded' : 'retained-local',
      previousFingerprint,
      selectedFingerprint,
      requestCount: run.requestCount,
      directionsRequestCount: run.directionsRequestCount,
      transportReceipts: run.transportReceipts,
    },
  };
  await recordActivityStageEvent({
    ownerUserId,
    clientActivityId: activityId,
    stage: 'final-selected',
    details: {
      realm: 'snap-lab',
      selectedSource: next.selectedSource,
      artifactRevision: next.session.finalGeometryRevision,
      artifactFingerprint: selectedFingerprint,
      postFinishUpgrade: true,
      outcome: next.roadUpgrade?.outcome,
    },
  });
  await flushActivityStageLedger(ownerUserId);
  next.stageLedger = await exportLatestActivityStageLedger(ownerUserId, 'snap-lab');
  await saveSnapLabActivity(next);
  return { status: upgraded ? 'upgraded' : 'retained-local', record: next };
}

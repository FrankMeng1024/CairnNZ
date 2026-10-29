import { resolveMapboxPublicTokenAuthority } from '../../config/mapbox';
import { storage } from '../../store/storage';
import { useAppStore } from '../../store/useAppStore';
import { useSessionStore, type TrackPoint } from '../../store/useSessionStore';
import {
  analyzeTrustedEndpointCoverage,
  evaluateMatchedGeometryQuality,
  preserveTrustedRouteEndpoints,
} from '../../services/routing/snapTrack';
import {
  reconstructPedestrianFinalRoute,
  type PedestrianFinalRequestResult,
  type PedestrianFinalStats,
} from '../../services/routing/pedestrianFinalRoute';
import { createActivityMapboxRequestGovernor } from '../../services/routing/activityRequestGovernor';
import { networkMonitor } from '../../services/networkMonitor';
import {
  finishPendingPreparation,
  readPendingReadonly,
  updatePendingRoadRefinementIfPresent,
} from '../../services/pendingSyncStore';
import { appendSimulatorLog } from '../activitySimulator/simulatorLog';
import { segmentTrace, toServerPoint } from './activityContracts';
import {
  activityGeometryFingerprint,
  commitActivityFinalArtifact,
  loadActivityFinalArtifact,
  type ActivityFinalArtifact,
} from './activityFinalArtifact';
import { recordActivityStageEvent } from './activityStageLedger';
import {
  activityFinalRefinementRequestCategory,
  decideActivityFinalCandidatePromotion,
  decideRetainedLocalRefinement,
  selectRoundedActivityFinalCandidate,
} from './activityFinalRefinementDecision';
import { recordActivityDiagnosticProviderExchange } from './activityDiagnosticReplay';

export interface ActivityFinalRefinementJob {
  format: 'cairn-activity-final-refinement';
  version: 1 | 2;
  ownerUserId: string;
  clientActivityId: string;
  expectedBaseRevision: number;
  canonicalFingerprint: string;
  status: 'queued' | 'running' | 'complete' | 'cancelled';
  outcome: 'pending' | 'enhanced' | 'limited' | 'base-retained' | 'action-required' | 'deleted' | 'owner-deferred';
  attemptCount: number;
  createdAt: number;
  updatedAt: number;
  completedRevision: number | null;
  lastError: string | null;
  technicalOutcome?: string | null;
  selectedSource?: ActivityFinalArtifact['source'] | null;
  selectedFingerprint?: string | null;
  /** Safe authority provenance label only; the credential is never persisted. */
  authoritySource?: string | null;
  matchingAttempted?: boolean;
  governorAuthorized?: boolean | null;
  candidateDecision?: string | null;
  requestHttpCategory?: 'not-attempted' | 'success' | 'no-match' | 'auth' | 'timeout' | 'network' | 'client-error' | 'server-error' | 'mixed' | null;
  selectionErrorCategory?: 'execution-error' | 'canonical-mismatch' | 'revision-contaminated' | null;
  roadEnhancementState?: 'pending-network' | 'pending-retry' | 'running' | 'terminal-local' | 'accepted';
  networkAttemptCount?: number;
  nextRetryAt?: number | null;
  /** v2 owns all immutable refinement inputs after upload outbox cleanup. */
  input?: {
    canonicalPoints: TrackPoint[];
    basePoints: TrackPoint[];
    activityMode: 'hiking' | 'running';
    startedAt: number;
    durationS: number;
  };
  revisionOperationId?: string;
  serverRevisionState?: 'not-required' | 'pending-base' | 'pending-retry' | 'publishing' | 'ack' | 'conflict';
  serverRevisionAttemptCount?: number;
}

export type ActivityFinalRefinementRunResult =
  | 'complete'
  | 'pending-network'
  | 'pending-retry'
  | 'cancelled'
  | 'deferred-owner'
  | 'absent';

const ROOT = '@cairn:activity_final_refinement:v1:';
const INDEX = '@cairn:activity_final_refinement:index:v1:';
const flights = new Map<string, Promise<ActivityFinalRefinementRunResult>>();
const controllers = new Map<string, AbortController>();
const jobWriteTails = new Map<string, Promise<void>>();
const indexWriteTails = new Map<string, Promise<void>>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const MAX_NETWORK_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [5_000, 30_000] as const;

function scheduleRetryWake(job: ActivityFinalRefinementJob): void {
  const key = jobKey(job.ownerUserId, job.clientActivityId);
  const existingTimer = retryTimers.get(key);
  if (existingTimer) clearTimeout(existingTimer);
  retryTimers.delete(key);
  if (job.status !== 'queued' || job.nextRetryAt == null) return;
  const timer = setTimeout(() => {
    retryTimers.delete(key);
    void resumeActivityFinalRefinement(job.ownerUserId, job.clientActivityId).catch(() => undefined);
  }, Math.max(50, job.nextRetryAt - Date.now()));
  (timer as any)?.unref?.();
  retryTimers.set(key, timer);
}

export function confidentRoadCornerMask(
  pointCount: number,
  stats: PedestrianFinalStats,
): boolean[] {
  const mask = Array.from({ length: pointCount }, () => false);
  const sections = Array.isArray(stats.sections) ? stats.sections : [];
  for (let index = 1; index < pointCount - 1; index += 1) {
    const section = sections.find(candidate => (
      candidate.displayStart != null
      && candidate.displayEnd != null
      && index - 1 >= candidate.displayStart
      && index + 1 <= candidate.displayEnd
    ));
    if (!section) continue;
    const strongLocalRoadAuthority = section.decision === 'refined'
      && section.networkSource === 'map-matching'
      && (section.geometryMode === 'A_PEDESTRIAN_NETWORK'
        || section.geometryMode === 'B_ROAD_OFFSET')
      && section.confidence >= 0.75
      && section.corridorEvidence?.accepted === true
      && section.seam?.accepted === true
      && section.promotionUtility?.accepted === true
      && section.promotionUtility.networkAuthority === 'strong';
    mask[index] = strongLocalRoadAuthority;
  }
  return mask;
}

const jobKey = (ownerUserId: string, clientActivityId: string) => `${ROOT}${ownerUserId}:${clientActivityId}`;
const indexKey = (ownerUserId: string) => `${INDEX}${ownerUserId}`;

function validJob(value: any, ownerUserId: string, clientActivityId: string): value is ActivityFinalRefinementJob {
  return value?.format === 'cairn-activity-final-refinement'
    && (value.version === 1 || value.version === 2)
    && value.ownerUserId === ownerUserId
    && value.clientActivityId === clientActivityId
    && Number.isInteger(value.expectedBaseRevision)
    && typeof value.canonicalFingerprint === 'string';
}

function jobInputFromPending(
  pending: Awaited<ReturnType<typeof readPendingReadonly>>,
  baseArtifact: ActivityFinalArtifact,
): NonNullable<ActivityFinalRefinementJob['input']> | null {
  if (!pending || !Array.isArray(pending.payload.route_points_canonical)) return null;
  const canonicalPoints = pending.payload.route_points_canonical.map(fromPendingPoint);
  if (canonicalPoints.length < 2 || baseArtifact.points.length < 2) return null;
  return {
    canonicalPoints,
    basePoints: baseArtifact.points.map(point => ({ ...point })),
    activityMode: pending.activityMode,
    startedAt: pending.summary?.startedAt ?? pending.startedAt ?? pending.createdAt,
    durationS: pending.summary?.durationS ?? pending.payload.duration_s,
  };
}

async function ensureJobInput(
  job: ActivityFinalRefinementJob,
  baseArtifact: ActivityFinalArtifact,
): Promise<ActivityFinalRefinementJob | null> {
  if (job.input && job.input.canonicalPoints.length >= 2 && job.input.basePoints.length >= 2) return job;
  const pending = await readPendingReadonly(job.clientActivityId);
  if (!pending || pending.userId !== job.ownerUserId) return null;
  const input = jobInputFromPending(pending, baseArtifact);
  if (!input) return null;
  const upgraded: ActivityFinalRefinementJob = {
    ...job,
    version: 2,
    input,
    revisionOperationId: job.revisionOperationId ?? require('../../services/offlineQueue').uuidv4(),
    serverRevisionState: job.serverRevisionState ?? 'not-required',
    serverRevisionAttemptCount: job.serverRevisionAttemptCount ?? 0,
    updatedAt: Date.now(),
  };
  await writeJob(upgraded);
  return upgraded;
}

async function readJob(ownerUserId: string, clientActivityId: string): Promise<ActivityFinalRefinementJob | null> {
  const raw = await storage.getItem(jobKey(ownerUserId, clientActivityId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return validJob(parsed, ownerUserId, clientActivityId) ? parsed : null;
  } catch {
    return null;
  }
}

async function withJobMutation<T>(
  ownerUserId: string,
  clientActivityId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = jobKey(ownerUserId, clientActivityId);
  const previous = jobWriteTails.get(key)?.catch(() => undefined) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>(resolve => { release = resolve; });
  jobWriteTails.set(key, next);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (jobWriteTails.get(key) === next) jobWriteTails.delete(key);
  }
}

async function writeJob(job: ActivityFinalRefinementJob): Promise<void> {
  await withJobMutation(job.ownerUserId, job.clientActivityId, async () => {
    const existing = await readJob(job.ownerUserId, job.clientActivityId);
    // Durable cancellation is monotonic. A stale async completion must never
    // revive a deleted job after the cancel write wins.
    if (existing?.status === 'cancelled' && job.status !== 'cancelled') return;
    const encoded = JSON.stringify(job);
    const key = jobKey(job.ownerUserId, job.clientActivityId);
    await storage.setItem(key, encoded, { strict: true });
    if (await storage.getItem(key) !== encoded) throw new Error('activity_refinement_job_verify_failed');
  });
  scheduleRetryWake(job);
}

async function stoppedRunResult(
  job: ActivityFinalRefinementJob,
  signal: AbortSignal,
): Promise<Exclude<ActivityFinalRefinementRunResult, 'complete' | 'absent'> | null> {
  const current = await readJob(job.ownerUserId, job.clientActivityId);
  if (signal.aborted || !current || current.status === 'cancelled') {
    finishPendingPreparation(job.clientActivityId);
    return 'cancelled';
  }
  const ownerCurrent = useAppStore.getState().isLoggedIn
    && String(useAppStore.getState().user?.id ?? '') === job.ownerUserId;
  if (ownerCurrent) return null;
  await writeJob({
    ...current,
    status: 'queued',
    outcome: 'owner-deferred',
    updatedAt: Date.now(),
  });
  finishPendingPreparation(job.clientActivityId);
  return (await readJob(job.ownerUserId, job.clientActivityId))?.status === 'cancelled'
    ? 'cancelled'
    : 'deferred-owner';
}

async function withIndexMutation(ownerUserId: string, operation: () => Promise<void>): Promise<void> {
  const key = indexKey(ownerUserId);
  const previous = indexWriteTails.get(key)?.catch(() => undefined) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>(resolve => { release = resolve; });
  indexWriteTails.set(key, next);
  await previous;
  try {
    await operation();
  } finally {
    release();
    if (indexWriteTails.get(key) === next) indexWriteTails.delete(key);
  }
}

async function readIndex(ownerUserId: string): Promise<string[]> {
  try {
    const raw = await storage.getItem(indexKey(ownerUserId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter(id => typeof id === 'string' && id.length > 0))]
      : [];
  } catch {
    return [];
  }
}

async function writeVerifiedIndex(ownerUserId: string, ids: string[]): Promise<void> {
  const encoded = JSON.stringify(ids);
  const key = indexKey(ownerUserId);
  await storage.setItem(key, encoded, { strict: true });
  if (await storage.getItem(key) !== encoded) throw new Error('activity_refinement_index_verify_failed');
}

async function addToIndex(ownerUserId: string, clientActivityId: string): Promise<void> {
  await withIndexMutation(ownerUserId, async () => {
    const ids = await readIndex(ownerUserId);
    if (!ids.includes(clientActivityId)) ids.push(clientActivityId);
    if (ids.length <= 128) {
      await writeVerifiedIndex(ownerUserId, ids);
      return;
    }

    // Never strand a queued/running user operation merely to meet a retention
    // cap. Keep every active job, then fill the remaining 128-slot budget with
    // the newest terminal records. Every evicted terminal key is deleted in the
    // same serialized index mutation, so exact GPS cannot become an unlisted
    // orphan when the index rolls over.
    const jobs = await Promise.all(ids.map(id => readJob(ownerUserId, id)));
    const keep = new Set<string>();
    ids.forEach((id, index) => {
      if (jobs[index]?.status === 'queued' || jobs[index]?.status === 'running') keep.add(id);
    });
    for (let index = ids.length - 1; index >= 0 && keep.size < 128; index -= 1) {
      keep.add(ids[index]);
    }
    const evicted = ids.filter(id => !keep.has(id));
    if (evicted.length > 0) {
      await storage.removeItemsStrict(evicted.map(id => jobKey(ownerUserId, id)));
    }
    await writeVerifiedIndex(ownerUserId, ids.filter(id => keep.has(id)));
  });
}

async function removeFromIndex(ownerUserId: string, clientActivityId: string): Promise<void> {
  await withIndexMutation(ownerUserId, async () => {
    const ids = await readIndex(ownerUserId);
    await writeVerifiedIndex(ownerUserId, ids.filter(id => id !== clientActivityId));
  });
}

function fromPendingPoint(point: any): TrackPoint {
  return {
    lat: Number(point.lat),
    lng: Number(point.lng),
    t: Math.floor(Number(point.t)),
    ...(Number.isFinite(Number(point.alt)) ? { alt: Number(point.alt) } : {}),
    ...(Number.isFinite(Number(point.acc)) ? { accuracy: Number(point.acc) } : {}),
    ...(Number.isFinite(Number(point.v_acc)) ? { verticalAccuracy: Number(point.v_acc) } : {}),
    ...(Number.isFinite(Number(point.speed_mps)) ? { speed: Number(point.speed_mps) } : {}),
    ...(Number.isFinite(Number(point.course_deg)) ? { course: Number(point.course_deg) } : {}),
    ...(typeof point.segment_id === 'string'
      ? { segmentId: point.segment_id }
      : typeof point.segmentId === 'string' ? { segmentId: point.segmentId } : {}),
    ...(typeof point.segment_start_reason === 'string'
      ? { segmentStartReason: point.segment_start_reason }
      : typeof point.segmentStartReason === 'string'
        ? { segmentStartReason: point.segmentStartReason }
        : {}),
  } as TrackPoint;
}

function stateForArtifact(artifact: ActivityFinalArtifact): 'base_ready' | 'enhanced' | 'limited_evidence' {
  if (artifact.source === 'matched' || artifact.source === 'hybrid') return 'enhanced';
  if (artifact.source === 'base') return 'base_ready';
  return 'limited_evidence';
}

async function publishStableLocalPending(
  job: ActivityFinalRefinementJob,
  artifact: ActivityFinalArtifact,
  roadState: 'pending-network' | 'pending-retry',
  nextRetryAt: number | null,
  signal: AbortSignal,
): Promise<ActivityFinalRefinementRunResult> {
  const stopped = await stoppedRunResult(job, signal);
  if (stopped) return stopped;
  const pending = await readPendingReadonly(job.clientActivityId);
  const currentJob = await readJob(job.ownerUserId, job.clientActivityId);
  if (!currentJob || currentJob.status === 'cancelled') {
    finishPendingPreparation(job.clientActivityId);
    return 'cancelled';
  }
  if (!pending) {
    await writeJob({
      ...currentJob,
      status: 'queued',
      outcome: 'pending',
      selectedSource: artifact.source,
      selectedFingerprint: artifact.displayFingerprint,
      roadEnhancementState: roadState,
      nextRetryAt,
      updatedAt: Date.now(),
    });
    finishPendingPreparation(job.clientActivityId);
    return roadState;
  }
  if (pending.userId !== job.ownerUserId) return 'deferred-owner';
  // This operation is atomic with ACK cleanup. A stale Mapbox completion may
  // update the outbox only while it still exists; it cannot recreate an
  // acknowledged upload or regress an already-synced Activity card. The
  // initial payload/identity remains frozen and the durable job below owns any
  // eventual display-only server revision.
  await updatePendingRoadRefinementIfPresent({
    localId: job.clientActivityId,
    expectedUserId: job.ownerUserId,
    state: roadState,
    nextRetryAt,
  });
  await writeJob({
    ...currentJob,
    status: 'queued',
    outcome: 'pending',
    completedRevision: null,
    selectedSource: artifact.source,
    selectedFingerprint: artifact.displayFingerprint,
    roadEnhancementState: roadState,
    nextRetryAt,
    updatedAt: Date.now(),
  });
  void recordActivityStageEvent({
    ownerUserId: job.ownerUserId,
    clientActivityId: job.clientActivityId,
    stage: 'final-selected',
    details: {
      outcome: 'pending',
      roadEnhancementState: roadState,
      technicalOutcome: currentJob.technicalOutcome ?? null,
      authoritySource: currentJob.authoritySource ?? null,
      matchingAttempted: currentJob.matchingAttempted ?? false,
      governorAuthorized: currentJob.governorAuthorized ?? null,
      requestHttpCategory: currentJob.requestHttpCategory ?? 'not-attempted',
      candidateDecision: currentJob.candidateDecision ?? null,
      selectedSource: artifact.source,
      selectedDisplayMode: artifact.displayMode ?? null,
      selectedRevision: artifact.revision,
      selectedFingerprint: artifact.displayFingerprint,
      nextRetryAt,
    },
  });
  finishPendingPreparation(job.clientActivityId);
  return roadState;
}

async function publishArtifactAndRelease(
  job: ActivityFinalRefinementJob,
  artifact: ActivityFinalArtifact,
  outcome: ActivityFinalRefinementJob['outcome'],
  signal?: AbortSignal,
): Promise<ActivityFinalRefinementRunResult> {
  if (signal) {
    const stopped = await stoppedRunResult(job, signal);
    if (stopped) return stopped;
  }
  const pending = await readPendingReadonly(job.clientActivityId);
  if (pending && pending.userId !== job.ownerUserId) return 'deferred-owner';
  const currentJob = await readJob(job.ownerUserId, job.clientActivityId);
  if (!currentJob || currentJob.status === 'cancelled') {
    finishPendingPreparation(job.clientActivityId);
    return 'cancelled';
  }
  // The initial Base upload is an immutable snapshot owned exclusively by
  // Finish/syncDaemon. Optional refinement owns its durable artifact and job;
  // it must never rewrite (or recreate after ACK) the upload outbox. This is
  // also true if process recovery observes the old preparation window.
  if (signal) {
    const stopped = await stoppedRunResult(job, signal);
    if (stopped) return stopped;
  }
  if (pending?.summary) {
    const existing = useSessionStore.getState().sessions.find(session => (
      session.clientActivityId === job.clientActivityId || session.id === job.clientActivityId
    ));
    await useSessionStore.getState().addSession({
      id: job.clientActivityId,
      clientActivityId: job.clientActivityId,
      remoteId: pending.remoteId ?? undefined,
      serverActivityId: pending.remoteId ?? undefined,
      activityMode: pending.activityMode,
      regionCode: existing?.regionCode ?? 'nz',
      startedAt: pending.summary.startedAt,
      endedAt: pending.summary.endedAt,
      durationS: pending.summary.durationS,
      distanceM: pending.summary.distanceM,
      elevationGainM: pending.summary.elevationGainM,
      trackPoints: artifact.points,
      markerIds: pending.summary.markerIds,
      name: pending.summary.name,
      memoryNewCells: existing?.memoryNewCells ?? 0,
      // Geometry publication and cloud acknowledgement are independent.
      // Preserve the strongest state observed before entering addSession's
      // serialized mutation boundary; addSession additionally fences a
      // concurrent ACK that lands after this snapshot.
      syncState: existing?.syncState ?? 'pending',
      finalGeometryState: stateForArtifact(artifact),
      finalGeometryVersion: artifact.algorithmVersion,
      finalGeometryRevision: artifact.revision,
      finalGeometryFingerprint: artifact.displayFingerprint,
      roadRefinementPending: false,
    }, job.ownerUserId);
  }
  if (signal) {
    const stopped = await stoppedRunResult(job, signal);
    if (stopped) return stopped;
  }
  const needsServerRevision = currentJob.candidateDecision === 'accepted'
    && artifact.revision > currentJob.expectedBaseRevision;
  await writeJob({
    ...currentJob,
    status: needsServerRevision ? 'queued' : 'complete',
    outcome,
    completedRevision: artifact.revision,
    selectedSource: artifact.source,
    selectedFingerprint: artifact.displayFingerprint,
    roadEnhancementState: currentJob.candidateDecision === 'accepted' ? 'accepted' : 'terminal-local',
    serverRevisionState: needsServerRevision
      ? (pending ? 'pending-base' : 'pending-retry')
      : 'not-required',
    nextRetryAt: needsServerRevision && pending ? null : null,
    updatedAt: Date.now(),
    lastError: currentJob.lastError ?? null,
  });
  void recordActivityStageEvent({
    ownerUserId: job.ownerUserId,
    clientActivityId: job.clientActivityId,
    stage: 'final-selected',
    details: {
      outcome,
      technicalOutcome: currentJob.technicalOutcome ?? null,
      authoritySource: currentJob.authoritySource ?? null,
      matchingAttempted: currentJob.matchingAttempted ?? false,
      governorAuthorized: currentJob.governorAuthorized ?? null,
      requestHttpCategory: currentJob.requestHttpCategory ?? 'not-attempted',
      candidateDecision: currentJob.candidateDecision ?? null,
      selectionErrorCategory: currentJob.selectionErrorCategory ?? null,
      roadEnhancementState: currentJob.candidateDecision === 'accepted' ? 'accepted' : 'terminal-local',
      selectedSource: artifact.source,
      selectedDisplayMode: artifact.displayMode ?? null,
      selectedRevision: artifact.revision,
      selectedFingerprint: artifact.displayFingerprint,
    },
  });
  finishPendingPreparation(job.clientActivityId);
  appendSimulatorLog('ACTIVITY_COMPLETION', 'activity_final_refinement_completed', {
    outcome,
    revision: artifact.revision,
    source: artifact.source,
    displayFingerprint: artifact.displayFingerprint,
  }, { userId: job.ownerUserId, clientActivityId: job.clientActivityId, coordinateSource: 'none' });
  if (needsServerRevision && !pending) {
    return publishAcceptedServerRevision(currentJob, artifact, signal);
  }
  try {
    // Lazy wake avoids a static cycle through pendingSyncStore. Upload sees
    // exactly one ready payload revision and retains its original idempotency
    // key; no Base/refined mutation can race the same request identity.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { drainPending } = require('../../services/syncDaemon');
    void drainPending({ wakeReason: 'manual', force: true }).catch(() => undefined);
  } catch { /* foreground/connectivity wakes remain durable fallbacks */ }
  return 'complete';
}

async function publishAcceptedServerRevision(
  job: ActivityFinalRefinementJob,
  artifact: ActivityFinalArtifact,
  signal?: AbortSignal,
): Promise<ActivityFinalRefinementRunResult> {
  if (signal) {
    const stopped = await stoppedRunResult(job, signal);
    if (stopped) return stopped;
  }
  const latest = await readJob(job.ownerUserId, job.clientActivityId);
  if (!latest || latest.status === 'cancelled') return 'cancelled';
  const input = latest.input;
  if (!input || !latest.revisionOperationId) {
    await writeJob({
      ...latest,
      status: 'complete',
      outcome: 'action-required',
      lastError: 'legacy-input-unavailable',
      roadEnhancementState: 'terminal-local',
      serverRevisionState: 'conflict',
      updatedAt: Date.now(),
    });
    return 'complete';
  }
  const attempt = (latest.serverRevisionAttemptCount ?? 0) + 1;
  await writeJob({
    ...latest,
    status: 'running',
    serverRevisionState: 'publishing',
    serverRevisionAttemptCount: attempt,
    nextRetryAt: null,
    updatedAt: Date.now(),
  });
  try {
    // Lazy import keeps normal Finish and Base upload free of this optional
    // network path, and makes lost-ACK replay use one durable operation UUID.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { reviseHikeFinalGeometry } = require('../../services/sessionService');
    await reviseHikeFinalGeometry({
      ownerUserId: latest.ownerUserId,
      clientActivityId: latest.clientActivityId,
      idempotencyKey: latest.revisionOperationId,
      expectedRevision: latest.expectedBaseRevision,
      expectedFingerprint: activityGeometryFingerprint(input.basePoints),
      revision: artifact.revision,
      displayFingerprint: artifact.displayFingerprint,
      canonicalFingerprint: artifact.canonicalFingerprint,
      algorithmVersion: artifact.algorithmVersion,
      routePoints: artifact.points.map(point => toServerPoint(point)),
    });
    const after = await readJob(latest.ownerUserId, latest.clientActivityId);
    if (!after || after.status === 'cancelled') return 'cancelled';
    await writeJob({
      ...after,
      status: 'complete',
      outcome: artifact.source === 'matched' || artifact.source === 'hybrid' ? 'enhanced' : 'limited',
      completedRevision: artifact.revision,
      selectedSource: artifact.source,
      selectedFingerprint: artifact.displayFingerprint,
      serverRevisionState: 'ack',
      nextRetryAt: null,
      lastError: null,
      updatedAt: Date.now(),
    });
    return 'complete';
  } catch (error: any) {
    const after = await readJob(latest.ownerUserId, latest.clientActivityId);
    if (!after || after.status === 'cancelled') return 'cancelled';
    const status = Number.isFinite(Number(error?.status)) ? Number(error.status) : 0;
    const conflict = status === 409;
    const basePending = status === 404;
    let conflictEvidence = 'server-cas-conflict';
    if (conflict) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { fetchHikeFinalGeometryByClientId } = require('../../services/sessionService');
        const remote = await fetchHikeFinalGeometryByClientId(
          latest.clientActivityId,
          latest.ownerUserId,
        );
        if (remote) {
          conflictEvidence = `server-cas-conflict:r${remote.revision}:${remote.displayFingerprint.slice(0, 16)}`;
        }
      } catch { /* the explicit conflict remains durable without readback */ }
    }
    const delay = Math.min(5_000 * Math.pow(2, Math.max(0, attempt - 1)), 30 * 60_000);
    await writeJob({
      ...after,
      status: conflict ? 'complete' : 'queued',
      outcome: conflict ? 'action-required' : after.outcome,
      serverRevisionState: conflict ? 'conflict' : basePending ? 'pending-base' : 'pending-retry',
      nextRetryAt: conflict ? null : Date.now() + delay,
      lastError: conflict ? conflictEvidence : basePending ? 'server-base-not-ready' : 'server-revision-retryable',
      updatedAt: Date.now(),
    });
    return conflict ? 'complete' : 'pending-retry';
  }
}

async function executeJob(job: ActivityFinalRefinementJob, signal: AbortSignal): Promise<ActivityFinalRefinementRunResult> {
  const currentOwner = useAppStore.getState().user?.id;
  if (!useAppStore.getState().isLoggedIn || String(currentOwner ?? '') !== job.ownerUserId) {
    await writeJob({ ...job, status: 'queued', outcome: 'owner-deferred', updatedAt: Date.now() });
    finishPendingPreparation(job.clientActivityId);
    return 'deferred-owner';
  }
  const loadedArtifact = await loadActivityFinalArtifact(job.ownerUserId, job.clientActivityId);
  if (!loadedArtifact) {
    await writeJob({
      ...job,
      status: 'complete',
      outcome: 'base-retained',
      lastError: 'artifact-unavailable',
      roadEnhancementState: 'terminal-local',
      serverRevisionState: 'not-required',
      nextRetryAt: null,
      updatedAt: Date.now(),
    });
    return 'complete';
  }
  const durableJob = await ensureJobInput(job, loadedArtifact);
  if (!durableJob) {
    await writeJob({
      ...job,
      status: 'complete',
      outcome: 'base-retained',
      lastError: 'legacy-input-unavailable',
      roadEnhancementState: 'terminal-local',
      serverRevisionState: 'not-required',
      nextRetryAt: null,
      updatedAt: Date.now(),
    });
    return 'complete';
  }
  const running: ActivityFinalRefinementJob = {
    ...durableJob,
    status: 'running',
    outcome: 'pending',
    attemptCount: job.attemptCount + 1,
    updatedAt: Date.now(),
    lastError: null,
    technicalOutcome: null,
    selectedSource: null,
    selectedFingerprint: null,
    authoritySource: null,
    matchingAttempted: false,
    governorAuthorized: null,
    candidateDecision: null,
    requestHttpCategory: 'not-attempted',
    selectionErrorCategory: null,
    roadEnhancementState: 'running',
    networkAttemptCount: job.networkAttemptCount ?? 0,
    nextRetryAt: null,
  };
  await writeJob(running);
  const stoppedBeforeRead = await stoppedRunResult(running, signal);
  if (stoppedBeforeRead) return stoppedBeforeRead;
  const baseArtifact = loadedArtifact;
  if (baseArtifact.canonicalFingerprint !== job.canonicalFingerprint) {
    throw new Error('activity_refinement_canonical_mismatch');
  }
  if (baseArtifact.revision > job.expectedBaseRevision && baseArtifact.source !== 'base') {
    running.technicalOutcome = 'recovered-accepted-artifact';
    running.candidateDecision = 'accepted';
    running.roadEnhancementState = 'accepted';
    await writeJob(running);
    return publishArtifactAndRelease(running, baseArtifact,
      baseArtifact.source === 'matched' || baseArtifact.source === 'hybrid' ? 'enhanced' : 'limited', signal);
  }

  const canonical = durableJob.input!.canonicalPoints.map(point => ({ ...point }));
  if (canonical.length < 2) {
    running.technicalOutcome = 'insufficient-evidence';
    running.candidateDecision = 'local-retained';
    await writeJob(running);
    return publishArtifactAndRelease(running, baseArtifact, 'base-retained', signal);
  }
  const canonicalSegments = segmentTrace(canonical).segments;
  const baseSegments = segmentTrace(baseArtifact.points).segments.map(segment => segment.slice());
  if (baseSegments.length !== canonicalSegments.length) {
    running.technicalOutcome = 'segment-structure-mismatch';
    running.candidateDecision = 'stable-local-segment-mismatch';
    running.requestHttpCategory = 'not-attempted';
    running.roadEnhancementState = 'terminal-local';
    await writeJob(running);
    return publishArtifactAndRelease(running, baseArtifact, 'base-retained', signal);
  }
  const networkState = networkMonitor.getState?.()?.state ?? 'unknown';
  const authority = await resolveMapboxPublicTokenAuthority();
  running.authoritySource = authority.source;
  if (networkState === 'offline') {
    running.technicalOutcome = 'offline';
    running.candidateDecision = 'stable-local-selected';
    await writeJob(running);
    return publishStableLocalPending(running, baseArtifact, 'pending-network', null, signal);
  }
  if (!authority.token) {
    running.technicalOutcome = 'authority-unavailable';
    running.candidateDecision = 'stable-local-authority-unavailable';
    running.roadEnhancementState = 'terminal-local';
    await writeJob(running);
    return publishArtifactAndRelease(running, baseArtifact, 'base-retained', signal);
  }
  running.networkAttemptCount = (running.networkAttemptCount ?? 0) + 1;
  await writeJob(running);

  const governor = createActivityMapboxRequestGovernor({
    ownerUserId: job.ownerUserId,
    clientActivityId: job.clientActivityId,
    startedAtMs: durableJob.input!.startedAt,
    recordedDurationMs: durableJob.input!.durationS * 1_000,
  });
  // The optional road-aware budget begins only after local safety, authority,
  // and governor setup. Mandatory WAL/artifact writes are never truncated.
  const deadlineMs = Date.now() + 4_500;
  let matchedSegments = 0;
  let hybrid = false;
  let roundedCornerCount = 0;
  let cornerTopologyGuardCount = 0;
  let postRoundGlobalRejectCount = 0;
  const requestResults: PedestrianFinalRequestResult[] = [];
  const resultReasons: string[] = [];
  const priority = canonicalSegments
    .map((segment, segmentIndex) => ({ segment, segmentIndex }))
    .filter(item => item.segment.length >= 2)
    .sort((left, right) => right.segment.length - left.segment.length || left.segmentIndex - right.segmentIndex);

  for (const { segment, segmentIndex } of priority) {
    // Durable job authority is checked before every segment/network dispatch.
    const stoppedBeforeDispatch = await stoppedRunResult(running, signal);
    if (stoppedBeforeDispatch) return stoppedBeforeDispatch;
    const remainingMs = deadlineMs - Date.now();
    if (remainingMs < 250) break;
    const result = await reconstructPedestrianFinalRoute(segment, {
      mapboxToken: authority.token,
      totalTimeoutMs: remainingMs,
      perCallTimeoutMs: Math.min(2_600, remainingMs),
      concurrency: 2,
      maxDirectionsRequests: 2,
      requestGovernor: governor,
      requestPhase: 'final',
      requestReason: 'durable-final-qualified-unresolved-corridor',
      signal,
      diagnosticResponseSink: exchange => {
        void recordActivityDiagnosticProviderExchange({
          ownerUserId: job.ownerUserId,
          clientActivityId: job.clientActivityId,
          exchange,
        });
      },
    });
    resultReasons.push('reason' in result ? result.reason : 'ok');
    const requests = result.stats.requestResults ?? [];
    running.matchingAttempted = running.matchingAttempted
      || requests.some(request => request.invoked);
    requestResults.push(...requests);
    if (requests.some(request => request.invoked)) running.governorAuthorized = true;
    else if (requests.some(request => request.governorReason != null)) running.governorAuthorized = false;
    const stoppedAfterDispatch = await stoppedRunResult(running, signal);
    if (stoppedAfterDispatch) return stoppedAfterDispatch;
    if (!result.ok || result.points.length < 2) continue;
    const coverage = analyzeTrustedEndpointCoverage(segment, result.points);
    if (!coverage.eligibleForAnchoring) continue;
    const anchored = preserveTrustedRouteEndpoints(segment, result.points);
    if (!evaluateMatchedGeometryQuality(segment, anchored).accepted) continue;
    const first = segment[0];
    const last = segment[segment.length - 1];
    const candidateSegment = anchored.map((point, index) => ({
      lat: point.lat,
      lng: point.lng,
      alt: point.alt,
      t: point.t ?? first.t + Math.round((last.t - first.t) * index / Math.max(1, anchored.length - 1)),
      segmentId: first.segmentId,
      ...(index === 0 && first.segmentStartReason ? { segmentStartReason: first.segmentStartReason } : {}),
    }));
    const networkMatched = Array.isArray(result.stats.sections)
      ? result.stats.sections.some(section => (
          section.decision === 'refined' && section.networkSource === 'map-matching'
        ))
      : result.stats.acceptedMatchedDistanceM > 0.5;
    // This queue starts from the already-selected Local/Trend artifact. A
    // provider failure can reconstruct a different canonical/Base geometry,
    // but a different fingerprint is not evidence of improvement. Only an
    // accepted provider-backed match may replace the stable current segment.
    // Offline/local trend selection happens once before the queue is created.
    const promotion = decideActivityFinalCandidatePromotion({
      canonical: segment,
      current: baseSegments[segmentIndex],
      candidate: candidateSegment,
      networkMatched,
    });
    if (!promotion.accepted) continue;
    const displaySelection = networkMatched
      ? selectRoundedActivityFinalCandidate({
          canonical: segment,
          current: baseSegments[segmentIndex],
          approvedUnrounded: candidateSegment,
          eligibleCorners: confidentRoadCornerMask(candidateSegment.length, result.stats),
        })
      : null;
    const selectedPoints = displaySelection?.points ?? candidateSegment;
    baseSegments[segmentIndex] = selectedPoints.map(point => ({
      ...point,
      segmentId: first.segmentId,
    }));
    roundedCornerCount += displaySelection?.usedRoundedCandidate
      ? displaySelection.roundingDiagnostics.roundedCorners
      : 0;
    cornerTopologyGuardCount += displaySelection?.roundingDiagnostics.skippedTopologyGuard ?? 0;
    postRoundGlobalRejectCount += displaySelection?.fellBackToApprovedUnrounded ? 1 : 0;
    if (networkMatched) matchedSegments += 1;
    hybrid = hybrid || result.stats.canonicalDerivedSectionCount > 0;
  }
  const stoppedAfterSegments = await stoppedRunResult(running, signal);
  if (stoppedAfterSegments) return stoppedAfterSegments;
  if (matchedSegments === 0) {
    const deadlineReached = Date.now() >= deadlineMs;
    const snapshot = await governor.snapshot().catch(() => null);
    const retained = decideRetainedLocalRefinement({
      networkState: 'online',
      deadlineReached: deadlineReached || (snapshot?.timeoutInvocations ?? 0) > 0,
      requestResults,
      resultReasons,
      governorAuthorized: running.governorAuthorized,
      networkAttemptCount: running.networkAttemptCount ?? 0,
      maxNetworkAttempts: MAX_NETWORK_ATTEMPTS,
      retryDelaysMs: RETRY_DELAYS_MS,
    });
    running.technicalOutcome = retained.technicalOutcome;
    running.candidateDecision = retained.candidateDecision;
    running.requestHttpCategory = retained.requestHttpCategory;
    await writeJob(running);
    if (retained.runResult === 'pending-retry') {
      return publishStableLocalPending(
        running,
        baseArtifact,
        'pending-retry',
        Date.now() + (retained.nextRetryDelayMs ?? 0),
        signal,
      );
    }
    return publishArtifactAndRelease(running, baseArtifact, 'base-retained', signal);
  }

  const eligibleCount = priority.length;
  const source = hybrid || matchedSegments < eligibleCount ? 'hybrid' as const : 'matched' as const;
  const stoppedBeforeCommit = await stoppedRunResult(running, signal);
  if (stoppedBeforeCommit) return stoppedBeforeCommit;
  // Serialize the artifact commit with durable job cancellation. Whichever
  // authority wins this boundary is observable: cancellation first skips the
  // commit; an already-entered local commit completes before cancellation can
  // become durable and is subsequently removed by owner-scoped deletion.
  const committed = await withJobMutation(job.ownerUserId, job.clientActivityId, async () => {
    const authority = await readJob(job.ownerUserId, job.clientActivityId);
    const ownerCurrent = useAppStore.getState().isLoggedIn
      && String(useAppStore.getState().user?.id ?? '') === job.ownerUserId;
    if (signal.aborted || !authority || authority.status === 'cancelled' || !ownerCurrent) return null;
    return commitActivityFinalArtifact({
      ownerUserId: job.ownerUserId,
      clientActivityId: job.clientActivityId,
      canonicalPoints: canonical,
      displayPoints: baseSegments.flat(),
      source,
      displayMode: 'road',
      expectedRevision: baseArtifact.revision,
    });
  });
  if (!committed) {
    const stopped = await stoppedRunResult(running, signal);
    return stopped ?? 'cancelled';
  }
  const acceptedArtifact = committed.artifact;
  running.technicalOutcome = matchedSegments > 0 ? 'matched-success' : 'local-improvement';
  running.candidateDecision = 'accepted';
  running.requestHttpCategory = activityFinalRefinementRequestCategory(requestResults, running.technicalOutcome);
  await writeJob(running);
  appendSimulatorLog('ACTIVITY_COMPLETION', 'activity_final_corner_rounding_v1', {
    displayOnly: true,
    appliedAfterAcceptedRoadMatch: true,
    roundedCornerCount,
    cornerTopologyGuardCount,
    postRoundGlobalRejectCount,
    canonicalGeometryChanged: false,
    activityDistanceChanged: false,
    memoryChanged: false,
  }, { userId: job.ownerUserId, clientActivityId: job.clientActivityId, coordinateSource: 'none' });
  const stoppedAfterCommit = await stoppedRunResult(running, signal);
  if (stoppedAfterCommit) return stoppedAfterCommit;
  if (acceptedArtifact.canonicalFingerprint !== job.canonicalFingerprint) {
    throw new Error('activity_refinement_revision_contaminated');
  }
  return publishArtifactAndRelease(running, acceptedArtifact,
    acceptedArtifact.source === 'matched' || acceptedArtifact.source === 'hybrid' ? 'enhanced' : 'limited', signal);
}

export async function enqueueActivityFinalRefinement(input: {
  ownerUserId: string;
  clientActivityId: string;
  baseArtifact: ActivityFinalArtifact;
}): Promise<ActivityFinalRefinementJob> {
  const existing = await readJob(input.ownerUserId, input.clientActivityId);
  if (existing && existing.canonicalFingerprint === input.baseArtifact.canonicalFingerprint
    && existing.status !== 'cancelled') return existing;
  const pending = await readPendingReadonly(input.clientActivityId);
  if (!pending || pending.userId !== input.ownerUserId) {
    throw new Error('activity_refinement_input_not_durable');
  }
  const durableInput = jobInputFromPending(pending, input.baseArtifact);
  if (!durableInput) throw new Error('activity_refinement_input_invalid');
  const now = Date.now();
  const job: ActivityFinalRefinementJob = {
    format: 'cairn-activity-final-refinement',
    version: 2,
    ownerUserId: input.ownerUserId,
    clientActivityId: input.clientActivityId,
    expectedBaseRevision: input.baseArtifact.revision,
    canonicalFingerprint: input.baseArtifact.canonicalFingerprint,
    status: 'queued',
    outcome: 'pending',
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
    completedRevision: null,
    lastError: null,
    technicalOutcome: null,
    selectedSource: null,
    selectedFingerprint: null,
    authoritySource: null,
    matchingAttempted: false,
    governorAuthorized: null,
    candidateDecision: null,
    requestHttpCategory: 'not-attempted',
    selectionErrorCategory: null,
    roadEnhancementState: 'pending-network',
    networkAttemptCount: 0,
    nextRetryAt: null,
    input: durableInput,
    revisionOperationId: require('../../services/offlineQueue').uuidv4(),
    serverRevisionState: 'not-required',
    serverRevisionAttemptCount: 0,
  };
  await writeJob(job);
  await addToIndex(input.ownerUserId, input.clientActivityId);
  return job;
}

export async function resumeActivityFinalRefinement(
  ownerUserId: string,
  clientActivityId: string,
): Promise<ActivityFinalRefinementRunResult> {
  const key = jobKey(ownerUserId, clientActivityId);
  const active = flights.get(key);
  if (active) return active;
  const controller = new AbortController();
  controllers.set(key, controller);
  const run = (async () => {
    const job = await readJob(ownerUserId, clientActivityId);
    if (!job) return 'absent' as const;
    if (job.status === 'cancelled') return 'cancelled' as const;
    if (job.status === 'complete') return 'complete' as const;
    if ((job.roadEnhancementState === 'pending-retry' || job.serverRevisionState === 'pending-retry')
      && job.nextRetryAt != null
      && job.nextRetryAt > Date.now()) {
      // A process restart loses in-memory timers. Re-register the persisted
      // deadline on every hydrate/network/foreground bootstrap wake.
      scheduleRetryWake(job);
      return 'pending-retry' as const;
    }
    try {
      return await executeJob(job, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) {
        finishPendingPreparation(clientActivityId);
        return 'cancelled' as const;
      }
      const artifact = await loadActivityFinalArtifact(ownerUserId, clientActivityId);
      const latest = await readJob(ownerUserId, clientActivityId);
      if (artifact && latest && latest.status !== 'cancelled') {
        const message = error instanceof Error ? error.message : String(error);
        const selectionErrorCategory = message.includes('canonical_mismatch')
          ? 'canonical-mismatch' as const
          : message.includes('revision_contaminated')
            ? 'revision-contaminated' as const
            : 'execution-error' as const;
        await writeJob({
          ...latest,
          lastError: selectionErrorCategory,
          technicalOutcome: 'execution-error',
          candidateDecision: 'stable-local-execution-error',
          selectionErrorCategory,
          requestHttpCategory: latest.requestHttpCategory ?? 'not-attempted',
          roadEnhancementState: 'terminal-local',
          nextRetryAt: null,
          updatedAt: Date.now(),
        });
        // Refinement is optional. A durable exception retains the validated
        // Base and releases upload rather than trapping the saved Activity.
        return publishArtifactAndRelease(latest, artifact, 'base-retained', controller.signal);
      }
      finishPendingPreparation(clientActivityId);
      return 'cancelled' as const;
    }
  })();
  flights.set(key, run);
  try {
    return await run;
  } finally {
    if (flights.get(key) === run) flights.delete(key);
    if (controllers.get(key) === controller) controllers.delete(key);
  }
}

/** Resume every durable refinement for the signed-in owner. Each job retains
 * its own single-flight and retry deadline, so duplicate lifecycle wakes are
 * harmless and two Activities cannot overwrite one another. */
export async function resumeAllActivityFinalRefinementsForOwner(
  ownerUserId: string,
): Promise<ActivityFinalRefinementRunResult[]> {
  let ids: string[] = [];
  try {
    const raw = await storage.getItem(indexKey(ownerUserId));
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) ids = parsed.filter(id => typeof id === 'string');
  } catch { /* malformed index yields no unsafe cross-owner scan */ }
  return Promise.all(ids.map(clientActivityId => (
    resumeActivityFinalRefinement(ownerUserId, clientActivityId)
  )));
}

export async function cancelActivityFinalRefinement(
  ownerUserId: string,
  clientActivityId: string,
): Promise<void> {
  const key = jobKey(ownerUserId, clientActivityId);
  const job = await readJob(ownerUserId, clientActivityId);
  if (job) {
    await writeJob({
      ...job,
      status: 'cancelled',
      outcome: 'deleted',
      updatedAt: Date.now(),
      lastError: null,
      // The coordinate-free tombstone is the stale-completion fence. Deleting
      // the key immediately would let an already-running async completion
      // recreate it; retaining the full input would violate single-Activity
      // deletion privacy.
      input: undefined,
    });
  }
  // Abort only after durable cancellation. In-flight fetches stop and bounded
  // workers cannot dispatch a subsequent request. Cleanup does not wait on a
  // potentially slow network promise.
  controllers.get(key)?.abort();
  await removeFromIndex(ownerUserId, clientActivityId);
  finishPendingPreparation(clientActivityId);
}

export async function cancelAllActivityFinalRefinementsForOwner(ownerUserId: string): Promise<void> {
  let ids: string[] = [];
  try {
    const raw = await storage.getItem(indexKey(ownerUserId));
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) ids = parsed.filter(id => typeof id === 'string');
  } catch { /* malformed index is removed by the owner-scoped purge sweep */ }
  await Promise.all(ids.map(clientActivityId => (
    cancelActivityFinalRefinement(ownerUserId, clientActivityId)
  )));
  // Account/privacy deletion must not race a local publish that had already
  // crossed an uninterruptible storage boundary. Network fetches have been
  // aborted above; wait only for the now-cancelled owner flights to settle
  // before the caller removes owner-scoped pending/artifact data.
  const settling = ids.flatMap(clientActivityId => {
    const flight = flights.get(jobKey(ownerUserId, clientActivityId));
    return flight ? [flight] : [];
  });
  if (settling.length > 0) await Promise.allSettled(settling);
}

export async function readActivityFinalRefinementJob(
  ownerUserId: string,
  clientActivityId: string,
): Promise<ActivityFinalRefinementJob | null> {
  return readJob(ownerUserId, clientActivityId);
}

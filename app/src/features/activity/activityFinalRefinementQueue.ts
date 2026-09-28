import { resolveMapboxPublicTokenAuthority } from '../../config/mapbox';
import { storage } from '../../store/storage';
import { useAppStore } from '../../store/useAppStore';
import { useSessionStore, type TrackPoint } from '../../store/useSessionStore';
import {
  analyzeTrustedEndpointCoverage,
  evaluateMatchedGeometryQuality,
  preserveTrustedRouteEndpoints,
} from '../../services/routing/snapTrack';
import { reconstructPedestrianFinalRoute } from '../../services/routing/pedestrianFinalRoute';
import { createActivityMapboxRequestGovernor } from '../../services/routing/activityRequestGovernor';
import {
  finishPendingPreparation,
  markPendingUploadReady,
  readPendingReadonly,
  savePending,
} from '../../services/pendingSyncStore';
import { appendSimulatorLog } from '../activitySimulator/simulatorLog';
import { segmentTrace, toServerPoint } from './activityContracts';
import {
  activityGeometryFingerprint,
  commitActivityFinalArtifact,
  loadActivityFinalArtifact,
  type ActivityFinalArtifact,
} from './activityFinalArtifact';

export interface ActivityFinalRefinementJob {
  format: 'cairn-activity-final-refinement';
  version: 1;
  ownerUserId: string;
  clientActivityId: string;
  expectedBaseRevision: number;
  canonicalFingerprint: string;
  status: 'queued' | 'running' | 'complete' | 'cancelled';
  outcome: 'pending' | 'enhanced' | 'limited' | 'base-retained' | 'deleted' | 'owner-deferred';
  attemptCount: number;
  createdAt: number;
  updatedAt: number;
  completedRevision: number | null;
  lastError: string | null;
}

export type ActivityFinalRefinementRunResult =
  | 'complete'
  | 'cancelled'
  | 'deferred-owner'
  | 'absent';

const ROOT = '@cairn:activity_final_refinement:v1:';
const INDEX = '@cairn:activity_final_refinement:index:v1:';
const flights = new Map<string, Promise<ActivityFinalRefinementRunResult>>();
const controllers = new Map<string, AbortController>();
const jobWriteTails = new Map<string, Promise<void>>();

const jobKey = (ownerUserId: string, clientActivityId: string) => `${ROOT}${ownerUserId}:${clientActivityId}`;
const indexKey = (ownerUserId: string) => `${INDEX}${ownerUserId}`;

function validJob(value: any, ownerUserId: string, clientActivityId: string): value is ActivityFinalRefinementJob {
  return value?.format === 'cairn-activity-final-refinement'
    && value.version === 1
    && value.ownerUserId === ownerUserId
    && value.clientActivityId === clientActivityId
    && Number.isInteger(value.expectedBaseRevision)
    && typeof value.canonicalFingerprint === 'string';
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

async function addToIndex(ownerUserId: string, clientActivityId: string): Promise<void> {
  let ids: string[] = [];
  try {
    const raw = await storage.getItem(indexKey(ownerUserId));
    if (raw) ids = JSON.parse(raw);
  } catch { /* replace malformed local index */ }
  if (!ids.includes(clientActivityId)) ids.push(clientActivityId);
  await storage.setItem(indexKey(ownerUserId), JSON.stringify(ids.slice(-128)), { strict: true });
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
    ...(typeof point.segment_id === 'string' ? { segmentId: point.segment_id } : {}),
    ...(typeof point.segment_start_reason === 'string' ? { segmentStartReason: point.segment_start_reason } : {}),
  } as TrackPoint;
}

function stateForArtifact(artifact: ActivityFinalArtifact): 'base_ready' | 'enhanced' | 'limited_evidence' {
  if (artifact.source === 'matched') return 'enhanced';
  if (artifact.source === 'base') return 'base_ready';
  return 'limited_evidence';
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
  if (!pending || pending.userId !== job.ownerUserId) {
    await writeJob({
      ...job,
      status: 'cancelled',
      outcome: 'deleted',
      updatedAt: Date.now(),
      lastError: null,
    });
    finishPendingPreparation(job.clientActivityId);
    return 'cancelled';
  }
  const currentJob = await readJob(job.ownerUserId, job.clientActivityId);
  if (!currentJob || currentJob.status === 'cancelled') {
    finishPendingPreparation(job.clientActivityId);
    return 'cancelled';
  }
  const payload = {
    ...pending.payload,
    route_points: artifact.points.map(point => toServerPoint(point)),
  };
  await savePending({
    ...pending,
    uploadState: 'preparing',
    payload,
    finalArtifact: {
      revision: artifact.revision,
      displayFingerprint: artifact.displayFingerprint,
      canonicalFingerprint: artifact.canonicalFingerprint,
      source: artifact.source,
      algorithmVersion: artifact.algorithmVersion,
    },
  });
  if (signal) {
    const stopped = await stoppedRunResult(job, signal);
    if (stopped) return stopped;
  }
  if (pending.summary) {
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
      syncState: 'pending',
      finalGeometryState: stateForArtifact(artifact),
      finalGeometryVersion: artifact.algorithmVersion,
      finalGeometryRevision: artifact.revision,
      finalGeometryFingerprint: artifact.displayFingerprint,
    }, job.ownerUserId);
  }
  if (signal) {
    const stopped = await stoppedRunResult(job, signal);
    if (stopped) return stopped;
  }
  await markPendingUploadReady(job.clientActivityId);
  if (signal) {
    const stopped = await stoppedRunResult(job, signal);
    if (stopped) return stopped;
  }
  await writeJob({
    ...currentJob,
    status: 'complete',
    outcome,
    completedRevision: artifact.revision,
    updatedAt: Date.now(),
    lastError: null,
  });
  finishPendingPreparation(job.clientActivityId);
  appendSimulatorLog('ACTIVITY_COMPLETION', 'activity_final_refinement_completed', {
    outcome,
    revision: artifact.revision,
    source: artifact.source,
    displayFingerprint: artifact.displayFingerprint,
  }, { userId: job.ownerUserId, clientActivityId: job.clientActivityId, coordinateSource: 'none' });
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

async function executeJob(job: ActivityFinalRefinementJob, signal: AbortSignal): Promise<ActivityFinalRefinementRunResult> {
  const currentOwner = useAppStore.getState().user?.id;
  if (!useAppStore.getState().isLoggedIn || String(currentOwner ?? '') !== job.ownerUserId) {
    await writeJob({ ...job, status: 'queued', outcome: 'owner-deferred', updatedAt: Date.now() });
    finishPendingPreparation(job.clientActivityId);
    return 'deferred-owner';
  }
  const running: ActivityFinalRefinementJob = {
    ...job,
    status: 'running',
    outcome: 'pending',
    attemptCount: job.attemptCount + 1,
    updatedAt: Date.now(),
    lastError: null,
  };
  await writeJob(running);
  const stoppedBeforeRead = await stoppedRunResult(running, signal);
  if (stoppedBeforeRead) return stoppedBeforeRead;
  const pending = await readPendingReadonly(job.clientActivityId);
  const baseArtifact = await loadActivityFinalArtifact(job.ownerUserId, job.clientActivityId);
  if (!pending || pending.userId !== job.ownerUserId || !baseArtifact) {
    await writeJob({
      ...running,
      status: 'cancelled',
      outcome: 'deleted',
      updatedAt: Date.now(),
      lastError: null,
    });
    finishPendingPreparation(job.clientActivityId);
    return 'cancelled';
  }
  if (baseArtifact.canonicalFingerprint !== job.canonicalFingerprint) {
    throw new Error('activity_refinement_canonical_mismatch');
  }
  if (baseArtifact.revision > job.expectedBaseRevision && baseArtifact.source !== 'base') {
    return publishArtifactAndRelease(running, baseArtifact,
      baseArtifact.source === 'matched' ? 'enhanced' : 'limited', signal);
  }

  const canonical = pending.payload.route_points_canonical.map(fromPendingPoint);
  if (canonical.length < 2) return publishArtifactAndRelease(running, baseArtifact, 'base-retained', signal);
  const canonicalSegments = segmentTrace(canonical).segments;
  const baseSegments = segmentTrace(baseArtifact.points).segments.map(segment => segment.slice());
  if (baseSegments.length !== canonicalSegments.length) {
    return publishArtifactAndRelease(running, baseArtifact, 'base-retained', signal);
  }
  const authority = await resolveMapboxPublicTokenAuthority();
  if (!authority.token) return publishArtifactAndRelease(running, baseArtifact, 'base-retained', signal);

  const governor = createActivityMapboxRequestGovernor({
    ownerUserId: job.ownerUserId,
    clientActivityId: job.clientActivityId,
    startedAtMs: pending.summary?.startedAt ?? pending.startedAt ?? pending.createdAt,
    recordedDurationMs: (pending.summary?.durationS ?? pending.payload.duration_s) * 1_000,
  });
  const deadlineMs = Date.now() + 10_000;
  let matchedSegments = 0;
  let locallyImprovedSegments = 0;
  let hybrid = false;
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
    });
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
    const networkMatched = result.stats.acceptedMatchedDistanceM > 0.5;
    const localImprovement = !networkMatched
      && result.stats.displayRefined
      && result.stats.wholeRouteValidation.accepted
      && activityGeometryFingerprint(candidateSegment) !== activityGeometryFingerprint(baseSegments[segmentIndex])
      && candidateSegment.length < baseSegments[segmentIndex].length;
    if (!networkMatched && !localImprovement) continue;
    baseSegments[segmentIndex] = candidateSegment;
    if (networkMatched) matchedSegments += 1;
    else locallyImprovedSegments += 1;
    hybrid = hybrid || result.stats.canonicalDerivedSectionCount > 0;
  }
  const stoppedAfterSegments = await stoppedRunResult(running, signal);
  if (stoppedAfterSegments) return stoppedAfterSegments;
  if (matchedSegments === 0 && locallyImprovedSegments === 0) {
    return publishArtifactAndRelease(running, baseArtifact, 'base-retained', signal);
  }

  const eligibleCount = priority.length;
  const source = matchedSegments === 0
    ? 'limited' as const
    : hybrid || matchedSegments < eligibleCount ? 'hybrid' as const : 'matched' as const;
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
      expectedRevision: baseArtifact.revision,
    });
  });
  if (!committed) {
    const stopped = await stoppedRunResult(running, signal);
    return stopped ?? 'cancelled';
  }
  const acceptedArtifact = committed.artifact;
  const stoppedAfterCommit = await stoppedRunResult(running, signal);
  if (stoppedAfterCommit) return stoppedAfterCommit;
  if (acceptedArtifact.canonicalFingerprint !== job.canonicalFingerprint) {
    throw new Error('activity_refinement_revision_contaminated');
  }
  return publishArtifactAndRelease(running, acceptedArtifact,
    acceptedArtifact.source === 'matched' ? 'enhanced' : 'limited', signal);
}

export async function enqueueActivityFinalRefinement(input: {
  ownerUserId: string;
  clientActivityId: string;
  baseArtifact: ActivityFinalArtifact;
}): Promise<ActivityFinalRefinementJob> {
  const existing = await readJob(input.ownerUserId, input.clientActivityId);
  if (existing && existing.canonicalFingerprint === input.baseArtifact.canonicalFingerprint
    && existing.status !== 'cancelled') return existing;
  const now = Date.now();
  const job: ActivityFinalRefinementJob = {
    format: 'cairn-activity-final-refinement',
    version: 1,
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
        await writeJob({
          ...latest,
          lastError: String(error).slice(0, 180),
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
    });
  }
  // Abort only after durable cancellation. In-flight fetches stop and bounded
  // workers cannot dispatch a subsequent request. Cleanup does not wait on a
  // potentially slow network promise.
  controllers.get(key)?.abort();
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

import type { CanonicalJournalPoint } from '../../services/hikeTrackWriter';
import type { TrackPoint } from '../../store/useSessionStore';
import {
  appendCausalLiveReplayPoint,
  buildCausalLiveRoute,
  buildCausalLiveRouteCooperatively,
  causalLiveReplayResult,
  createCausalLiveReplayCheckpoint,
} from './causalLiveRoute';
import {
  activityDistanceEstimate,
  appendActivityDistancePoint,
  buildActivityDistanceAccumulator,
  calculateActivityStats,
  createActivityDistanceAccumulator,
  type ActivityDistanceAccumulator,
} from './activityContracts';
import {
  createElevationQualityState,
  elevationQualityGain,
  reduceElevationObservation,
} from './elevationQuality';

function pointKey(point: TrackPoint): string {
  const rawOrdinal = point.rawOrdinal;
  return rawOrdinal != null
    ? `${point.segmentId ?? 'legacy'}:ordinal:${rawOrdinal}`
    : `${point.segmentId ?? 'legacy'}:${point.t}:${point.lat.toFixed(7)}:${point.lng.toFixed(7)}`;
}

function asTrackPoint(point: CanonicalJournalPoint | TrackPoint): TrackPoint {
  return {
    lat: point.lat,
    lng: point.lng,
    alt: point.alt ?? null,
    accuracy: point.accuracy ?? null,
    verticalAccuracy: point.verticalAccuracy ?? null,
    speed: point.speed ?? null,
    speedAccuracy: point.speedAccuracy ?? null,
    course: point.course ?? null,
    courseAccuracy: point.courseAccuracy ?? null,
    t: Math.floor(point.t),
    rawOrdinal: point.rawOrdinal,
    segmentId: point.segmentId,
    segmentStartReason: point.segmentStartReason,
  };
}

function projectMergedActivityPoints(
  current: ReadonlyArray<TrackPoint>,
  incoming: ReadonlyArray<CanonicalJournalPoint | TrackPoint>,
): ActivityJournalProjection {
  const byKey = new Map<string, TrackPoint>();
  for (const point of current) byKey.set(pointKey(point), asTrackPoint(point));
  let appendedFromJournal = 0;
  for (const incomingPoint of incoming) {
    const point = asTrackPoint(incomingPoint);
    const key = pointKey(point);
    if (!byKey.has(key)) appendedFromJournal += 1;
    // Durable/rebased evidence wins when an in-memory twin differs.
    byKey.set(key, point);
  }
  const canonical = Array.from(byKey.values()).sort((left, right) => (
    left.t - right.t
    || (left.rawOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.rawOrdinal ?? Number.MAX_SAFE_INTEGER)
  ));
  const stats = calculateActivityStats(canonical);
  return {
    canonical,
    live: buildCausalLiveRoute(canonical),
    distanceM: stats.distanceM,
    distanceAccumulator: buildActivityDistanceAccumulator(canonical),
    elevationGainM: stats.elevationGainM,
    appendedFromJournal,
  };
}

/** Stable evidence-only merge for raw audit state. It intentionally does not
 * construct Live geometry or metrics. */
export function mergeActivityCanonicalPoints(
  current: ReadonlyArray<TrackPoint>,
  incoming: ReadonlyArray<CanonicalJournalPoint | TrackPoint>,
): TrackPoint[] {
  const byKey = new Map<string, TrackPoint>();
  for (const point of current) byKey.set(pointKey(point), asTrackPoint(point));
  for (const rawPoint of incoming) {
    const point = asTrackPoint(rawPoint);
    byKey.set(pointKey(point), point);
  }
  return Array.from(byKey.values()).sort((left, right) => (
    left.t - right.t
    || (left.rawOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.rawOrdinal ?? Number.MAX_SAFE_INTEGER)
  ));
}

export interface ActivityJournalProjection {
  canonical: TrackPoint[];
  live: TrackPoint[];
  distanceM: number;
  distanceAccumulator: ActivityDistanceAccumulator;
  elevationGainM: number;
  appendedFromJournal: number;
}

/**
 * Rebuild the visible Activity from the durable canonical ledger. The journal
 * supplies history that a headless wake committed while no React store was
 * mounted; current canonical points are retained only when the same durable
 * snapshot has not exposed them yet. Stable identity is segment + raw ordinal
 * (or exact evidence fields for legacy points), never title or rounded metrics.
 */
export function projectActivityJournal(
  current: ReadonlyArray<TrackPoint>,
  journal: ReadonlyArray<CanonicalJournalPoint>,
): ActivityJournalProjection {
  return projectMergedActivityPoints(current, journal);
}

/**
 * Publish accepted points against the canonical state that exists after their
 * WAL append settles. A background takeover/replay is allowed to advance the
 * store during that await; this merge prevents the accepted point's earlier,
 * stale transition snapshot from deleting the replayed prefix or tail.
 */
export function projectAcceptedActivityPoints(
  current: ReadonlyArray<TrackPoint>,
  accepted: ReadonlyArray<TrackPoint>,
): ActivityJournalProjection {
  return projectMergedActivityPoints(current, accepted);
}

/** Fast append-only rebase used when a foreground WAL commit discovers that a
 * cooperative/background projection advanced the store during its await. */
export function projectAcceptedActivityPointsFromCheckpoint(
  current: ReadonlyArray<TrackPoint>,
  currentLive: ReadonlyArray<TrackPoint>,
  currentDistanceAccumulator: ActivityDistanceAccumulator,
  currentElevationGainM: number,
  accepted: ReadonlyArray<TrackPoint>,
): ActivityJournalProjection {
  const canonical = current.map(asTrackPoint);
  const keys = new Set(canonical.map(pointKey));
  const checkpoint = createCausalLiveReplayCheckpoint(canonical, currentLive);
  let distanceAccumulator = currentDistanceAccumulator;
  let appendedFromJournal = 0;
  for (const rawPoint of accepted) {
    const point = asTrackPoint(rawPoint);
    if (keys.has(pointKey(point))) continue;
    keys.add(pointKey(point));
    canonical.push(point);
    appendCausalLiveReplayPoint(checkpoint, point);
    distanceAccumulator = appendActivityDistancePoint(distanceAccumulator, point);
    appendedFromJournal += 1;
  }
  return {
    canonical,
    live: causalLiveReplayResult(checkpoint),
    distanceAccumulator,
    distanceM: activityDistanceEstimate(distanceAccumulator).distanceM,
    elevationGainM: currentElevationGainM,
    appendedFromJournal,
  };
}

export interface CooperativeActivityJournalProjectionMetrics {
  totalMs: number;
  maxSynchronousSliceMs: number;
  sliceCount: number;
  yieldCount: number;
  fullLiveRebuilds: number;
  reusedLiveCheckpoint: boolean;
  canonicalPointCount: number;
  appendedFromJournal: number;
}

export interface CooperativeActivityJournalProjectionResult {
  projection: ActivityJournalProjection;
  metrics: CooperativeActivityJournalProjectionMetrics;
}

export interface CooperativeActivityJournalProjectionOptions {
  currentLive?: ReadonlyArray<TrackPoint>;
  currentDistanceAccumulator?: ActivityDistanceAccumulator;
  currentElevationGainM?: number;
  maxPointsPerSlice?: number;
  yieldToHost?: () => Promise<void>;
  shouldContinue?: () => boolean;
}

const projectionNow = () => globalThis.performance?.now?.() ?? Date.now();
const projectionYield = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function sameCheckpointPoint(
  current: TrackPoint,
  journal: CanonicalJournalPoint,
): boolean {
  return pointKey(current) === pointKey(journal)
    && current.t === Math.floor(journal.t)
    && current.lat === journal.lat
    && current.lng === journal.lng
    && (current.segmentId ?? 'legacy') === (journal.segmentId ?? 'legacy');
}

/** Foreground hydration path. It reuses an already-published exact Live prefix
 * when the WAL is an append-only extension; otherwise it performs the same R3
 * causal replay in bounded host slices. No partial geometry is published. */
export async function projectActivityJournalCooperatively(
  current: ReadonlyArray<TrackPoint>,
  journal: ReadonlyArray<CanonicalJournalPoint>,
  options: CooperativeActivityJournalProjectionOptions = {},
): Promise<CooperativeActivityJournalProjectionResult | null> {
  const startedAt = projectionNow();
  const maxPointsPerSlice = Math.max(1, Math.floor(options.maxPointsPerSlice ?? 16));
  const yieldToHost = options.yieldToHost ?? projectionYield;
  let maxSynchronousSliceMs = 0;
  let sliceCount = 0;
  let yieldCount = 0;
  const cooperativeRange = async (
    count: number,
    work: (index: number) => void,
  ): Promise<boolean> => {
    for (let offset = 0; offset < count; offset += maxPointsPerSlice) {
      if (options.shouldContinue && !options.shouldContinue()) return false;
      const sliceStartedAt = projectionNow();
      const end = Math.min(count, offset + maxPointsPerSlice);
      for (let index = offset; index < end; index += 1) work(index);
      maxSynchronousSliceMs = Math.max(maxSynchronousSliceMs, projectionNow() - sliceStartedAt);
      sliceCount += 1;
      if (end < count) {
        yieldCount += 1;
        await yieldToHost();
      }
    }
    return !(options.shouldContinue && !options.shouldContinue());
  };
  const measureSynchronous = <T>(work: () => T): T => {
    const sliceStartedAt = projectionNow();
    const result = work();
    maxSynchronousSliceMs = Math.max(maxSynchronousSliceMs, projectionNow() - sliceStartedAt);
    sliceCount += 1;
    return result;
  };

  // Same owner/generation journals are append-only. Count plus stable first and
  // frontier identities is therefore a reusable version checkpoint; comparing
  // or replaying the complete prefix on every screen/AppState return would
  // recreate the foreground stall this path is intended to remove.
  const prefixMatches = current.length === 0
    || (current.length <= journal.length
      && sameCheckpointPoint(current[0], journal[0])
      && sameCheckpointPoint(current[current.length - 1], journal[current.length - 1]));
  const canReuseLive = prefixMatches
    && current.length > 0
    && options.currentLive != null
    && options.currentLive.length > 0;
  let canonical: TrackPoint[];
  let live: TrackPoint[];
  let distanceAccumulator: ActivityDistanceAccumulator;
  let appendedFromJournal = 0;
  let fullLiveRebuilds = 0;

  if (canReuseLive) {
    canonical = measureSynchronous(() => current.map(asTrackPoint));
    const checkpoint = createCausalLiveReplayCheckpoint(canonical, options.currentLive);
    distanceAccumulator = options.currentDistanceAccumulator
      ?? measureSynchronous(() => buildActivityDistanceAccumulator(canonical));
    appendedFromJournal = journal.length - current.length;
    if (!await cooperativeRange(appendedFromJournal, offset => {
      const point = asTrackPoint(journal[current.length + offset]);
      canonical.push(point);
      appendCausalLiveReplayPoint(checkpoint, point);
      distanceAccumulator = appendActivityDistancePoint(distanceAccumulator, point);
    })) return null;
    live = causalLiveReplayResult(checkpoint);
  } else {
    const byKey = new Map<string, TrackPoint>();
    if (!await cooperativeRange(current.length, index => {
      const point = asTrackPoint(current[index]);
      byKey.set(pointKey(point), point);
    })) return null;
    if (!await cooperativeRange(journal.length, index => {
      const point = asTrackPoint(journal[index]);
      const key = pointKey(point);
      if (!byKey.has(key)) appendedFromJournal += 1;
      byKey.set(key, point);
    })) return null;
    canonical = measureSynchronous(() => Array.from(byKey.values()).sort((left, right) => (
      left.t - right.t
      || (left.rawOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.rawOrdinal ?? Number.MAX_SAFE_INTEGER)
    )));
    const replay = await buildCausalLiveRouteCooperatively(canonical, {
      maxPointsPerSlice,
      yieldToHost,
      shouldContinue: options.shouldContinue,
    });
    if (!replay) return null;
    live = replay.route;
    maxSynchronousSliceMs = Math.max(maxSynchronousSliceMs, replay.metrics.maxSynchronousSliceMs);
    sliceCount += replay.metrics.sliceCount;
    yieldCount += replay.metrics.yieldCount;
    fullLiveRebuilds = 1;
    distanceAccumulator = createActivityDistanceAccumulator();
  }
  let elevationGainM = options.currentElevationGainM ?? 0;
  if (!canReuseLive || appendedFromJournal > 0 || options.currentDistanceAccumulator == null) {
    let replayedDistance = createActivityDistanceAccumulator();
    let elevationState = createElevationQualityState();
    let legacyElevationGainM = 0;
    let hasVerticalQualityEvidence = false;
    let previous: TrackPoint | null = null;
    if (!await cooperativeRange(canonical.length, index => {
      const point = canonical[index];
      replayedDistance = appendActivityDistancePoint(replayedDistance, point);
      const segmentId = point.segmentId || 'legacy-0';
      if (point.verticalAccuracy != null) hasVerticalQualityEvidence = true;
      elevationState = reduceElevationObservation(elevationState, { ...point, segmentId }).state;
      if (previous && (previous.segmentId || 'legacy-0') === segmentId
        && previous.alt != null && point.alt != null && point.alt > previous.alt) {
        legacyElevationGainM += point.alt - previous.alt;
      }
      previous = point;
    })) return null;
    if (!canReuseLive || options.currentDistanceAccumulator == null) {
      distanceAccumulator = replayedDistance;
    }
    elevationGainM = hasVerticalQualityEvidence
      ? elevationQualityGain(elevationState)
      : legacyElevationGainM;
  }
  const projection: ActivityJournalProjection = {
    canonical,
    live,
    distanceM: activityDistanceEstimate(distanceAccumulator).distanceM,
    distanceAccumulator,
    elevationGainM: Math.max(options.currentElevationGainM ?? 0, elevationGainM),
    appendedFromJournal,
  };
  return {
    projection,
    metrics: {
      totalMs: projectionNow() - startedAt,
      maxSynchronousSliceMs,
      sliceCount,
      yieldCount,
      fullLiveRebuilds,
      reusedLiveCheckpoint: canReuseLive,
      canonicalPointCount: canonical.length,
      appendedFromJournal,
    },
  };
}

/** Add concurrently accepted, WAL-committed suffix points to a prepared
 * projection without replaying its frozen prefix. Null means the caller must
 * cooperatively rebuild because the observed state was not an append suffix. */
export function rebaseActivityJournalProjection(
  prepared: ActivityJournalProjection,
  current: ReadonlyArray<TrackPoint>,
  currentElevationGainM = prepared.elevationGainM,
): ActivityJournalProjection | null {
  const keys = new Set(prepared.canonical.map(pointKey));
  const suffix = current.filter(point => !keys.has(pointKey(point))).map(asTrackPoint);
  if (suffix.length === 0) return prepared;
  const tail = prepared.canonical[prepared.canonical.length - 1];
  if (tail && suffix.some(point => (
    point.t < tail.t
    || (point.t === tail.t
      && point.rawOrdinal != null
      && tail.rawOrdinal != null
      && point.rawOrdinal <= tail.rawOrdinal)
  ))) return null;
  const canonical = prepared.canonical.slice();
  const checkpoint = createCausalLiveReplayCheckpoint(canonical, prepared.live);
  let distanceAccumulator = prepared.distanceAccumulator;
  for (const point of suffix) {
    canonical.push(point);
    appendCausalLiveReplayPoint(checkpoint, point);
    distanceAccumulator = appendActivityDistancePoint(distanceAccumulator, point);
  }
  return {
    ...prepared,
    canonical,
    live: causalLiveReplayResult(checkpoint),
    distanceAccumulator,
    distanceM: activityDistanceEstimate(distanceAccumulator).distanceM,
    elevationGainM: Math.max(prepared.elevationGainM, currentElevationGainM),
  };
}
